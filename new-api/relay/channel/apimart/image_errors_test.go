package apimart

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

var imageHTTPClientOnce sync.Once

func finishImageError(t *testing.T, body string, taskID string) *types.NewAPIError {
	t.Helper()
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	resp := synthesizeJSONResponse(http.StatusOK, []byte(body))
	resp.Header.Set(imageTaskIDHeader, taskID)
	resp.Header.Set(imageRequestIDHeader, "submit-request")
	_, err := (&Adaptor{}).finishAsyncImage(ctx, resp, &relaycommon.RelayInfo{})
	require.NotNil(t, err)
	require.True(t, types.IsSkipRetryError(err))
	return err
}

func TestImageTaskFailurePreservesTerminalRefundEvidence(t *testing.T) {
	t.Parallel()
	err := finishImageError(t, `{"id":"task-123","object":"generation.task","status":"failed","request_id":"provider-request","error":{"code":"generation_failed","message":"Input image was rejected by the content safety policy","reason":"invalid_input","upstream_code":"invalid_request_error"},"billing":{"status":"refunded","secret":"never-export"},"prompt":"never-export"}`, "task-123")
	require.Equal(t, http.StatusUnprocessableEntity, err.StatusCode)
	require.Equal(t, types.ErrorCode("generation_failed"), err.GetErrorCode())
	oai := err.ToOpenAIError()
	require.Equal(t, "generation_failed", oai.Code)
	require.Equal(t, &types.UpstreamImageTaskEvidence{
		Provider: "toapis", TaskID: "task-123", RequestID: "provider-request", Status: "failed", Accepted: true, Terminal: true, BillingStatus: "refunded", ErrorCode: "generation_failed", Reason: "invalid_input", UpstreamCode: "invalid_request_error",
	}, oai.UpstreamImageTask)
	encoded, marshalErr := common.Marshal(oai)
	require.NoError(t, marshalErr)
	require.Contains(t, string(encoded), `"upstream_image_task"`)
	require.NotContains(t, string(encoded), "never-export")
	require.NotContains(t, oai.Message, "task-123")
	require.Same(t, err, types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError))
}

func TestImageTaskFailureRequiresCompleteRefundEvidence(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, body string
		status     int
		terminal   bool
	}{
		{"apimart refunded failure", `{"code":200,"data":{"id":"task-123","status":"failed","error":{"code":"invalid_parameter","message":"Unsupported parameter"},"billing":{"status":"refunded"}}}`, 422, true},
		{"cancelled refunded", `{"id":"task-123","object":"generation.task","status":"cancelled","billing":{"status":"refunded"}}`, 422, true},
		{"failed billing unknown", `{"id":"task-123","object":"generation.task","status":"failed","error":{"code":"generation_failed","message":"processing busy"}}`, 502, true},
		{"failed charged", `{"id":"task-123","object":"generation.task","status":"failed","billing":{"status":"charged"}}`, 502, true},
		{"pending refunded is not final", `{"id":"task-123","object":"generation.task","status":"pending","billing":{"status":"refunded"}}`, 502, false},
		{"unknown status", `{"id":"task-123","object":"generation.task","status":"unrecognized","billing":{"status":"refunded"}}`, 502, false},
		{"error envelope is not task failure", `{"code":400,"error":{"code":"invalid_parameter","message":"status unavailable"},"billing":{"status":"refunded"}}`, 502, false},
		{"completed missing results", `{"id":"task-123","object":"generation.task","status":"completed","billing":{"status":"refunded"}}`, 502, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := finishImageError(t, tc.body, "task-123")
			require.Equal(t, tc.status, err.StatusCode)
			evidence := err.ToOpenAIError().UpstreamImageTask
			require.NotNil(t, evidence)
			require.Equal(t, "task-123", evidence.TaskID)
			require.True(t, evidence.Accepted)
			require.Equal(t, tc.terminal, evidence.Terminal)
		})
	}
}

func TestImageTaskMismatchedOrMissingReceiptNeverBecomesRefundedRejection(t *testing.T) {
	t.Parallel()
	err := finishImageError(t, `{"id":"different-task","object":"generation.task","status":"failed","billing":{"status":"refunded"}}`, "task-123")
	require.Equal(t, http.StatusBadGateway, err.StatusCode)
	require.False(t, err.ToOpenAIError().UpstreamImageTask.Terminal)
	require.Equal(t, "task-123", err.ToOpenAIError().UpstreamImageTask.TaskID)
	err = finishImageError(t, `{"object":"generation.task","status":"failed","billing":{"status":"refunded"}}`, "")
	require.Equal(t, http.StatusBadGateway, err.StatusCode)
	require.False(t, err.ToOpenAIError().UpstreamImageTask.Accepted)
}

