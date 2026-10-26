package service_test

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	apirouter "github.com/QuantumNous/new-api/router"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

const assetPlanSecret = "asset-plan-fixture-secret"

type assetPlanCall struct {
	Method, Path, Query, IdempotencyKey, ContentType, Auth string
	Body                                                   string
}

// assetPlanUpstream is a local TapCanvas /public root. Each test swaps the
// handler for the submit routes; reads/receipts answer from fixed state.
type assetPlanUpstream struct {
	mu      sync.Mutex
	calls   []assetPlanCall
	submit   func(w http.ResponseWriter, r *http.Request, call assetPlanCall)
	receipts map[string]string // job id -> receipt JSON; pending when absent
}

func (u *assetPlanUpstream) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	call := assetPlanCall{Method: r.Method, Path: r.URL.Path, Query: r.URL.RawQuery, IdempotencyKey: r.Header.Get("Idempotency-Key"), ContentType: r.Header.Get("Content-Type"), Auth: r.Header.Get("Authorization"), Body: string(body)}
	u.mu.Lock()
	u.calls = append(u.calls, call)
	submit := u.submit
	u.mu.Unlock()
	if call.Auth != "Bearer local-only-fixture" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	switch {
	case r.Method == http.MethodPost && (r.URL.Path == "/v1/asset-plans" || strings.HasSuffix(r.URL.Path, "/retry")):
		submit(w, r, call)
	case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/receipt"):
		u.mu.Lock()
		receipt, ok := u.receipts[strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/asset-plans/"), "/receipt")]
		u.mu.Unlock()
		if !ok {
			receipt = `{"total_status":"pending","total_amount_cny":null}`
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, receipt)
	case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/result"):
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		fmt.Fprint(w, `{"ret":0,"message":"","data":{"jobId":"x","status":"running"},"usage":{"status":"partial"}}`)
	case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/cancel"):
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		fmt.Fprint(w, `{"ret":0,"message":"","data":{"status":"running","cancelRequestedAt":"2026-10-21T23:42:48.306Z"}}`)
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/asset-plans/"):
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"ret":0,"message":"","data":{"jobId":"status-fixture","status":"running"}}`)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func (u *assetPlanUpstream) setSubmit(f func(w http.ResponseWriter, r *http.Request, call assetPlanCall)) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.submit = f
}

func (u *assetPlanUpstream) setReceipt(jobID, receipt string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.receipts[jobID] = receipt
}

func (u *assetPlanUpstream) snapshot() []assetPlanCall {
	u.mu.Lock()
	defer u.mu.Unlock()
	return append([]assetPlanCall(nil), u.calls...)
}

func acceptJob(jobID string) func(http.ResponseWriter, *http.Request, assetPlanCall) {
	return func(w http.ResponseWriter, r *http.Request, call assetPlanCall) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Retry-After", "2")
		w.Header().Set("Location", "/public/v1/asset-plans/"+jobID)
		w.WriteHeader(http.StatusAccepted)
		fmt.Fprintf(w, `{"ret":0,"message":"","data":{"jobId":%q,"status":"queued"}}`, jobID)
	}
}

// assetPlanFixture reuses the chat relay fixture's user/token/channel and
// mounts the production relay router in front of the fake TapCanvas.
func assetPlanFixture(t *testing.T) (*httptest.Server, *model.Channel, *assetPlanUpstream) {
	t.Helper()
	t.Setenv("TANVA_CONSUMPTION_SECRET", assetPlanSecret)
	upstream := &assetPlanUpstream{receipts: map[string]string{}}
	_, channel := tanvaRelayFixture(t, upstream)
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"tapcanvas-asset-plan":0.5}`))
	channel.Models = service.TapCanvasAssetPlanModel
	require.NoError(t, model.DB.Model(channel).Update("models", channel.Models).Error)
	require.NoError(t, model.DB.Create(&model.Ability{ChannelId: channel.Id, Model: service.TapCanvasAssetPlanModel, Group: "default", Enabled: true}).Error)
	// The DB channel query needs gateway column init that this test binary
	// lacks; the in-memory channel cache (the usual production mode) does not.
	beforeCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	model.InitChannelCache()
	t.Cleanup(func() { common.MemoryCacheEnabled = beforeCache })
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", 720).Update("quota", 10000000).Error)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 720).Update("remain_quota", 10000000).Error)
	require.NoError(t, model.DB.Create(&model.User{Id: 721, Username: "tanva_other_fixture", Phone: "fixture-721", AffCode: "fixture721", Status: common.UserStatusEnabled, Group: "default", Quota: 10000000}).Error)
	require.NoError(t, model.DB.Create(&model.Token{Id: 721, UserId: 721, Key: "localfixture721", Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 10000000}).Error)
	engine := gin.New()
	engine.Use(middleware.RequestId())
	apirouter.SetRelayRouter(engine)
	gateway := httptest.NewServer(engine)
	t.Cleanup(gateway.Close)
	return gateway, channel, upstream
}

