package gemini

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// sseLine 把一个 GeminiChatResponse chunk 编码成一条 SSE data 行。
func sseLine(t *testing.T, chunk dto.GeminiChatResponse) string {
	t.Helper()
	b, err := common.Marshal(chunk)
	require.NoError(t, err)
	return "data: " + string(b) + "\n"
}

func imageChunk(mime, data string) dto.GeminiChatResponse {
	return dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{
			{
				Content: dto.GeminiChatContent{
					Role: "model",
					Parts: []dto.GeminiPart{
						{InlineData: &dto.GeminiInlineData{MimeType: mime, Data: data}},
					},
				},
			},
		},
	}
}

func newImagineStreamContext() (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
	return c, rec
}

func newImagineStreamInfo() *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		OriginModelName: "gemini-3-pro-image-preview",
		RelayMode:       relayconstant.RelayModeImagesGenerations,
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-3-pro-image-preview",
		},
	}
}

func respFromSSE(body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader([]byte(body))),
	}
}

// 上游多 chunk SSE（先 thinking 文本、再两张图、末尾带 usage）→ 下游一次性 images JSON。
func TestGeminiImagineImageStreamHandlerAssemblesMultiChunk(t *testing.T) {
	thinking := dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{
			{Content: dto.GeminiChatContent{Role: "model", Parts: []dto.GeminiPart{{Text: "drawing..."}}}},
		},
	}
	usageChunk := dto.GeminiChatResponse{
		UsageMetadata: dto.GeminiUsageMetadata{
			PromptTokenCount: 12, CandidatesTokenCount: 30, TotalTokenCount: 42,
		},
	}
	body := sseLine(t, thinking) +
		sseLine(t, imageChunk("image/png", "AAAAfirst")) +
		sseLine(t, imageChunk("image/png", "BBBBsecond")) +
		sseLine(t, usageChunk) +
		"data: [DONE]\n"

	c, rec := newImagineStreamContext()
	info := newImagineStreamInfo()

	usage, apiErr := GeminiImagineImageStreamHandler(c, info, respFromSSE(body))
	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	require.Equal(t, 42, usage.TotalTokens)

	require.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	require.False(t, strings.Contains(rec.Body.String(), "data:"), "下游 body 不应是 SSE")

	var out dto.ImageResponse
	require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &out))
	require.Len(t, out.Data, 2)
	require.Equal(t, "AAAAfirst", out.Data[0].B64Json)
	require.Equal(t, "BBBBsecond", out.Data[1].B64Json)
}

// 没有 usageMetadata 时，兜底计费应与非流式 handler 一致（258 * 图片数）。
func TestGeminiImagineImageStreamHandlerUsageFallback(t *testing.T) {
	body := sseLine(t, imageChunk("image/png", "ONLYIMAGE")) + "data: [DONE]\n"

	c, _ := newImagineStreamContext()
	info := newImagineStreamInfo()

	usage, apiErr := GeminiImagineImageStreamHandler(c, info, respFromSSE(body))
	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	require.Equal(t, 258, usage.TotalTokens)
}

// prompt 被拦截且无图片 → 返回 PromptBlocked / 400。
func TestGeminiImagineImageStreamHandlerPromptBlocked(t *testing.T) {
	reason := "SAFETY"
	blocked := dto.GeminiChatResponse{
		PromptFeedback: &dto.GeminiChatPromptFeedback{BlockReason: &reason},
	}
	body := sseLine(t, blocked) + "data: [DONE]\n"

	c, _ := newImagineStreamContext()
	info := newImagineStreamInfo()

	usage, apiErr := GeminiImagineImageStreamHandler(c, info, respFromSSE(body))
	require.Nil(t, usage)
	require.NotNil(t, apiErr)
	require.Equal(t, http.StatusBadRequest, apiErr.StatusCode)
	require.Equal(t, types.ErrorCodePromptBlocked, apiErr.GetErrorCode())
}

// 无图片、无 block → 报错而不是静默返回空图。
func TestGeminiImagineImageStreamHandlerEmptyErrors(t *testing.T) {
	textOnly := dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{
			{Content: dto.GeminiChatContent{Role: "model", Parts: []dto.GeminiPart{{Text: "no image"}}}},
		},
	}
	body := sseLine(t, textOnly) + "data: [DONE]\n"

	c, _ := newImagineStreamContext()
	info := newImagineStreamInfo()

	usage, apiErr := GeminiImagineImageStreamHandler(c, info, respFromSSE(body))
	require.Nil(t, usage)
	require.NotNil(t, apiErr)
}

// GetRequestURL：开关开启 + imagine 出图 → 上游用 streamGenerateContent。
func TestGetRequestURLImagineStreamSwitch(t *testing.T) {
	adaptor := &Adaptor{}

	base := func(flag bool) *relaycommon.RelayInfo {
		return &relaycommon.RelayInfo{
			OriginModelName: "gemini-3-pro-image-preview",
			RelayMode:       relayconstant.RelayModeImagesGenerations,
			ChannelMeta: &relaycommon.ChannelMeta{
				UpstreamModelName: "gemini-3-pro-image-preview",
				ChannelBaseUrl:    "https://gen.example.com",
				ChannelSetting:    dto.ChannelSettings{ImageUpstreamStream: flag},
			},
		}
	}

	onURL, err := adaptor.GetRequestURL(base(true))
	require.NoError(t, err)
	require.Contains(t, onURL, ":streamGenerateContent?alt=sse")

	offURL, err := adaptor.GetRequestURL(base(false))
	require.NoError(t, err)
	require.Contains(t, offURL, ":generateContent")
	require.NotContains(t, offURL, "streamGenerateContent")
}
