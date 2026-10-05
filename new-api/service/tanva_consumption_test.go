package service

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestTanvaConsumptionCrossLanguageSignatureFixture(t *testing.T) {
	stamp := "1791172800"
	body := []byte(`{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hello"}]}`)
	require.Equal(t, "9c1b4b00acd9bd776ad17d363f8c0caf4602bf1c65207a481f7499c3cf1fa770", TanvaRequestSignature("tanva-test-secret", stamp, "POST", "/v1/chat/completions", "usage-1", "0123456789abcdef", body))
	require.Equal(t, "1d3e8f2ae1cd187318f5413f555b29f7a1575782b90c10f7186ea996413f8b21", TanvaRequestSignature("tanva-test-secret", stamp, "GET", "/v1/tanva/consumptions/usage-1", "usage-1", "0123456789abcdef", nil))
	t.Setenv("TANVA_CONSUMPTION_SECRET", "tanva-test-secret")
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/v1/tanva/consumptions/desktop-chat%3Ahex", nil)
	c.Request.Header.Set("X-Tanva-Order-Id", "desktop-chat:hex")
	c.Request.Header.Set("X-Tanva-Order-Hash", "0123456789abcdef")
	c.Request.Header.Set("X-Tanva-Timestamp", stamp)
	sig := TanvaRequestSignature("tanva-test-secret", stamp, "GET", "/v1/tanva/consumptions/desktop-chat%3Ahex", "desktop-chat:hex", "0123456789abcdef", nil)
	c.Request.Header.Set("X-Tanva-Signature", sig)
	require.NoError(t, VerifyTanvaRequest(c, nil, time.Unix(1791172800, 0)))
	require.Error(t, VerifyTanvaRequest(c, nil, time.Unix(1791173101, 0)))
	c.Request.Header.Set("X-Tanva-Order-Hash", "tampered")
	require.Error(t, VerifyTanvaRequest(c, nil, time.Unix(1791172800, 0)))
	payload := []byte(`{"version":1,"eventId":"event-1","revision":3,"orderId":"usage-1","orderHash":"0123456789abcdef","gatewayInstanceId":"tanva-new-api","gatewayRequestId":"request-1","model":"deepseek-v4.1-flash","status":"consumed","priceCurrency":"CNY","costCny":"0.019312","quota":"9656","quotaPerUnit":"500000","startedAt":"2026-10-05T04:00:00Z","settledAt":"2026-10-05T04:01:00Z","usageEvidence":"upstream_tokens"}`)
	envelope := SignTanvaPayload(payload, "tanva-test-secret", time.Unix(1791172800, 0))
	require.Equal(t, "432f5e7ffa266a60807657db83c223c1f0e62585bfe511b806d46432f1c97ccc", envelope.Signature)
	decoded, err := base64.RawURLEncoding.DecodeString(envelope.Payload)
	require.NoError(t, err)
	require.Equal(t, payload, decoded)
}

func TestTanvaConsumptionOutboxHTTPSDeliveryUsesDurablePayloadAndRetries(t *testing.T) {
	calls := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var envelope TanvaSignedEnvelope
		require.NoError(t, common.DecodeJson(r.Body, &envelope))
		require.Equal(t, TanvaHMAC("test-secret", envelope.Timestamp+"\n"+envelope.Payload), envelope.Signature)
		payload, err := base64.RawURLEncoding.DecodeString(envelope.Payload)
		require.NoError(t, err)
		require.Equal(t, `{"orderId":"stable","status":"consumed","costCny":"0.01"}`, string(payload))
		if calls == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
		} else {
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	defer server.Close()
	o := &model.TanvaConsumptionOutbox{Payload: `{"orderId":"stable","status":"consumed","costCny":"0.01"}`}
	require.Error(t, DeliverTanvaOutbox(o, server.URL, "test-secret", server.Client()))
	require.NoError(t, DeliverTanvaOutbox(o, server.URL, "test-secret", server.Client()))
	require.Equal(t, 2, calls)
	require.Error(t, DeliverTanvaOutbox(o, strings.Replace(server.URL, "https:", "http:", 1), "test-secret", server.Client()))
}
