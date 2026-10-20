package service_test

import (
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/stretchr/testify/require"
)

func TestTapCanvasAmountQuotaUsesChannelRatioAndRoundsUp(t *testing.T) {
	quota, err := service.TapCanvasAmountQuota("0.5", 1.5)
	require.NoError(t, err)
	require.EqualValues(t, 375000, quota)
	quota, err = service.TapCanvasAmountQuota("0.000001", 1)
	require.NoError(t, err)
	require.EqualValues(t, 1, quota)
	quota, err = service.TapCanvasAmountQuota("0", 1)
	require.NoError(t, err)
	require.EqualValues(t, 0, quota)
	for _, bad := range []string{"", "-1", "abc"} {
		_, err := service.TapCanvasAmountQuota(bad, 1)
		require.Error(t, err, bad)
	}
	_, err = service.TapCanvasAmountQuota("1", 0)
	require.Error(t, err)
}

// tapCanvasUpstream streams one xiaot turn whose final usage carries the turn
// total, and serves the facade's receipt route next to it.
func tapCanvasUpstream(usage string, receipt *atomic.Value, receiptCalls *atomic.Int32) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			receiptCalls.Add(1)
			if r.URL.Path != "/v1/billing/receipts/req-turn" || r.Header.Get("Authorization") != "Bearer local-only-fixture" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, receipt.Load().(string))
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"id\":\"chatcmpl-req-turn\",\"object\":\"chat.completion.chunk\",\"model\":\"xiaot-agent-deepseek-v4-flash\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"done\"},\"finish_reason\":null}]}\n\n")
		fmt.Fprintf(w, "data: {\"id\":\"chatcmpl-req-turn\",\"object\":\"chat.completion.chunk\",\"model\":\"xiaot-agent-deepseek-v4-flash\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":%s}\n\ndata: [DONE]\n\n", usage)
	})
}

func setChannelPriceRatio(t *testing.T, channel *model.Channel, ratio string) {
	t.Helper()
	setting := `{"price_ratio":` + ratio + `}`
	channel.Setting = &setting
	require.NoError(t, model.DB.Model(&model.Channel{}).Where("id = ?", channel.Id).Update("setting", setting).Error)
}

func runXiaotTurn(t *testing.T, gatewayURL, orderID string) {
	t.Helper()
	body := []byte(`{"model":"xiaot-agent-deepseek-v4-flash","messages":[{"role":"user","content":"复刻这段视频"}],"stream":true}`)
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(signedTanvaFixtureRequest(t, "POST", gatewayURL+"/v1/chat/completions", orderID, "hash", "amount-fixture-secret", body))
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)
	_, _ = fmt.Fscan(resp.Body)
}

func TestXiaotTurnSettlesUpstreamAmountTimesChannelRatio(t *testing.T) {
	t.Setenv("TANVA_CONSUMPTION_SECRET", "amount-fixture-secret")
	var receipt atomic.Value
	var receiptCalls atomic.Int32
	usage := `{"prompt_tokens":0,"completion_tokens":12,"total_tokens":12,"tapcanvas_total_credits":50,"tapcanvas_amount_cny":"0.5","tapcanvas_billing_status":"complete","tapcanvas_request_id":"req-turn"}`
	gateway, channel := tanvaRelayFixture(t, tapCanvasUpstream(usage, &receipt, &receiptCalls))
	setChannelPriceRatio(t, channel, "1.5")
	runXiaotTurn(t, gateway.URL, "amount:order")
	require.Eventually(t, func() bool {
		o, err := model.GetTanvaConsumption(720, 720, "amount:order")
		return err == nil && o.Status == "consumed"
	}, 5*time.Second, 20*time.Millisecond)
	o, err := model.GetTanvaConsumption(720, 720, "amount:order")
	require.NoError(t, err)
	require.EqualValues(t, 375000, o.ActualQuota)
	require.Equal(t, "0.75", o.Receipt().CostCny)
	require.Equal(t, "tapcanvas_amount", o.Receipt().UsageEvidence)
	var user model.User
	require.NoError(t, model.DB.First(&user, 720).Error)
	require.Equal(t, 625000, user.Quota)
	require.EqualValues(t, 0, receiptCalls.Load())
}

func TestXiaotPendingTurnWaitsForUpstreamReceipt(t *testing.T) {
	t.Setenv("TANVA_CONSUMPTION_SECRET", "amount-fixture-secret")
	var receipt atomic.Value
	receipt.Store(`{"status":"pending","total_status":"pending","total_amount_cny":null}`)
	var receiptCalls atomic.Int32
	usage := `{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0,"tapcanvas_total_credits":20,"tapcanvas_amount_cny":"0.2","tapcanvas_billing_status":"pending","tapcanvas_request_id":"req-turn"}`
	gateway, channel := tanvaRelayFixture(t, tapCanvasUpstream(usage, &receipt, &receiptCalls))
	setChannelPriceRatio(t, channel, "1.5")
	runXiaotTurn(t, gateway.URL, "pending:order")
	require.Eventually(t, func() bool {
		o, err := model.GetTanvaConsumption(720, 720, "pending:order")
		return err == nil && o.ErrorCode == model.TanvaUpstreamReceiptPending
	}, 5*time.Second, 20*time.Millisecond)
	o, err := model.GetTanvaConsumption(720, 720, "pending:order")
	require.NoError(t, err)
	require.Equal(t, "reconciliation_required", o.Status)
	var user model.User
	require.NoError(t, model.DB.First(&user, 720).Error)
	require.Equal(t, 995000, user.Quota, "the pre-consumed quota stays reserved; nothing is invented")

	// Not settled upstream yet: the check is deferred, the order untouched.
	now := time.Now().Unix()
	service.ReconcileTapCanvasReceipts(now, nil)
	require.EqualValues(t, 1, receiptCalls.Load())
	o, _ = model.GetTanvaConsumption(720, 720, "pending:order")
	require.Equal(t, "reconciliation_required", o.Status)
	service.ReconcileTapCanvasReceipts(now+1, nil)
	require.EqualValues(t, 1, receiptCalls.Load(), "deferred check is not repeated before its retry time")

	receipt.Store(`{"status":"settled","total_status":"settled","total_amount_cny":"0.3"}`)
	service.ReconcileTapCanvasReceipts(now+61, nil)
	o, err = model.GetTanvaConsumption(720, 720, "pending:order")
	require.NoError(t, err)
	require.Equal(t, "consumed", o.Status)
	require.EqualValues(t, 225000, o.ActualQuota)
	require.Equal(t, "tapcanvas_receipt", o.Receipt().UsageEvidence)
	require.NoError(t, model.DB.First(&user, 720).Error)
	require.Equal(t, 775000, user.Quota)
	service.ReconcileTapCanvasReceipts(now+200, nil)
	require.EqualValues(t, 2, receiptCalls.Load(), "a settled order is not polled again")
}
