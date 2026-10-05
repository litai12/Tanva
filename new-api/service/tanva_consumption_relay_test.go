package service_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func tanvaRelayFixture(t *testing.T, upstream http.Handler) (*httptest.Server, *model.Channel) {
	t.Helper()
	beforeTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 10
	t.Cleanup(func() { constant.StreamingTimeout = beforeTimeout })
	for _, table := range []interface{}{&model.TanvaConsumption{}, &model.TanvaConsumptionOutbox{}, &model.RequestTrace{}, &model.SubscriptionPlan{}} {
		if !model.DB.Migrator().HasTable(table) {
			require.NoError(t, model.DB.AutoMigrate(table))
		}
	}
	t.Cleanup(func() {
		model.DB.Exec("DELETE FROM tanva_consumption_outboxes")
		model.DB.Exec("DELETE FROM tanva_consumptions")
		model.DB.Exec("DELETE FROM request_traces")
		model.DB.Exec("DELETE FROM users")
		model.DB.Exec("DELETE FROM tokens")
		model.DB.Exec("DELETE FROM channels")
		model.DB.Exec("DELETE FROM logs")
	})
	beforeModel, beforeOutput, beforeCache, beforePrice := ratio_setting.ModelRatio2JSONString(), ratio_setting.CompletionRatio2JSONString(), ratio_setting.CacheRatio2JSONString(), ratio_setting.ModelPrice2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"deepseek-v4.1-flash":1}`))
	require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(`{"deepseek-v4.1-flash":4}`))
	require.NoError(t, ratio_setting.UpdateCacheRatioByJSONString(`{"deepseek-v4.1-flash":0.02}`))
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"xiaot-agent-deepseek-v4-flash":0.01}`))
	t.Cleanup(func() {
		_ = ratio_setting.UpdateModelRatioByJSONString(beforeModel)
		_ = ratio_setting.UpdateCompletionRatioByJSONString(beforeOutput)
		_ = ratio_setting.UpdateCacheRatioByJSONString(beforeCache)
		_ = ratio_setting.UpdateModelPriceByJSONString(beforePrice)
	})
	require.NoError(t, model.DB.Create(&model.User{Id: 720, Username: "tanva_wire_fixture", Status: common.UserStatusEnabled, Group: "default", Quota: 1000000}).Error)
	require.NoError(t, model.DB.Create(&model.Token{Id: 720, UserId: 720, Key: "localfixture720", Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 1000000}).Error)
	supplier := httptest.NewServer(upstream)
	t.Cleanup(supplier.Close)
	baseURL := supplier.URL
	channel := &model.Channel{Id: 720, Type: constant.ChannelTypeOpenAI, Name: "local fixture", Key: "local-only-fixture", BaseURL: &baseURL, Status: common.ChannelStatusEnabled, Models: "deepseek-v4.1-flash,xiaot-agent-deepseek-v4-flash", Group: "default"}
	require.NoError(t, model.DB.Create(channel).Error)
	service.InitHttpClient()
	router := gin.New()
	router.Use(middleware.RequestId(), middleware.BodyStorageCleanup())
	group := router.Group("/v1")
	group.Use(middleware.TokenAuth(), middleware.TanvaConsumption())
	group.POST("/chat/completions", func(c *gin.Context) {
		storage, err := common.GetBodyStorage(c)
		if err != nil {
			c.AbortWithStatus(400)
			return
		}
		body, err := storage.Bytes()
		if err != nil {
			c.AbortWithStatus(400)
			return
		}
		var req struct {
			Model string `json:"model"`
		}
		require.NoError(t, common.Unmarshal(body, &req))
		require.Nil(t, middleware.SetupContextForSelectedChannel(c, channel, req.Model))
		common.SetContextKey(c, constant.ContextKeyUserSetting, dto.UserSetting{BillingPreference: "wallet_only"})
		common.SetContextKey(c, constant.ContextKeyRequestStartTime, time.Date(2026, 10, 5, 4, 0, 0, 0, time.UTC))
		controller.Relay(c, types.RelayFormatOpenAI)
	})
	query := router.Group("/v1/tanva/consumptions")
	query.Use(middleware.TanvaConsumptionQueryAuth())
	query.GET("/:orderId", controller.GetTanvaConsumption)
	gateway := httptest.NewServer(router)
	t.Cleanup(gateway.Close)
	return gateway, channel
}

