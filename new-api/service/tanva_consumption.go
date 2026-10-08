package service

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

const TanvaConsumptionContextKey = "tanva_consumption"
const TanvaConsumptionMaxDuration = time.Hour

type TanvaSignedEnvelope struct {
	Timestamp string `json:"timestamp"`
	Payload   string `json:"payload"`
	Signature string `json:"signature"`
}

func TanvaHMAC(secret, message string) string {
	h := hmac.New(sha256.New, []byte(secret))
	_, _ = h.Write([]byte(message))
	return hex.EncodeToString(h.Sum(nil))
}

func TanvaRequestSignature(secret, timestamp, method, path, orderID, orderHash string, body []byte) string {
	hash := sha256.Sum256(body)
	return TanvaHMAC(secret, strings.Join([]string{timestamp, method, path, orderID, orderHash, hex.EncodeToString(hash[:])}, "\n"))
}

func VerifyTanvaRequest(c *gin.Context, body []byte, now time.Time) error {
	secret := os.Getenv("TANVA_CONSUMPTION_SECRET")
	if secret == "" {
		return errors.New("tanva_consumption_not_configured")
	}
	id, hash, stamp, signature := c.GetHeader("X-Tanva-Order-Id"), c.GetHeader("X-Tanva-Order-Hash"), c.GetHeader("X-Tanva-Timestamp"), c.GetHeader("X-Tanva-Signature")
	if !tanvaIdentifier(id) || !tanvaIdentifier(hash) {
		return errors.New("tanva_invalid_order_identity")
	}
	sec, err := strconv.ParseInt(stamp, 10, 64)
	if err != nil || sec < now.Unix()-300 || sec > now.Unix()+300 {
		return errors.New("tanva_signature_expired")
	}
	if c.Request.URL.RawQuery != "" {
		return errors.New("tanva_signed_query_not_supported")
	}
	expected := TanvaRequestSignature(secret, stamp, c.Request.Method, c.Request.URL.EscapedPath(), id, hash, body)
	provided, err := hex.DecodeString(signature)
	if err != nil {
		return errors.New("tanva_invalid_signature")
	}
	want, _ := hex.DecodeString(expected)
	if !hmac.Equal(provided, want) {
		return errors.New("tanva_invalid_signature")
	}
	return nil
}

func tanvaIdentifier(value string) bool {
	if len(value) == 0 || len(value) > 128 {
		return false
	}
	for _, ch := range value {
		if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '_' || ch == '.' || ch == ':') {
			return false
		}
	}
	return true
}

func SignTanvaPayload(payload []byte, secret string, now time.Time) TanvaSignedEnvelope {
	stamp := strconv.FormatInt(now.Unix(), 10)
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	return TanvaSignedEnvelope{Timestamp: stamp, Payload: encoded, Signature: TanvaHMAC(secret, stamp+"\n"+encoded)}
}

func TanvaReceiptEnvelope(o *model.TanvaConsumption) (TanvaSignedEnvelope, error) {
	body, err := common.Marshal(o.Receipt())
	if err != nil {
		return TanvaSignedEnvelope{}, err
	}
	return SignTanvaPayload(body, os.Getenv("TANVA_CONSUMPTION_SECRET"), time.Now()), nil
}

func TanvaOrder(c *gin.Context) *model.TanvaConsumption {
	v, exists := c.Get(TanvaConsumptionContextKey)
	if !exists {
		return nil
	}
	o, _ := v.(*model.TanvaConsumption)
	return o
}

func IsTanvaConsumptionModel(name string) bool {
	// Preserve the existing signed chat contracts, while explicit media
	// metadata can never borrow one of their historical names.
	switch name {
	case "deepseek-v4.1-flash", "deepseek-flash", "deepseek-v4-flash", "xiaot-agent-deepseek-v4-flash", "gemini-3.5-flash":
		var metas []model.Model
		if model.DB.Migrator().HasTable(&model.Model{}) {
			if err := model.DB.Where("model_name = ?", name).Find(&metas).Error; err != nil {
				return false
			}
			for _, meta := range metas {
				if meta.Kind != "" && meta.Kind != "chat" {
					return false
				}
			}
		}
		return true
	}
	for _, pricing := range model.GetPricing() {
		if pricing.ModelName != name || pricing.ModelKind != "chat" {
			continue
		}
		for _, quote := range pricing.ChannelTextPrices {
			if quote.ModelName == name && quote.Currency == "CNY" && quote.Input > 0 && quote.Output >= 0 {
				return true
			}
		}
	}
	return false
}

func IsTanvaConsumptionModelID(name string) bool { return tanvaIdentifier(name) }

func DispatchTanvaConsumption(info *relaycommon.RelayInfo) error {
	return model.DispatchTanvaConsumption(info.TanvaConsumptionID, info.ChannelId)
}

type tanvaBillingSession struct {
	orderID  int64
	preQuota int
	info     *relaycommon.RelayInfo
}

func (s *tanvaBillingSession) GetPreConsumedQuota() int { return s.preQuota }
func (s *tanvaBillingSession) Settle(actualQuota int) error {
	return model.SettleTanvaConsumption(s.orderID)
}
func (s *tanvaBillingSession) Refund(c *gin.Context) {
	if err := model.FailTanvaConsumption(s.orderID, "relay_failed"); err != nil {
		common.SysLog("tanva durable failure update failed: " + err.Error())
	}
}
func (s *tanvaBillingSession) NeedsRefund() bool { return true }