const assetPlanRequest = `{"prompt":"请为以下章节规划资产","modelKey":"gemini-3.8-flash","reasoningEffort":"medium","assets":[],"clipPreference":"single_shot","knowledgeTier":"medium"}`

func assetPlanCreate(t *testing.T, gatewayURL, orderID, key string) (int, string) {
	t.Helper()
	body := []byte(`{"model":"tapcanvas-asset-plan","idempotencyKey":"` + key + `","request":` + assetPlanRequest + `}`)
	return doAssetPlan(t, signedTanvaFixtureRequest(t, http.MethodPost, gatewayURL+"/v1/tanva/asset-plans", orderID, "hash", assetPlanSecret, body))
}

func assetPlanRetry(t *testing.T, gatewayURL, jobID, orderID, key, bearer string) (int, string) {
	t.Helper()
	body := []byte(`{"model":"tapcanvas-asset-plan","idempotencyKey":"` + key + `"}`)
	req := signedTanvaFixtureRequest(t, http.MethodPost, gatewayURL+"/v1/tanva/asset-plans/"+jobID+"/retry", orderID, "hash", assetPlanSecret, body)
	req.Header.Set("Authorization", "Bearer "+bearer)
	return doAssetPlan(t, req)
}

func assetPlanRead(t *testing.T, method, endpoint, bearer string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(method, endpoint, nil)
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+bearer)
	return doAssetPlan(t, req)
}

func doAssetPlan(t *testing.T, req *http.Request) (int, string) {
	t.Helper()
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp.StatusCode, string(data)
}

func userQuota(t *testing.T, id int) int {
	t.Helper()
	var user model.User
	require.NoError(t, model.DB.First(&user, id).Error)
	return user.Quota
}