func signedTanvaFixtureRequest(t *testing.T, method, endpoint, orderID, orderHash, secret string, body []byte) *http.Request {
	t.Helper()
	req, err := http.NewRequest(method, endpoint, bytes.NewReader(body))
	require.NoError(t, err)
	stamp := strconv.FormatInt(time.Now().Unix(), 10)
	req.Header.Set("Authorization", "Bearer localfixture720")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tanva-Order-Id", orderID)
	req.Header.Set("X-Tanva-Order-Hash", orderHash)
	req.Header.Set("X-Tanva-Timestamp", stamp)
	req.Header.Set("X-Tanva-Signature", service.TanvaRequestSignature(secret, stamp, method, req.URL.EscapedPath(), orderID, orderHash, body))
	return req
}

func TestTanvaConsumptionRelayContinuesStreamAfterClientDisconnect(t *testing.T) {
	t.Setenv("TANVA_CONSUMPTION_SECRET", "stream-fixture-secret")
	var calls atomic.Int32
	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseSupplier := func() { releaseOnce.Do(func() { close(release) }) }
	gateway, _ := tanvaRelayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		for key := range r.Header {
			require.False(t, strings.HasPrefix(strings.ToLower(key), "x-tanva-"))
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"id\":\"fixture\",\"object\":\"chat.completion.chunk\",\"model\":\"xiaot-agent-deepseek-v4-flash\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"},\"finish_reason\":null}]}\n\n")
		w.(http.Flusher).Flush()
		fmt.Fprint(w, "data: {\"id\":\"fixture\",\"object\":\"chat.completion.chunk\",\"model\":\"xiaot-agent-deepseek-v4-flash\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\" world\"},\"finish_reason\":null}]}\n\n")
		w.(http.Flusher).Flush()
		<-release
		fmt.Fprint(w, "data: {\"id\":\"fixture\",\"object\":\"chat.completion.chunk\",\"model\":\"xiaot-agent-deepseek-v4-flash\",\"choices\":[],\"usage\":{\"prompt_tokens\":0,\"completion_tokens\":17,\"total_tokens\":17}}\n\ndata: [DONE]\n\n")
	}))
	t.Cleanup(releaseSupplier)
	body := []byte(`{"model":"xiaot-agent-deepseek-v4-flash","messages":[{"role":"user","content":"hello"}],"stream":true}`)
	req := signedTanvaFixtureRequest(t, "POST", gateway.URL+"/v1/chat/completions", "stream:order", "hash", "stream-fixture-secret", body)
	ctx, cancel := context.WithCancel(req.Context())
	req = req.WithContext(ctx)
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	buf := make([]byte, 8)
	_, err = resp.Body.Read(buf)
	require.NoError(t, err)
	cancel()
	resp.Body.Close()
	releaseSupplier()
	require.Eventually(t, func() bool {
		o, err := model.GetTanvaConsumption(720, 720, "stream:order")
		return err == nil && o.Status == "consumed"
	}, 5*time.Second, 20*time.Millisecond)
	o, err := model.GetTanvaConsumption(720, 720, "stream:order")
	require.NoError(t, err)
	require.Equal(t, "0.01", o.Receipt().CostCny)
	require.Equal(t, "gateway_fixed_price", o.Receipt().UsageEvidence)
	require.Nil(t, o.Receipt().Usage)
	var user model.User
	require.NoError(t, model.DB.First(&user, 720).Error)
	require.Equal(t, 995000, user.Quota)
	duplicate := signedTanvaFixtureRequest(t, "POST", gateway.URL+"/v1/chat/completions", "stream:order", "hash", "stream-fixture-secret", body)
	dresp, err := http.DefaultClient.Do(duplicate)
	require.NoError(t, err)
	defer dresp.Body.Close()
	require.Equal(t, http.StatusConflict, dresp.StatusCode)
	require.EqualValues(t, 1, calls.Load())
	// Query succeeds with the same bearer after its remaining quota is exhausted.
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 720).Updates(map[string]interface{}{"remain_quota": 0, "status": common.TokenStatusExhausted}).Error)
	query := signedTanvaFixtureRequest(t, "GET", gateway.URL+"/v1/tanva/consumptions/stream%3Aorder", "stream:order", "hash", "stream-fixture-secret", nil)
	qresp, err := http.DefaultClient.Do(query)
	require.NoError(t, err)
	defer qresp.Body.Close()
	require.Equal(t, http.StatusOK, qresp.StatusCode)
}

