package controller

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// TapCanvas asset plans are async jobs bought with a signed Tanva order. The
// order is reserved at the model's fixed price, parked on the accepted job and
// settled later from the job receipt (service.ReconcileTapCanvasReceipts).

func CreateTanvaAssetPlan(c *gin.Context) { relayTanvaAssetPlanSubmit(c, "") }

func RetryTanvaAssetPlan(c *gin.Context) { relayTanvaAssetPlanSubmit(c, c.Param("jobId")) }

func GetTanvaAssetPlan(c *gin.Context) {
	proxyTanvaAssetPlan(c, http.MethodGet, "")
}

func GetTanvaAssetPlanResult(c *gin.Context) {
	proxyTanvaAssetPlan(c, http.MethodGet, "/result?includeArtifacts=false")
}

func CancelTanvaAssetPlan(c *gin.Context) {
	proxyTanvaAssetPlan(c, http.MethodPost, "/cancel")
}

type tanvaAssetPlanSubmitRequest struct {
	Model          string          `json:"model"`
	IdempotencyKey string          `json:"idempotencyKey"`
	Request        json.RawMessage `json:"request"`
}

func writeTapCanvasUpstream(c *gin.Context, resp *service.TapCanvasUpstreamResponse) {
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json"
	}
	if retryAfter := resp.Header.Get("Retry-After"); retryAfter != "" {
		c.Header("Retry-After", retryAfter)
	}
	c.Data(resp.Status, contentType, resp.Body)
}

func tanvaAssetPlanUncertain(c *gin.Context) {
	c.JSON(http.StatusBadGateway, gin.H{"error": "tapcanvas_upstream_uncertain"})
}

func tanvaAssetPlanModelAllowed(c *gin.Context, name string) bool {
	if !common.GetContextKeyBool(c, constant.ContextKeyTokenModelLimitEnabled) {
		return true
	}
	raw, ok := common.GetContextKey(c, constant.ContextKeyTokenModelLimit)
	if !ok {
		return false
	}
	limits, _ := raw.(map[string]bool)
	for _, candidate := range model.RoutingModelCandidates(name) {
		if limits[ratio_setting.FormatMatchingModelName(candidate)] {
			return true
		}
	}
	return false
}