func TestImageTaskErrorDoesNotExposeMalformedOrOversizedBody(t *testing.T) {
	t.Parallel()
	err := finishImageError(t, "sensitive raw upstream body", "task-123")
	require.NotContains(t, err.Error(), "sensitive raw")
	message := strings.Repeat("private prompt ", 300)
	err = imageTaskError(message, "generation_failed", 502, types.UpstreamImageTaskEvidence{Status: "unknown"})
	require.NotContains(t, err.Error(), "private prompt")
	err = imageTaskError("Bearer private-token data:image/png;base64,private-data sk-secretkey "+strings.Repeat("a", 200), "generation_failed", 502, types.UpstreamImageTaskEvidence{Status: "unknown"})
	require.NotContains(t, err.Error(), "private-token")
	require.NotContains(t, err.Error(), "private-data")
	require.NotContains(t, err.Error(), "sk-secretkey")
}

func TestImagePollingPendingTimeoutRetainsAcceptedTask(t *testing.T) {
	imageHTTPClientOnce.Do(service.InitHttpClient)
	t.Parallel()
	var polls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		polls.Add(1)
		_, _ = w.Write([]byte(`{"id":"task-123","object":"generation.task","status":"processing"}`))
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
	defer cancel()
	_, pollErr := (&Adaptor{}).pollUntilTerminal(ctx, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: server.URL}}, "task-123", true, "submit-request")
	var apiErr *types.NewAPIError
	require.True(t, errors.As(pollErr, &apiErr))
	require.Equal(t, http.StatusGatewayTimeout, apiErr.StatusCode)
	require.Equal(t, int32(1), polls.Load())
	evidence := apiErr.ToOpenAIError().UpstreamImageTask
	require.Equal(t, "task-123", evidence.TaskID)
	require.Equal(t, "submit-request", evidence.RequestID)
	require.Equal(t, "processing", evidence.Status)
	require.True(t, evidence.Accepted)
	require.False(t, evidence.Terminal)
	require.True(t, types.IsSkipRetryError(apiErr))
}

func TestImagePollingHTTPRejectionDoesNotRejectAcceptedTask(t *testing.T) {
	imageHTTPClientOnce.Do(service.InitHttpClient)
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"code":"invalid_parameter","message":"sensitive raw status body"}}`))
	}))
	defer server.Close()
	_, pollErr := (&Adaptor{}).pollUntilTerminal(context.Background(), &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: server.URL}}, "task-123", true, "submit-request")
	var apiErr *types.NewAPIError
	require.True(t, errors.As(pollErr, &apiErr))
	require.Equal(t, http.StatusBadGateway, apiErr.StatusCode)
	require.True(t, apiErr.ToOpenAIError().UpstreamImageTask.Accepted)
	require.False(t, apiErr.ToOpenAIError().UpstreamImageTask.Terminal)
	require.NotContains(t, apiErr.Error(), "sensitive raw")
}

func TestImageSubmissionHTTP200FlatErrorPreservesProviderCode(t *testing.T) {
	imageHTTPClientOnce.Do(service.InitHttpClient)
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-ID", "provider-request")
		_, _ = w.Write([]byte(`{"code":"invalid_request","message":"Unsupported dimensions"}`))
	}))
	defer server.Close()
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
	_, submitErr := (&Adaptor{}).doAsyncImage(ctx, &relaycommon.RelayInfo{
		RelayMode:   relayconstant.RelayModeImagesGenerations,
		ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: server.URL},
	}, strings.NewReader(`{"prompt":"test"}`))
	var apiErr *types.NewAPIError
	require.True(t, errors.As(submitErr, &apiErr))
	require.Equal(t, types.ErrorCode("invalid_request"), apiErr.GetErrorCode())
	require.Equal(t, "provider-request", apiErr.ToOpenAIError().UpstreamImageTask.RequestID)
	require.False(t, apiErr.ToOpenAIError().UpstreamImageTask.Accepted)
	require.False(t, apiErr.ToOpenAIError().UpstreamImageTask.Terminal)
}