// Optional cross-language integration: all supplier work is local fixture HTTP.
// The caller starts an isolated backend with its temporary PostgreSQL schema.
func TestTanvaConsumptionRelayToBackend(t *testing.T) {
	callback := os.Getenv("TANVA_CONSUMPTION_TEST_CALLBACK_URL")
	if callback == "" {
		t.Skip("requires local backend consumption integration fixture")
	}
	u, err := url.Parse(callback)
	require.NoError(t, err)
	require.Contains(t, []string{"127.0.0.1", "localhost", "::1"}, u.Hostname())
	id, hash, secret := os.Getenv("TANVA_CONSUMPTION_TEST_ORDER_ID"), os.Getenv("TANVA_CONSUMPTION_TEST_ORDER_HASH"), os.Getenv("TANVA_CONSUMPTION_TEST_SECRET")
	require.NotEmpty(t, id)
	require.NotEmpty(t, hash)
	require.NotEmpty(t, secret)
	t.Setenv("TANVA_CONSUMPTION_SECRET", secret)
	var calls atomic.Int32
	gateway, _ := tanvaRelayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"id":"local-fixture","object":"chat.completion","model":"deepseek-v4.1-flash","choices":[{"index":0,"message":{"role":"assistant","content":"local fixture output"},"finish_reason":"stop"}],"usage":{"prompt_tokens":18171,"completion_tokens":285,"total_tokens":18456,"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":18171}}`)
	}))
	body := []byte(`{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hello"}],"max_tokens":285}`)
	resp, err := http.DefaultClient.Do(signedTanvaFixtureRequest(t, "POST", gateway.URL+"/v1/chat/completions", id, hash, secret, body))
	require.NoError(t, err)
	defer resp.Body.Close()
	output, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode, string(output))
	require.Contains(t, string(output), "local fixture output")
	o, err := model.GetTanvaConsumption(720, 720, id)
	require.NoError(t, err)
	require.Equal(t, "consumed", o.Status)
	require.Equal(t, "0.019312", o.Receipt().CostCny)
	require.EqualValues(t, 9656, o.ActualQuota)
	var events []model.TanvaConsumptionOutbox
	require.NoError(t, model.DB.Where("consumption_id = ?", o.ID).Order("revision desc").Find(&events).Error)
	require.NotEmpty(t, events)
	// Simulate a lost notification: obtain the actual signed gateway query proof.
	qresp, err := http.DefaultClient.Do(signedTanvaFixtureRequest(t, "GET", gateway.URL+"/v1/tanva/consumptions/"+url.PathEscape(id), id, hash, secret, nil))
	require.NoError(t, err)
	var queried service.TanvaSignedEnvelope
	require.NoError(t, common.DecodeJson(qresp.Body, &queried))
	qresp.Body.Close()
	require.Equal(t, http.StatusOK, qresp.StatusCode)
	queriedPayload, err := base64.RawURLEncoding.DecodeString(queried.Payload)
	require.NoError(t, err)
	require.Equal(t, events[0].Payload, string(queriedPayload))
	for i := 0; i < 2; i++ {
		envelope := service.SignTanvaPayload([]byte(events[0].Payload), secret, time.Now())
		encoded, err := common.Marshal(envelope)
		require.NoError(t, err)
		ack, err := http.Post(callback, "application/json", bytes.NewReader(encoded))
		require.NoError(t, err)
		ackBody, err := io.ReadAll(ack.Body)
		ack.Body.Close()
		require.NoError(t, err)
		require.GreaterOrEqual(t, ack.StatusCode, 200, string(ackBody))
		require.Less(t, ack.StatusCode, 300, string(ackBody))
	}
	require.EqualValues(t, 1, calls.Load())
	t.Logf("real Go relay settled quota=%d costCny=%s; emitted real outbox proof and signed query; duplicate backend notification accepted", o.ActualQuota, o.Receipt().CostCny)
}