func PreConsumeTanvaBilling(c *gin.Context, preQuota int, info *relaycommon.RelayInfo) error {
	order := TanvaOrder(c)
	if order == nil {
		return errors.New("tanva_consumption_missing")
	}
	priceJSON, err := common.Marshal(info.PriceData)
	if err != nil {
		return err
	}
	reserved, err := model.ReserveTanvaConsumption(order.ID, int64(preQuota), info.UserSetting.BillingPreference, string(priceJSON))
	if err != nil {
		return err
	}
	info.TanvaConsumptionID = reserved.ID
	info.BillingSource, info.SubscriptionId, info.FinalPreConsumedQuota = reserved.Funding, reserved.SubscriptionID, preQuota
	info.Billing = &tanvaBillingSession{orderID: reserved.ID, preQuota: preQuota, info: info}
	return nil
}

// Called before the generic path can infer missing upstream usage. Fixed-price
// facade usage is never presented as real provider tokens.
func ObserveTanvaUsage(info *relaycommon.RelayInfo, usage *dto.Usage, authoritative bool) {
	if info.TanvaConsumptionID == 0 {
		return
	}
	if info.OriginModelName == "xiaot-agent-deepseek-v4-flash" {
		if authoritative {
			info.TanvaUsageEvidence = "gateway_fixed_price"
		}
		return
	}
	if authoritative && usage != nil && usage.PromptTokens >= 0 && usage.CompletionTokens >= 0 {
		info.TanvaUsageEvidence = "upstream_tokens"
		if raw, err := common.Marshal(usage); err == nil {
			info.TanvaUsageJSON = string(raw)
		}
	}
}

func SettleTanvaTextConsumption(c *gin.Context, info *relaycommon.RelayInfo, summary textQuotaSummary) error {
	if summary.BillingError != nil {
		_ = model.FailTanvaConsumption(info.TanvaConsumptionID, "invalid_quota")
		return summary.BillingError
	}
	quota := summary.Quota
	// The facade contract is a fixed-price gateway call. Its synthetic token
	// values (including zero on valid results) must not determine the amount.
	if info.TanvaUsageEvidence == "gateway_fixed_price" && quota == 0 {
		quota = info.PriceData.QuotaToPreConsume
	}
	if err := model.ReceiveTanvaConsumption(info.TanvaConsumptionID, int64(quota), info.TanvaUsageEvidence, info.TanvaUsageJSON); err != nil {
		return err
	}
	if err := model.SettleTanvaConsumption(info.TanvaConsumptionID); err != nil {
		_ = model.FailTanvaConsumption(info.TanvaConsumptionID, "settlement_retry_required")
		return err
	}
	return nil
}

func RecordTanvaConsumptionLog(c *gin.Context, info *relaycommon.RelayInfo, summary textQuotaSummary) {
	order := TanvaOrder(c)
	if order == nil {
		return
	}
	settled, err := model.GetTanvaConsumption(order.UserID, order.TokenID, order.OrderID)
	if err != nil || settled.Status != "consumed" {
		return
	}
	prompt, completion := summary.PromptTokens, summary.CompletionTokens
	if settled.UsageEvidence == "gateway_fixed_price" {
		prompt, completion = 0, 0
	}
	model.RecordConsumeLog(c, info.UserId, model.RecordConsumeLogParams{
		ChannelId: info.ChannelId, PromptTokens: prompt, CompletionTokens: completion, ModelName: settled.Model,
		TokenName: summary.TokenName, Quota: int(settled.ActualQuota), TokenId: info.TokenId, IsStream: info.IsStream,
		UseTimeSeconds: int(summary.UseTimeSeconds), Group: info.UsingGroup,
		Content: "Tanva durable consumption order " + settled.OrderID,
		Other: map[string]interface{}{"tanva_order_id": settled.OrderID, "gateway_request_id": settled.RequestID,
			"usage_evidence": settled.UsageEvidence, "cost_cny": settled.Receipt().CostCny, "model_ratio": summary.ModelRatio,
			"completion_ratio": summary.CompletionRatio, "cache_ratio": summary.CacheRatio, "group_ratio": summary.GroupRatio, "model_price": summary.ModelPrice},
	})
}

var tanvaWorkerOnce sync.Once

func StartTanvaConsumptionWorker() {
	if os.Getenv("TANVA_CONSUMPTION_SECRET") == "" {
		return
	}
	tanvaWorkerOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(5 * time.Second)
			defer ticker.Stop()
			for {
				if err := model.RecoverTanvaConsumptions(time.Now().Unix()); err != nil {
					common.SysLog("tanva consumption recovery failed: " + err.Error())
				}
				for i := 0; i < 20; i++ {
					o, err := model.LeaseTanvaOutbox(time.Now().Unix())
					if err != nil || o == nil {
						break
					}
					delivered := DeliverTanvaOutbox(o, os.Getenv("TANVA_CONSUMPTION_CALLBACK_URL"), os.Getenv("TANVA_CONSUMPTION_SECRET"), nil) == nil
					if err := model.FinishTanvaOutbox(o, delivered, time.Now().Unix()); err != nil {
						common.SysLog("tanva outbox update failed: " + err.Error())
					}
				}
				<-ticker.C
			}
		}()
	})
}

// No request-provided URL is accepted; redirects cannot disclose a signed
// accounting event to another destination. Pending events remain durable while
// configuration or the receiver is unavailable.
func DeliverTanvaOutbox(o *model.TanvaConsumptionOutbox, callback, secret string, client *http.Client) error {
	u, err := url.Parse(callback)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("invalid tanva HTTPS callback configuration")
	}
	if secret == "" {
		return errors.New("tanva secret missing")
	}
	envelope := SignTanvaPayload([]byte(o.Payload), secret, time.Now())
	body, err := common.Marshal(envelope)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, callback, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("tanva callback returned %d", resp.StatusCode)
	}
	return nil
}