func TestTanvaAssetPlanCreateParksReadsAndReplays(t *testing.T) {
	gateway, _, upstream := assetPlanFixture(t)
	upstream.setSubmit(acceptJob("asset_plan_1"))
	status, body := assetPlanCreate(t, gateway.URL, "plan:create", "idem-create")
	require.Equal(t, http.StatusAccepted, status, body)
	require.JSONEq(t, `{"ret":0,"message":"","data":{"jobId":"asset_plan_1","status":"queued"}}`, body)
	calls := upstream.snapshot()
	require.Len(t, calls, 1)
	require.Equal(t, "/v1/asset-plans", calls[0].Path)
	require.Equal(t, "idem-create", calls[0].IdempotencyKey)
	require.Equal(t, assetPlanRequest, calls[0].Body, "the AssetPlanRequest is forwarded verbatim")

	o, err := model.GetTanvaConsumption(720, 720, "plan:create")
	require.NoError(t, err)
	require.Equal(t, "reconciliation_required", o.Status)
	require.Equal(t, model.TanvaUpstreamReceiptPending, o.ErrorCode)
	require.Equal(t, "asset_plan_1", o.TapCanvasJobID)
	require.EqualValues(t, 250000, o.PreQuota)
	require.Contains(t, o.UsageJSON, `"tapcanvas_receipt_kind":"asset_plan"`)
	require.Contains(t, o.UsageJSON, `"tapcanvas_request_id":"asset_plan_1"`)
	require.Equal(t, 10000000-250000, userQuota(t, 720))

	// Same signed order resent: re-forwarded with the same key, same job, no new charge.
	status, body = assetPlanCreate(t, gateway.URL, "plan:create", "idem-create")
	require.Equal(t, http.StatusAccepted, status, body)
	require.Contains(t, body, `"asset_plan_1"`)
	calls = upstream.snapshot()
	require.Len(t, calls, 2)
	require.Equal(t, "idem-create", calls[1].IdempotencyKey)
	require.Equal(t, 10000000-250000, userQuota(t, 720))
	// An upstream answering with another job is surfaced, never rebound.
	upstream.setSubmit(acceptJob("asset_plan_other"))
	status, _ = assetPlanCreate(t, gateway.URL, "plan:create", "idem-create")
	require.Equal(t, http.StatusConflict, status)
	o, _ = model.GetTanvaConsumption(720, 720, "plan:create")
	require.Equal(t, "asset_plan_1", o.TapCanvasJobID)

	// Owner reads are passed through verbatim to the order's channel.
	status, body = assetPlanRead(t, http.MethodGet, gateway.URL+"/v1/tanva/asset-plans/asset_plan_1", "localfixture720")
	require.Equal(t, http.StatusOK, status)
	require.JSONEq(t, `{"ret":0,"message":"","data":{"jobId":"status-fixture","status":"running"}}`, body)
	status, body = assetPlanRead(t, http.MethodGet, gateway.URL+"/v1/tanva/asset-plans/asset_plan_1/result", "localfixture720")
	require.Equal(t, http.StatusAccepted, status)
	require.Contains(t, body, `"usage":{"status":"partial"}`)
	status, body = assetPlanRead(t, http.MethodPost, gateway.URL+"/v1/tanva/asset-plans/asset_plan_1/cancel", "localfixture720")
	require.Equal(t, http.StatusAccepted, status)
	require.Contains(t, body, "cancelRequestedAt")
	calls = upstream.snapshot()
	reads := calls[len(calls)-3:]
	require.Equal(t, assetPlanCall{Method: "GET", Path: "/v1/asset-plans/asset_plan_1", Auth: "Bearer local-only-fixture"}, reads[0])
	require.Equal(t, "/v1/asset-plans/asset_plan_1/result", reads[1].Path)
	require.Equal(t, "includeArtifacts=false", reads[1].Query)
	require.Equal(t, assetPlanCall{Method: "POST", Path: "/v1/asset-plans/asset_plan_1/cancel", Auth: "Bearer local-only-fixture"}, reads[2], "cancel carries no body and no Idempotency-Key")

	// Another user cannot see, read or cancel the job.
	before := len(upstream.snapshot())
	for _, r := range []struct{ method, suffix string }{{"GET", ""}, {"GET", "/result"}, {"POST", "/cancel"}} {
		status, _ = assetPlanRead(t, r.method, gateway.URL+"/v1/tanva/asset-plans/asset_plan_1"+r.suffix, "localfixture721")
		require.Equal(t, http.StatusNotFound, status)
	}
	status, _ = assetPlanRead(t, http.MethodGet, gateway.URL+"/v1/tanva/asset-plans/unknown_job", "localfixture720")
	require.Equal(t, http.StatusNotFound, status)
	require.Len(t, upstream.snapshot(), before)

	// The parked order survives recovery sweeps long past the chat max duration.
	require.NoError(t, model.RecoverTanvaConsumptions(time.Now().Add(49*time.Hour).Unix()))
	o, _ = model.GetTanvaConsumption(720, 720, "plan:create")
	require.Equal(t, "reconciliation_required", o.Status)
	require.Equal(t, model.TanvaUpstreamReceiptPending, o.ErrorCode)
}