func relayTanvaAssetPlanSubmit(c *gin.Context, sourceJobID string) {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tanva_request_body_unavailable"})
		return
	}
	body, err := storage.Bytes()
	if err != nil || service.VerifyTanvaRequest(c, body, time.Now()) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "tanva_invalid_order_signature"})
		return
	}
	var request tanvaAssetPlanSubmitRequest
	if common.Unmarshal(body, &request) != nil || !service.IsTanvaConsumptionModelID(request.Model) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tanva_invalid_model"})
		return
	}
	unit := decimal.NewFromFloat(common.QuotaPerUnit)
	if !unit.Equal(decimal.NewFromInt(500000)) {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "tanva_quota_unit_must_be_500000"})
		return
	}
	instance := os.Getenv("TANVA_CONSUMPTION_INSTANCE_ID")
	if instance == "" {
		instance = "tanva-new-api"
	}
	requestID := c.GetString(common.RequestIdKey)
	if requestID == "" {
		requestID = common.GetUUID()
	}
	// The order identity covers the endpoint (and so the retried job) as well
	// as the body, so one order can never be replayed against another job.
	hash := sha256.Sum256([]byte(c.Request.Method + "\n" + c.Request.URL.EscapedPath() + "\n" + string(body)))
	order, fresh, err := model.ClaimTanvaConsumption(&model.TanvaConsumption{
		UserID: c.GetInt("id"), TokenID: c.GetInt("token_id"), OrderID: c.GetHeader("X-Tanva-Order-Id"), OrderHash: c.GetHeader("X-Tanva-Order-Hash"),
		BodyHash: hex.EncodeToString(hash[:]), InstanceID: instance, RequestID: requestID, Model: request.Model, QuotaPerUnit: unit.String(),
	})
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "tanva_order_claim_failed"})
		return
	}
	c.Header("X-Tanva-Gateway-Request-Id", order.RequestID)
	upstreamPath := "/v1/asset-plans"
	if sourceJobID != "" {
		upstreamPath += "/" + url.PathEscape(sourceJobID) + "/retry"
	}
	if !fresh {
		replayTanvaAssetPlan(c, order, upstreamPath, request, sourceJobID == "")
		return
	}
	defer func() {
		// Covers every unfinished branch and panics: refunds only before
		// dispatch, otherwise leaves the order for reconciliation.
		if err := model.FailTanvaConsumption(order.ID, "gateway_request_incomplete"); err != nil {
			common.SysLog("tanva asset plan final order update failed: " + err.Error())
		}
	}()
	reject := func(status int, code string) {
		if err := model.FailTanvaConsumption(order.ID, code); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "tanva_order_rejection_failed"})
			return
		}
		c.JSON(status, gin.H{"error": code})
	}
	preQuota, price, priced := service.TapCanvasAssetPlanPreQuota(request.Model)
	if request.Model != service.TapCanvasAssetPlanModel || !priced {
		reject(http.StatusBadRequest, "tanva_invalid_model")
		return
	}
	if len(request.IdempotencyKey) == 0 || len(request.IdempotencyKey) > 200 {
		reject(http.StatusBadRequest, "tanva_invalid_idempotency_key")
		return
	}
	var forwardBody []byte
	if sourceJobID == "" {
		var object map[string]json.RawMessage
		trimmed := bytes.TrimSpace(request.Request)
		if len(trimmed) == 0 || trimmed[0] != '{' || common.Unmarshal(trimmed, &object) != nil {
			reject(http.StatusBadRequest, "tanva_invalid_asset_plan_request")
			return
		}
		forwardBody = []byte(request.Request)
	}
	if !tanvaAssetPlanModelAllowed(c, request.Model) {
		reject(http.StatusForbidden, "tanva_token_model_forbidden")
		return
	}
	var channel *model.Channel
	if sourceJobID != "" {
		// A retry creates a child of the user's own job on that job's account.
		source, err := model.GetTanvaConsumptionByTapCanvasJob(order.UserID, sourceJobID)
		if !service.IsTanvaIdentifier(sourceJobID) || err != nil {
			reject(http.StatusNotFound, "tanva_asset_plan_not_found")
			return
		}
		channel, err = model.GetChannelById(source.ChannelID, true)
		if err != nil {
			reject(http.StatusServiceUnavailable, "tanva_no_available_channel")
			return
		}
	} else {
		channel, _, err = service.CacheGetRandomSatisfiedChannel(&service.RetryParam{
			Ctx: c, ModelName: request.Model, TokenGroup: common.GetContextKeyString(c, constant.ContextKeyUsingGroup), Retry: common.GetPointer(0),
		})
		if err != nil || channel == nil {
			reject(http.StatusServiceUnavailable, "tanva_no_available_channel")
			return
		}
	}
	if service.TapCanvasAssetPlanChannelReady(channel) != nil {
		reject(http.StatusServiceUnavailable, "tanva_no_available_channel")
		return
	}
	userSetting, _ := common.GetContextKeyType[dto.UserSetting](c, constant.ContextKeyUserSetting)
	priceJSON, err := common.Marshal(gin.H{"model_price": price, "quota_to_pre_consume": preQuota, "billing": "tapcanvas_asset_plan_receipt"})
	if err != nil {
		reject(http.StatusInternalServerError, "tanva_order_reserve_failed")
		return
	}
	if _, err := model.ReserveTanvaConsumption(order.ID, preQuota, userSetting.BillingPreference, string(priceJSON)); err != nil {
		if msg := err.Error(); msg == "insufficient_token_quota" || msg == "insufficient_funding_quota" {
			reject(http.StatusForbidden, msg)
		} else {
			reject(http.StatusServiceUnavailable, "tanva_order_reserve_failed")
		}
		return
	}
	// Dispatch precedes the supplier call: a crash after it can never refund
	// a job TapCanvas may already be charging for.
	if err := model.DispatchTanvaConsumption(order.ID, channel.Id); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "tanva_order_dispatch_failed"})
		return
	}
	order.ChannelID = channel.Id
	forwardTanvaAssetPlan(c, order, channel, upstreamPath, request.IdempotencyKey, forwardBody)
}

