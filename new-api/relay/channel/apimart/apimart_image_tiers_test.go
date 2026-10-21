package apimart

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestAPIMartPublicImageTiersPreserveProviderAndBillableInputs(t *testing.T) {
	for _, baseURL := range []string{"https://api.apimart.ai", "https://api.aishuch.com"} {
		for _, publicModel := range []string{"gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare-vip", "gpt-image-2.5-sunburst-vip", constant.ToAPISNanoBanana21, constant.ToAPISNanoBanana21Official} {
			t.Run(baseURL+"/"+publicModel, func(t *testing.T) {
				upstream, ok := constant.APIMartImageTierModel(publicModel)
				require.True(t, ok)
				var request dto.ImageRequest
				require.NoError(t, common.Unmarshal([]byte(`{"model":"`+publicModel+`","prompt":"edit","size":"16:9","resolution":"4K","quality":"max","n":1,"image_urls":["https://example.test/ref.png"],"official_fallback":false,"metadata":{"version":"wrong"}}`), &request))
				// Relay model mapping happens before conversion, so request.Model
				// is deliberately the native identity while OriginModelName stays public.
				request.Model = upstream
				payload, err := (&Adaptor{}).ConvertImageRequest(nil, &relaycommon.RelayInfo{OriginModelName: publicModel, ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: upstream, ChannelBaseUrl: baseURL}}, request)
				require.NoError(t, err)
				encoded, err := common.Marshal(payload)
				require.NoError(t, err)
				var got map[string]any
				require.NoError(t, common.Unmarshal(encoded, &got))
				require.Equal(t, upstream, got["model"])
				require.Equal(t, float64(1), got["n"])
				require.Equal(t, []any{"https://example.test/ref.png"}, got["image_urls"])
				require.NotContains(t, got, "aspect_ratio")
				require.NotContains(t, got, "metadata")
				if constant.IsToAPISImage25VIP(publicModel) {
					require.Equal(t, "3840x2160", got["size"])
					require.Equal(t, "max", got["quality"])
					require.NotContains(t, got, "resolution")
				} else {
					require.Equal(t, "16:9", got["size"])
					require.Equal(t, "4K", got["resolution"])
					if upstream == "gpt-image-2.5-ext" {
						require.Equal(t, strings.TrimPrefix(publicModel, "gpt-image-2.5-"), got["version"])
						require.NotContains(t, got, "quality")
						require.NotContains(t, got, "official_fallback")
					} else {
						require.Equal(t, false, got["official_fallback"])
					}
				}
			})
		}
	}
}

func TestAPIMartNanoDoesNotUseToAPISMetadata(t *testing.T) {
	for _, model := range []string{constant.ToAPISNanoBanana21, constant.ToAPISNanoBanana21Official} {
		require.False(t, usesToAPISNestedImageMetadata(model, "https://api.apimart.ai"))
		require.False(t, usesToAPISNestedImageMetadata(model, "https://toapis.cn.example.test"))
		require.True(t, usesToAPISNestedImageMetadata(model, "https://toapis.cn"))
	}
}

func TestAPIMartExtKeepsNestedCallerSizeAndResolution(t *testing.T) {
	var request dto.ImageRequest
	require.NoError(t, common.Unmarshal([]byte(`{"model":"gpt-image-2.5-ext","prompt":"test","metadata":{"size":"16:9","resolution":"4K"}}`), &request))
	payload, err := (&Adaptor{}).ConvertImageRequest(nil, &relaycommon.RelayInfo{OriginModelName: "gpt-image-2.5-flare", ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-image-2.5-ext", ChannelBaseUrl: "https://api.apimart.ai"}}, request)
	require.NoError(t, err)
	encoded, err := common.Marshal(payload)
	require.NoError(t, err)
	var got map[string]any
	require.NoError(t, common.Unmarshal(encoded, &got))
	require.Equal(t, "16:9", got["size"])
	require.Equal(t, "4K", got["resolution"])
}

func TestAPIMartImageRejectsUnsupportedExtSizeAndResolution(t *testing.T) {
	for _, body := range []string{
		`{"model":"gpt-image-2.5-flare","size":"1:2","resolution":"1K"}`,
		`{"model":"gpt-image-2.5-flare","size":"1:1","resolution":"512"}`,
		`{"model":"gemini-nano-banana-2.1","size":"1:1","resolution":"0.5K"}`,
	} {
		var request dto.ImageRequest
		require.NoError(t, common.Unmarshal([]byte(body), &request))
		upstream, _ := constant.APIMartImageTierModel(request.Model)
		_, err := (&Adaptor{}).ConvertImageRequest(nil, &relaycommon.RelayInfo{OriginModelName: request.Model, ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: upstream, ChannelBaseUrl: "https://api.apimart.ai"}}, request)
		require.Error(t, err)
	}
}

func TestAPIMartExtImageHeadersBindIdempotencyToGatewayRequest(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set(common.RequestIdKey, "gateway-request")
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
	for _, baseURL := range []string{"https://api.apimart.ai", "https://api.aishuch.com", "https://toapis.cn"} {
		header := http.Header{}
		require.NoError(t, (&Adaptor{}).SetupRequestHeader(ctx, &header, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: baseURL, UpstreamModelName: "gpt-image-2.5-ext"}}))
		if constant.IsAPIMartImageBaseURL(baseURL) {
			require.Equal(t, "2026-07-27", header.Get("X-APIMart-Response-Version"))
			require.Equal(t, "gateway-request", header.Get("Idempotency-Key"))
		} else {
			require.Empty(t, header.Get("X-APIMart-Response-Version"))
			require.Empty(t, header.Get("Idempotency-Key"))
		}
	}
}

func TestAPIMartVersionedImageSubmissionPollsOriginalTask(t *testing.T) {
	imageHTTPClientOnce.Do(service.InitHttpClient)
	for _, status := range []int{http.StatusOK, http.StatusAccepted} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			t.Parallel()
			var posts, gets atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.Method + " " + r.URL.Path {
				case "POST /v1/images/generations":
					posts.Add(1)
					w.WriteHeader(status)
					fmt.Fprintf(w, `{"code":%d,"request_id":"submit-request","data":{"id":"task-123","object":"generation.task","status":"pending","poll_url":"https://other.test/never-follow"}}`, status)
				case "GET /v1/tasks/task-123":
					gets.Add(1)
					io.WriteString(w, `{"code":200,"data":{"id":"task-123","status":"completed","result":{"images":[{"url":["https://example.test/generated.png"]}]}}}`)
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			deadline, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil).WithContext(deadline)
			response, err := (&Adaptor{}).doAsyncImage(ctx, &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeImagesGenerations, ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: server.URL}}, strings.NewReader(`{"model":"gpt-image-2.5-ext","prompt":"test"}`))
			require.NoError(t, err)
			_, apiErr := (&Adaptor{}).finishAsyncImage(ctx, response.(*http.Response), &relaycommon.RelayInfo{})
			require.Nil(t, apiErr)
			require.Equal(t, int32(1), posts.Load())
			require.Equal(t, int32(1), gets.Load())
		})
	}
}