func TestTanvaAssetPlanCreateRejectedByUpstreamRefunds(t *testing.T) {
	gateway, _, upstream := assetPlanFixture(t)
	upstream.setSubmit(func(w http.ResponseWriter, r *http.Request, call assetPlanCall) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusPaymentRequired)
		fmt.Fprint(w, `{"ret":402,"message":"insufficient_credits","data":null}`)
	})
	status, body := assetPlanCreate(t, gateway.URL, "plan:402", "idem-402")
	require.Equal(t, http.StatusPaymentRequired, status)
	require.JSONEq(t, `{"ret":402,"message":"insufficient_credits","data":null}`, body)
	o, err := model.GetTanvaConsumption(720, 720, "plan:402")
	require.NoError(t, err)
	require.Equal(t, "rejected", o.Status)
	require.Equal(t, "tapcanvas_upstream_402", o.ErrorCode)
	require.Equal(t, "0", o.Receipt().CostCny)
	require.Equal(t, "0", o.Receipt().Quota)
	require.Equal(t, 10000000, userQuota(t, 720), "the reservation is refunded")
	var events int64
	require.NoError(t, model.DB.Model(&model.TanvaConsumptionOutbox{}).Where("consumption_id = ?", o.ID).Count(&events).Error)
	require.EqualValues(t, 3, events, "accepted, reserved, rejected (dispatch emits no event)")
	// A rejected order is never re-forwarded.
	status, _ = assetPlanCreate(t, gateway.URL, "plan:402", "idem-402")
	require.Equal(t, http.StatusConflict, status)
	require.Len(t, upstream.snapshot(), 1)
}

func TestTanvaAssetPlanUncertainCreateIsReplayedNotRefunded(t *testing.T) {
	gateway, _, upstream := assetPlanFixture(t)
	upstream.setSubmit(func(w http.ResponseWriter, r *http.Request, call assetPlanCall) {
		conn, _, err := w.(http.Hijacker).Hijack()
		require.NoError(t, err)
		conn.Close()
	})
	status, body := assetPlanCreate(t, gateway.URL, "plan:net", "idem-net")
	require.Equal(t, http.StatusBadGateway, status)
	require.JSONEq(t, `{"error":"tapcanvas_upstream_uncertain"}`, body)
	o, err := model.GetTanvaConsumption(720, 720, "plan:net")
	require.NoError(t, err)
	require.Equal(t, "reconciliation_required", o.Status)
	require.Equal(t, "dispatching", o.Phase)
	require.Empty(t, o.TapCanvasJobID)
	require.Equal(t, 10000000-250000, userQuota(t, 720), "an uncertain submit is never refunded")

	// 5xx is just as uncertain.
	upstream.setSubmit(func(w http.ResponseWriter, r *http.Request, call assetPlanCall) { w.WriteHeader(http.StatusBadGateway) })
	status, _ = assetPlanCreate(t, gateway.URL, "plan:net", "idem-net")
	require.Equal(t, http.StatusBadGateway, status)

	upstream.setSubmit(acceptJob("asset_plan_net"))
	status, body = assetPlanCreate(t, gateway.URL, "plan:net", "idem-net")
	require.Equal(t, http.StatusAccepted, status, body)
	require.Contains(t, body, `"asset_plan_net"`)
	calls := upstream.snapshot()
	require.Len(t, calls, 3)
	for _, call := range calls {
		require.Equal(t, "idem-net", call.IdempotencyKey)
		require.Equal(t, assetPlanRequest, call.Body)
	}
	o, _ = model.GetTanvaConsumption(720, 720, "plan:net")
	require.Equal(t, "asset_plan_net", o.TapCanvasJobID)
	require.Equal(t, model.TanvaUpstreamReceiptPending, o.ErrorCode)
	require.Equal(t, 10000000-250000, userQuota(t, 720))
}

