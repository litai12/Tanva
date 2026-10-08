package middleware

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// Only signed server-owned orders use the durable path. A disconnected client
// stops receiving bytes but cannot stop upstream usage collection or settlement.
type tanvaDetachedWriter struct {
	gin.ResponseWriter
	mu   sync.Mutex
	gone bool
}

func (w *tanvaDetachedWriter) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.gone {
		if _, err := w.ResponseWriter.Write(data); err != nil {
			w.gone = true
		}
	}
	return len(data), nil
}
func (w *tanvaDetachedWriter) WriteString(value string) (int, error) { return w.Write([]byte(value)) }
func (w *tanvaDetachedWriter) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.gone {
		func() {
			defer func() {
				if recover() != nil {
					w.gone = true
				}
			}()
			w.ResponseWriter.Flush()
		}()
	}
}

func TanvaConsumption() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetHeader("X-Tanva-Order-Id") == "" && c.GetHeader("X-Tanva-Signature") == "" {
			c.Next()
			return
		}
		path := c.Request.URL.Path
		if c.Request.Method != http.MethodPost || (path != "/v1/chat/completions" && path != "/v1/responses") {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "tanva_order_endpoint_not_supported"})
			return
		}
		storage, err := common.GetBodyStorage(c)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "tanva_request_body_unavailable"})
			return
		}
		body, err := storage.Bytes()
		if err != nil || service.VerifyTanvaRequest(c, body, time.Now()) != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "tanva_invalid_order_signature"})
			return
		}
		var request struct {
			Model string `json:"model"`
		}
		if common.Unmarshal(body, &request) != nil || !service.IsTanvaConsumptionModelID(request.Model) {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "tanva_invalid_model"})
			return
		}
		unit := decimal.NewFromFloat(common.QuotaPerUnit)
		if !unit.Equal(decimal.NewFromInt(500000)) {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "tanva_quota_unit_must_be_500000"})
			return
		}
		instance := os.Getenv("TANVA_CONSUMPTION_INSTANCE_ID")
		if instance == "" {
			instance = "tanva-new-api"
		}
		hash := sha256.Sum256(body)
		order, fresh, err := model.ClaimTanvaConsumption(&model.TanvaConsumption{
			UserID: c.GetInt("id"), TokenID: c.GetInt("token_id"), OrderID: c.GetHeader("X-Tanva-Order-Id"), OrderHash: c.GetHeader("X-Tanva-Order-Hash"),
			BodyHash: hex.EncodeToString(hash[:]), InstanceID: instance, RequestID: c.GetString(common.RequestIdKey), Model: request.Model, QuotaPerUnit: unit.String(),
		})
		if err != nil {
			c.AbortWithStatusJSON(http.StatusConflict, gin.H{"error": "tanva_order_claim_failed"})
			return
		}
		c.Header("X-Tanva-Gateway-Request-Id", order.RequestID)
		if !fresh {
			envelope, err := service.TanvaReceiptEnvelope(order)
			if err != nil {
				c.AbortWithStatus(http.StatusInternalServerError)
				return
			}
			// A receipt is accounting evidence, never fabricated model output.
			c.AbortWithStatusJSON(http.StatusConflict, envelope)
			return
		}
		// Claim/replay precedes live model availability. Fresh invalid models
		// still produce a signed zero-cost rejection for the backend's registered
		// order; disabled models cannot invalidate a prior immutable receipt.
		if !service.IsTanvaConsumptionModel(request.Model) {
			if err := model.FailTanvaConsumption(order.ID, "tanva_invalid_model"); err != nil {
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "tanva_order_rejection_failed"})
				return
			}
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "tanva_invalid_model"})
			return
		}
		c.Set(service.TanvaConsumptionContextKey, order)
		ctx, cancel := context.WithTimeout(context.WithoutCancel(c.Request.Context()), service.TanvaConsumptionMaxDuration)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		c.Writer = &tanvaDetachedWriter{ResponseWriter: c.Writer}
		done := make(chan struct{})
		go func() {
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					model.HeartbeatTanvaConsumption(order.ID)
				case <-done:
					return
				case <-ctx.Done():
					return
				}
			}
		}()
		defer close(done)
		defer func() {
			// Covers validation, channel selection, panic and incomplete settlement.
			// Fail never refunds a dispatched/received order without evidence.
			if err := model.FailTanvaConsumption(order.ID, "gateway_request_incomplete"); err != nil {
				common.SysLog("tanva final order update failed: " + err.Error())
			}
		}()
		c.Next()
	}
}

// Receipt reads must remain available when consumption exhausts the token. They
// retain the normal bearer/user/IP checks, with only the spent quota bypassed.
func TanvaConsumptionQueryAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if service.VerifyTanvaRequest(c, nil, time.Now()) != nil {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		key := strings.TrimSpace(c.GetHeader("Authorization"))
		if len(key) < 7 || !strings.EqualFold(key[:7], "Bearer ") {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		key = strings.TrimPrefix(strings.TrimSpace(key[7:]), "sk-")
		token, err := model.GetTokenByKey(key, true)
		if err != nil || token == nil || (token.Status != common.TokenStatusEnabled && token.Status != common.TokenStatusExhausted) || (token.ExpiredTime != -1 && token.ExpiredTime < time.Now().Unix()) {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		user, err := model.GetUserById(token.UserId, false)
		if err != nil || user.Status != common.UserStatusEnabled {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		if limits := token.GetIpLimits(); len(limits) > 0 && !common.IsIpInCIDRList(net.ParseIP(c.ClientIP()), limits) {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		c.Set("id", token.UserId)
		c.Set("token_id", token.Id)
		c.Next()
	}
}
