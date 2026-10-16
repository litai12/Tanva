package apimart

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/require"
)

func TestImagePollRetryAfterFormats(t *testing.T) {
	now := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		value string
		want  time.Duration
	}{
		{"30", 30 * time.Second},
		{now.Add(45 * time.Second).Format(http.TimeFormat), 45 * time.Second},
		{"0", 10 * time.Second},
		{"-1", 10 * time.Second},
		{"bad", 10 * time.Second},
		{now.Add(-time.Minute).Format(http.TimeFormat), 10 * time.Second},
		{"9223372036854775807", time.Duration(1<<63 - 1)},
	} {
		require.Equal(t, test.want, nextImagePollRetryDelay(5*time.Second, test.value, now), test.value)
	}
	require.Equal(t, time.Minute, nextImagePollRetryDelay(50*time.Second, "", now))
	require.Equal(t, time.Minute, nextImagePollRetryDelay(time.Duration(1<<63-1), "", now))
}

func TestToAPISImagePollingRecoversTransientQueriesOnSameTask(t *testing.T) {
	imageHTTPClientOnce.Do(service.InitHttpClient)
	for _, status := range []int{http.StatusTooManyRequests, http.StatusServiceUnavailable, 0} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			t.Parallel()
			var polls atomic.Int32
			var invalidRequest atomic.Bool
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.URL.Path != "/v1/images/generations/task-123" {
					invalidRequest.Store(true)
				}
				if polls.Add(1) == 1 {
					if status == 0 {
						w.Header().Set("Content-Length", "100")
						_, _ = w.Write([]byte(`{"id":`))
						return
					}
					w.Header().Set("Retry-After", "0")
					w.WriteHeader(status)
					return
				}
				_, _ = w.Write([]byte(`{"id":"task-123","object":"generation.task","status":"completed","result":{"type":"image","data":[{"url":"https://example.test/result.png"}]}}`))
			}))
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
			defer cancel()
			body, err := (&Adaptor{}).pollUntilTerminal(ctx, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: server.URL}}, "task-123", true, "submit-request")
			require.NoError(t, err)
			require.Contains(t, string(body), "https://example.test/result.png")
			require.Equal(t, int32(2), polls.Load())
			require.False(t, invalidRequest.Load(), "recovery must query the original task without a new POST")
		})
	}
}

func TestToAPISImagePollingRetryAfterWaitCanBeCancelled(t *testing.T) {
	imageHTTPClientOnce.Do(service.InitHttpClient)
	t.Parallel()
	var polls atomic.Int32
	queried := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		polls.Add(1)
		w.Header().Set("Retry-After", "3600")
		w.WriteHeader(http.StatusTooManyRequests)
		close(queried)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		<-queried
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()
	start := time.Now()
	_, err := (&Adaptor{}).pollUntilTerminal(ctx, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: server.URL}}, "task-123", true, "submit-request")
	var apiErr *types.NewAPIError
	require.True(t, errors.As(err, &apiErr))
	require.Equal(t, types.ErrorCode("upstream_image_poll_interrupted"), apiErr.GetErrorCode())
	require.Less(t, time.Since(start), 8*time.Second)
	require.Equal(t, int32(1), polls.Load())
	require.Equal(t, "task-123", apiErr.ToOpenAIError().UpstreamImageTask.TaskID)
	require.True(t, apiErr.ToOpenAIError().UpstreamImageTask.Accepted)
	require.False(t, apiErr.ToOpenAIError().UpstreamImageTask.Terminal)
}

func TestImagePollingDeadlineAlsoCancelsSlowStatusRequest(t *testing.T) {
	imageHTTPClientOnce.Do(service.InitHttpClient)
	previousTimeout := common.RelayTimeout
	common.RelayTimeout = 2
	defer func() { common.RelayTimeout = previousTimeout }()
	var polls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		polls.Add(1)
		<-r.Context().Done()
	}))
	defer server.Close()
	start := time.Now()
	_, err := (&Adaptor{}).pollUntilTerminal(context.Background(), &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: server.URL}}, "task-123", false, "submit-request")
	var apiErr *types.NewAPIError
	require.True(t, errors.As(err, &apiErr))
	require.Equal(t, types.ErrorCode("upstream_image_poll_timeout"), apiErr.GetErrorCode())
	require.Less(t, time.Since(start), 4*time.Second)
	require.Equal(t, int32(1), polls.Load())
	require.True(t, apiErr.ToOpenAIError().UpstreamImageTask.Accepted)
	require.False(t, apiErr.ToOpenAIError().UpstreamImageTask.Terminal)
}