func TestTanvaAssetPlanRetryIsASeparateOwnedOrder(t *testing.T) {
	gateway, _, upstream := assetPlanFixture(t)
	upstream.setSubmit(acceptJob("asset_plan_src"))
	status, _ := assetPlanCreate(t, gateway.URL, "plan:src", "idem-src")
	require.Equal(t, http.StatusAccepted, status)

	// Another user cannot retry (and be billed for) someone else's job.
	status, _ = assetPlanRetry(t, gateway.URL, "asset_plan_src", "plan:steal", "idem-steal", "localfixture721")
	require.Equal(t, http.StatusNotFound, status)
	stolen, err := model.GetTanvaConsumption(721, 721, "plan:steal")
	require.NoError(t, err)
	require.Equal(t, "rejected", stolen.Status)
	require.Equal(t, 10000000, userQuota(t, 721))
	require.Len(t, upstream.snapshot(), 1)

	upstream.setSubmit(acceptJob("asset_plan_child"))
	status, body := assetPlanRetry(t, gateway.URL, "asset_plan_src", "plan:retry", "idem-retry", "localfixture720")
	require.Equal(t, http.StatusAccepted, status, body)
	require.Contains(t, body, `"asset_plan_child"`)
	call := upstream.snapshot()[1]
	require.Equal(t, "/v1/asset-plans/asset_plan_src/retry", call.Path)
	require.Equal(t, "idem-retry", call.IdempotencyKey)
	require.Empty(t, call.Body, "TapCanvas rejects any retry body")
	require.Empty(t, call.ContentType)

	src, _ := model.GetTanvaConsumption(720, 720, "plan:src")
	child, err := model.GetTanvaConsumption(720, 720, "plan:retry")
	require.NoError(t, err)
	require.NotEqual(t, src.ID, child.ID)
	require.Equal(t, "asset_plan_src", src.TapCanvasJobID)
	require.Equal(t, "asset_plan_child", child.TapCanvasJobID)
	require.Equal(t, src.ChannelID, child.ChannelID)
	require.Equal(t, 10000000-500000, userQuota(t, 720))
	// The child job is readable by its owner.
	status, _ = assetPlanRead(t, http.MethodGet, gateway.URL+"/v1/tanva/asset-plans/asset_plan_child", "localfixture720")
	require.Equal(t, http.StatusOK, status)
}