// A resend of the same signed order re-forwards with the same Idempotency-Key;
// TapCanvas returns the original job, which must match the parked one.
func replayTanvaAssetPlan(c *gin.Context, order *model.TanvaConsumption, upstreamPath string, request tanvaAssetPlanSubmitRequest, create bool) {
	switch {
	case order.Status == "rejected":
		c.JSON(http.StatusConflict, gin.H{"error": "tanva_order_rejected", "errorCode": order.ErrorCode})
		return
	case order.Phase == "accepted" || order.Phase == "reserved",
		order.Phase == "dispatching" && order.Status == "pending" && order.LeaseUntil >= common.GetTimestamp():
		c.JSON(http.StatusConflict, gin.H{"error": "tanva_order_in_progress"})
		return
	case order.ChannelID == 0 || len(request.IdempotencyKey) == 0 || len(request.IdempotencyKey) > 200:
		c.JSON(http.StatusConflict, gin.H{"error": "tanva_order_not_replayable"})
		return
	}
	if order.Phase == "dispatching" && order.Status == "pending" {
		// The original handler is gone (expired lease): stop treating the
		// order as live before re-forwarding it.
		if err := model.FailTanvaConsumption(order.ID, "gateway_execution_interrupted"); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "tanva_order_update_failed"})
			return
		}
	}
	channel, err := model.GetChannelById(order.ChannelID, true)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "tanva_no_available_channel"})
		return
	}
	var forwardBody []byte
	if create {
		forwardBody = []byte(request.Request)
	}
	forwardTanvaAssetPlan(c, order, channel, upstreamPath, request.IdempotencyKey, forwardBody)
}

func forwardTanvaAssetPlan(c *gin.Context, order *model.TanvaConsumption, channel *model.Channel, upstreamPath, idempotencyKey string, body []byte) {
	uncertain := func(code string) {
		if err := model.FailTanvaConsumption(order.ID, code); err != nil {
			common.SysLog("tanva asset plan uncertain update failed: " + err.Error())
		}
		tanvaAssetPlanUncertain(c)
	}
	resp, err := service.SubmitTapCanvasAssetPlan(channel, upstreamPath, idempotencyKey, body)
	if err != nil || resp.Status >= 500 {
		uncertain("tapcanvas_upstream_uncertain")
		return
	}
	if resp.Status >= 200 && resp.Status < 300 {
		jobID := service.TapCanvasAssetPlanJobID(resp.Body)
		if jobID == "" {
			uncertain("tapcanvas_upstream_uncertain")
			return
		}
		if order.TapCanvasJobID != "" && order.TapCanvasJobID != jobID {
			common.SysLog("tanva asset plan order " + order.OrderID + " replay returned job " + jobID + ", parked on " + order.TapCanvasJobID)
			c.JSON(http.StatusConflict, gin.H{"error": "tapcanvas_asset_plan_job_conflict"})
			return
		}
		if err := service.ParkTapCanvasAssetPlan(order.ID, jobID); err != nil {
			common.SysLog("tanva asset plan park failed for order " + order.OrderID + " job " + jobID + ": " + err.Error())
			if err.Error() == "tanva_asset_plan_job_conflict" {
				c.JSON(http.StatusConflict, gin.H{"error": "tapcanvas_asset_plan_job_conflict"})
				return
			}
			uncertain("tapcanvas_upstream_uncertain")
			return
		}
		writeTapCanvasUpstream(c, resp)
		return
	}
	if service.TapCanvasAssetPlanDefinitive(resp.Status) {
		if order.TapCanvasJobID != "" {
			// A job is already bound: a later refusal cannot refund it.
			common.SysLog("tanva asset plan order " + order.OrderID + " replay refused by upstream while parked on " + order.TapCanvasJobID)
			tanvaAssetPlanUncertain(c)
			return
		}
		if err := model.RejectTanvaDispatchedConsumption(order.ID, "tapcanvas_upstream_"+strconv.Itoa(resp.Status)); err != nil {
			common.SysLog("tanva asset plan rejection failed for order " + order.OrderID + ": " + err.Error())
			tanvaAssetPlanUncertain(c)
			return
		}
		writeTapCanvasUpstream(c, resp)
		return
	}
	// 3xx/408/429 and the like prove nothing either way.
	uncertain("tapcanvas_upstream_uncertain")
}

// Reads and cancel need no order: only the owner of the order bound to the
// job may reach it, through the channel that created it.
func proxyTanvaAssetPlan(c *gin.Context, method, suffix string) {
	jobID := c.Param("jobId")
	if !service.IsTanvaIdentifier(jobID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "tanva_asset_plan_not_found"})
		return
	}
	order, err := model.GetTanvaConsumptionByTapCanvasJob(c.GetInt("id"), jobID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "tanva_asset_plan_not_found"})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "tanva_asset_plan_unavailable"})
		}
		return
	}
	channel, err := model.GetChannelById(order.ChannelID, true)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "tanva_no_available_channel"})
		return
	}
	resp, err := service.ReadTapCanvasAssetPlan(channel, method, "/v1/asset-plans/"+url.PathEscape(jobID)+suffix)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "tapcanvas_upstream_unavailable"})
		return
	}
	writeTapCanvasUpstream(c, resp)
}