func TestTanvaAssetPlanUnpricedModelIsSignedRejection(t *testing.T) {
	gateway, _, upstream := assetPlanFixture(t)
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{}`))
	status, body := assetPlanCreate(t, gateway.URL, "plan:unpriced", "idem-unpriced")
	require.Equal(t, http.StatusBadRequest, status)
	require.JSONEq(t, `{"error":"tanva_invalid_model"}`, body)
	o, err := model.GetTanvaConsumption(720, 720, "plan:unpriced")
	require.NoError(t, err)
	require.Equal(t, "rejected", o.Status)
	require.Equal(t, "0", o.Receipt().CostCny)
	require.Empty(t, upstream.snapshot())
	// Unsigned submits are refused before any order exists.
	req, err := http.NewRequest(http.MethodPost, gateway.URL+"/v1/tanva/asset-plans", strings.NewReader(`{}`))
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer localfixture720")
	status, _ = doAssetPlan(t, req)
	require.Equal(t, http.StatusUnauthorized, status)
}

func TestTanvaAssetPlanReconcilerSettlesFromJobReceipt(t *testing.T) {
	gateway, _, upstream := assetPlanFixture(t)
	upstream.setSubmit(acceptJob("asset_plan_paid"))
	status, _ := assetPlanCreate(t, gateway.URL, "plan:paid", "idem-paid")
	require.Equal(t, http.StatusAccepted, status)
	upstream.setSubmit(acceptJob("asset_plan_free"))
	status, _ = assetPlanCreate(t, gateway.URL, "plan:free", "idem-free")
	require.Equal(t, http.StatusAccepted, status)
	require.Equal(t, 10000000-500000, userQuota(t, 720))

	now := time.Now().Unix()
	service.ReconcileTapCanvasReceipts(now, nil)
	paid, _ := model.GetTanvaConsumption(720, 720, "plan:paid")
	require.Equal(t, "reconciliation_required", paid.Status, "a pending job receipt only defers the check")

	upstream.setReceipt("asset_plan_paid", `{"status":"settled","total_status":"settled","total_amount_cny":"3.7"}`)
	service.ReconcileTapCanvasReceipts(now+61, nil)
	paid, _ = model.GetTanvaConsumption(720, 720, "plan:paid")
	require.Equal(t, "consumed", paid.Status)
	require.EqualValues(t, 1850000, paid.ActualQuota)
	require.Equal(t, "3.7", paid.Receipt().CostCny)
	require.Equal(t, "tapcanvas_receipt", paid.Receipt().UsageEvidence)

	free, _ := model.GetTanvaConsumption(720, 720, "plan:free")
	require.Equal(t, "reconciliation_required", free.Status)
	upstream.setReceipt("asset_plan_free", `{"status":"settled","total_status":"settled","total_amount_cny":"0"}`)
	service.ReconcileTapCanvasReceipts(now+122, nil)
	free, _ = model.GetTanvaConsumption(720, 720, "plan:free")
	require.Equal(t, "consumed", free.Status)
	require.EqualValues(t, 0, free.ActualQuota)
	require.Equal(t, "0", free.Receipt().CostCny)
	require.Equal(t, "0", free.Receipt().Quota)
	require.Equal(t, 10000000-1850000, userQuota(t, 720))

	var receiptPaths []string
	for _, call := range upstream.snapshot() {
		if strings.HasSuffix(call.Path, "/receipt") || strings.Contains(call.Path, "/billing/") {
			receiptPaths = append(receiptPaths, call.Path)
		}
	}
	require.NotEmpty(t, receiptPaths)
	for _, p := range receiptPaths {
		require.Contains(t, []string{"/v1/asset-plans/asset_plan_paid/receipt", "/v1/asset-plans/asset_plan_free/receipt"}, p)
	}
}

func assetPlanTasks(t *testing.T) []model.Task {
	t.Helper()
	var tasks []model.Task
	require.NoError(t, model.DB.Where("platform = ?", constant.TaskPlatformTapCanvas).Find(&tasks).Error)
	return tasks
}

func assetPlanLogs(t *testing.T) []model.Log {
	t.Helper()
	var logs []model.Log
	require.NoError(t, model.LOG_DB.Where("model_name = ?", service.TapCanvasAssetPlanModel).Find(&logs).Error)
	return logs
}

// 任务日志 shows the job from acceptance; 使用日志 gets one entry at settlement.
// Polling and the refunding timeout sweeper must never touch the mirror.
func TestTanvaAssetPlanMirrorsIntoTaskAndUsageLogs(t *testing.T) {
	gateway, channel, upstream := assetPlanFixture(t)
	upstream.setSubmit(acceptJob("asset_plan_logged"))
	status, _ := assetPlanCreate(t, gateway.URL, "plan:logged", "idem-logged")
	require.Equal(t, http.StatusAccepted, status)
	_, _ = assetPlanCreate(t, gateway.URL, "plan:logged", "idem-logged")

	tasks := assetPlanTasks(t)
	require.Len(t, tasks, 1, "a replayed order mirrors the same job once")
	task := tasks[0]
	require.Equal(t, "asset_plan_logged", task.TaskID)
	require.Equal(t, constant.TaskActionAssetPlan, task.Action)
	require.Equal(t, model.TaskStatus(model.TaskStatusInProgress), task.Status)
	require.Equal(t, 720, task.UserId)
	require.Equal(t, channel.Id, task.ChannelId)
	require.Equal(t, 250000, task.Quota, "reserved quota until the receipt settles")
	require.Empty(t, assetPlanLogs(t))

	for _, unfinished := range model.GetAllUnFinishSyncTasks(1000) {
		require.NotEqual(t, constant.TaskPlatform(constant.TaskPlatformTapCanvas), unfinished.Platform)
	}
	for _, timedOut := range model.GetTimedOutUnfinishedTasks(time.Now().Add(48*time.Hour).Unix(), 1000) {
		require.NotEqual(t, constant.TaskPlatform(constant.TaskPlatformTapCanvas), timedOut.Platform)
	}

	upstream.setReceipt("asset_plan_logged", `{"job_status":"failed","total_status":"settled","total_amount_cny":"3.7"}`)
	service.ReconcileTapCanvasReceipts(time.Now().Unix()+61, nil)
	task = assetPlanTasks(t)[0]
	require.Equal(t, model.TaskStatus(model.TaskStatusFailure), task.Status, "a failed plan is shown as failed")
	require.Contains(t, task.FailReason, "按已发生的模型用量结算")
	require.Equal(t, 1850000, task.Quota)
	require.Equal(t, "100%", task.Progress)

	logs := assetPlanLogs(t)
	require.Len(t, logs, 1)
	require.Equal(t, model.LogTypeConsume, logs[0].Type)
	require.Equal(t, 1850000, logs[0].Quota)
	require.Equal(t, channel.Id, logs[0].ChannelId)
	require.Equal(t, 720, logs[0].TokenId)
	require.Contains(t, logs[0].Content, "asset_plan_logged")
	require.Contains(t, logs[0].Content, "¥3.7")
	require.Contains(t, logs[0].Other, `"job_status":"failed"`)

	order, err := model.GetTanvaConsumption(720, 720, "plan:logged")
	require.NoError(t, err)
	service.SyncTapCanvasAssetPlanLogs(order.ID, "")
	require.Len(t, assetPlanLogs(t), 1, "re-sync never writes a second consume log")
	rows, err := model.ListTanvaAssetPlanOrdersToMirror(100)
	require.NoError(t, err)
	require.Empty(t, rows)
}

// Orders parked or settled before the mirror existed are found for backfill.
func TestTanvaAssetPlanOrdersWithoutMirrorAreListed(t *testing.T) {
	gateway, _, upstream := assetPlanFixture(t)
	upstream.setSubmit(acceptJob("asset_plan_old"))
	status, _ := assetPlanCreate(t, gateway.URL, "plan:old", "idem-old")
	require.Equal(t, http.StatusAccepted, status)
	require.NoError(t, model.DB.Exec("DELETE FROM tasks").Error)

	rows, err := model.ListTanvaAssetPlanOrdersToMirror(100)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	rows0 := rows[0].ID
	service.SyncTapCanvasAssetPlanLogs(rows0, "")
	rows, err = model.ListTanvaAssetPlanOrdersToMirror(100)
	require.NoError(t, err)
	require.Empty(t, rows, "an in-progress mirror is enough while the order is parked")

	// Settled by the pre-mirror reconciler (no job status, no log): listed again.
	require.NoError(t, model.ReceiveTanvaConsumption(rows0, 500000, "tapcanvas_receipt", `{"tapcanvas_receipt_kind":"asset_plan"}`))
	require.NoError(t, model.SettleTanvaConsumption(rows0))
	require.Equal(t, model.TaskStatus(model.TaskStatusInProgress), assetPlanTasks(t)[0].Status)
	rows, err = model.ListTanvaAssetPlanOrdersToMirror(100)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	service.SyncTapCanvasAssetPlanLogs(rows0, "succeeded")
	tasks := assetPlanTasks(t)
	require.Len(t, tasks, 1)
	require.Equal(t, model.TaskStatus(model.TaskStatusSuccess), tasks[0].Status)
	require.Equal(t, 500000, tasks[0].Quota)
	require.Len(t, assetPlanLogs(t), 1)
}
