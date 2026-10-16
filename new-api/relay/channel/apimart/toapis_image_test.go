package apimart

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	taskapimart "github.com/QuantumNous/new-api/relay/channel/task/apimart"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/require"
)

func TestToAPISVIPImagePayloadMatchesBilledInputs(t *testing.T) {
	for _, model := range []string{"gpt-image-2.5-flare-vip", "gpt-image-2.5-sunburst-vip"} {
		var request dto.ImageRequest
		require.NoError(t, common.Unmarshal([]byte(`{"model":"`+model+`","prompt":"edit","size":"16:9","quality":"auto","resolution":"2K","reference_images":["https://example.test/ref.png"],"background":"transparent","metadata":{"quality":"max","n":1}}`), &request))
		payload, err := (&Adaptor{}).ConvertImageRequest(nil, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: model}}, request)
		require.NoError(t, err)
		encoded, err := common.Marshal(payload)
		require.NoError(t, err)
		var got map[string]any
		require.NoError(t, common.Unmarshal(encoded, &got))
		require.Equal(t, model, got["model"])
		require.Equal(t, "2048x1152", got["size"])
		require.Equal(t, "high", got["quality"])
		require.Equal(t, float64(1), got["n"])
		require.Equal(t, "transparent", got["background"])
		require.Equal(t, []any{"https://example.test/ref.png"}, got["image_urls"])
		require.NotContains(t, got, "resolution")
		require.NotContains(t, got, "aspect_ratio")
		require.NotContains(t, got, "reference_images")
	}
}

func TestToAPISVerifiedVIP4KPayloadKeepsExplicitRetailTier(t *testing.T) {
	for _, test := range []struct{ model, ratio, pixels string }{
		{"gpt-image-2.5-sunburst-vip", "1:1", "2880x2880"},
		{"gpt-image-2.5-flare-vip", "16:9", "3840x2160"},
	} {
		var request dto.ImageRequest
		require.NoError(t, common.Unmarshal([]byte(`{"model":"`+test.model+`","prompt":"test","size":"`+test.ratio+`","resolution":"4K","quality":"high"}`), &request))
		// Quota estimation precedes conversion, which normalizes once more.
		request, err := dto.NormalizeToAPISImageRequest(request)
		require.NoError(t, err)
		require.InDelta(t, .8, request.GetTokenCountMeta().ImagePriceRatio*.2, 1e-12)
		payload, err := (&Adaptor{}).ConvertImageRequest(nil, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: test.model, ChannelBaseUrl: "https://toapis.cn"}}, request)
		require.NoError(t, err)
		encoded, err := common.Marshal(payload)
		require.NoError(t, err)
		var got map[string]any
		require.NoError(t, common.Unmarshal(encoded, &got))
		require.Equal(t, test.pixels, got["size"])
		require.Equal(t, "high", got["quality"])
		require.NotContains(t, got, "resolution")
		require.NotContains(t, got, "aspect_ratio")
	}
}

func TestToAPISNano21UsesNestedResolution(t *testing.T) {
	for _, model := range []string{"gemini-nano-banana-2.1", "gemini-nano-banana-2.1-official"} {
		var request dto.ImageRequest
		require.NoError(t, common.Unmarshal([]byte(`{"model":"`+model+`","prompt":"test","size":"4:3","response_format":"url","metadata":{"resolution":"4K","custom":"preserved"},"image_urls":["https://example.test/ref.png"]}`), &request))
		payload, err := (&Adaptor{}).ConvertImageRequest(nil, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: request.Model}}, request)
		require.NoError(t, err)
		encoded, err := common.Marshal(payload)
		require.NoError(t, err)
		var got map[string]any
		require.NoError(t, common.Unmarshal(encoded, &got))
		require.Equal(t, model, got["model"])
		require.Equal(t, "4:3", got["size"])
		require.Equal(t, "url", got["response_format"])
		require.Equal(t, []any{"https://example.test/ref.png"}, got["image_urls"])
		require.Equal(t, map[string]any{"resolution": "4K", "custom": "preserved"}, got["metadata"])
		require.Equal(t, float64(1), got["n"])
		require.NotContains(t, got, "resolution")
		require.NotContains(t, got, "aspect_ratio")
		require.NotContains(t, got, "custom")
	}
}

func TestToAPISGeminiImageMetadataContract(t *testing.T) {
	for _, model := range []string{"gemini-nano-banana-2.1", "gemini-nano-banana-2.1-official"} {
		for _, baseURL := range []string{"https://toapis.cn", "https://api.toapis.com", "https://toapis.xyz"} {
			t.Run(model+"/"+baseURL, func(t *testing.T) {
				var request dto.ImageRequest
				require.NoError(t, common.Unmarshal([]byte(`{"model":"`+model+`","prompt":"test","size":"16:9","resolution":"4K","google_search":false,"google_image_search":false,"metadata":{"resolution":"4K","google_search":true,"google_image_search":true,"custom":"preserved"}}`), &request))
				payload, err := (&Adaptor{}).ConvertImageRequest(nil, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: model, ChannelBaseUrl: baseURL}}, request)
				require.NoError(t, err)
				encoded, err := common.Marshal(payload)
				require.NoError(t, err)
				var got map[string]any
				require.NoError(t, common.Unmarshal(encoded, &got))
				require.Equal(t, "16:9", got["size"])
				require.Equal(t, map[string]any{"resolution": "4K", "google_search": false, "google_image_search": false, "custom": "preserved"}, got["metadata"])
				for _, key := range []string{"resolution", "google_search", "google_image_search", "custom", "aspect_ratio"} {
					require.NotContains(t, got, key)
				}
			})
		}
	}
}

func TestToAPISLegacyNanoMetadataContract(t *testing.T) {
	for _, baseURL := range []string{"https://toapis.cn", "https://api.toapis.com", "https://toapis.xyz"} {
		model := "gemini-3.1-flash-image-preview"
		require.True(t, usesToAPISNestedImageMetadata(model, baseURL))
		var request dto.ImageRequest
		require.NoError(t, common.Unmarshal([]byte(`{"model":"gemini-3.1-flash-image-preview","prompt":"test","size":"16:9","resolution":"4K","google_search":false,"google_image_search":false,"metadata":{"resolution":"4K","google_search":true,"google_image_search":true,"custom":"preserved"}}`), &request))
		payload := &taskapimart.SubmitPayload{Model: model, Size: "16:9", Resolution: "4K", AspectRatio: "16:9", Extras: map[string]any{"google_search": false, "google_image_search": false, "custom": "preserved"}}
		nestToAPISImageMetadata(payload, request, "4K")
		encoded, err := common.Marshal(payload)
		require.NoError(t, err)
		var got map[string]any
		require.NoError(t, common.Unmarshal(encoded, &got))
		require.Equal(t, "16:9", got["size"])
		require.Equal(t, map[string]any{"resolution": "4K", "google_search": false, "google_image_search": false, "custom": "preserved"}, got["metadata"])
		for _, key := range []string{"resolution", "google_search", "google_image_search", "custom", "aspect_ratio"} {
			require.NotContains(t, got, key)
		}
	}
}

func TestToAPISLegacyNanoNestedOnlyAndHalfK(t *testing.T) {
	for _, test := range []struct{ extra, resolution string }{
		{`"metadata":{"resolution":"0.5K","google_search":false}`, ""},
		{`"resolution":"512","google_search":false`, "512"},
	} {
		var request dto.ImageRequest
		require.NoError(t, common.Unmarshal([]byte(`{"model":"gemini-3.1-flash-image-preview","prompt":"test",`+test.extra+`}`), &request))
		payload := &taskapimart.SubmitPayload{Model: request.Model, Resolution: test.resolution, Extras: map[string]any{}}
		if test.resolution != "" {
			payload.Extras["google_search"] = false
		}
		nestToAPISImageMetadata(payload, request, test.resolution)
		encoded, err := common.Marshal(payload)
		require.NoError(t, err)
		var got map[string]any
		require.NoError(t, common.Unmarshal(encoded, &got))
		require.Equal(t, map[string]any{"resolution": "0.5K", "google_search": false}, got["metadata"])
		require.NotContains(t, got, "resolution")
		require.NotContains(t, got, "google_search")
	}
}

func TestLegacyNanoOtherProvidersRetainContract(t *testing.T) {
	for _, baseURL := range []string{"https://api.apimart.ai", "https://nottoapis.cn", "https://toapis.cn.example.test"} {
		require.False(t, usesToAPISNestedImageMetadata("gemini-3.1-flash-image-preview", baseURL))
	}
	require.False(t, usesToAPISNestedImageMetadata("gpt-image-2.5-flare", "https://toapis.cn"))
}

func TestToAPISGeminiMetadataPreservesOtherDocumentedImageModels(t *testing.T) {
	for _, model := range []string{"gemini-3.1-flash-image-preview-vip", "gemini-3.1-flash-image-official", "gemini-3-pro-image-preview", "nano-banana-pro", "gemini-3-pro-image-official", "gemini-2.5-flash-image-preview", "nano-banana"} {
		t.Run(model, func(t *testing.T) {
			require.True(t, usesToAPISNestedImageMetadata(model, "https://toapis.cn"))
			require.False(t, usesToAPISNestedImageMetadata(model, "https://api.apimart.ai"))
			var request dto.ImageRequest
			require.NoError(t, common.Unmarshal([]byte(`{"metadata":{"resolution":"1K","temperature":0,"thinkingConfig":{"thinkingBudget":0}},"orientation":"portrait"}`), &request))
			payload := &taskapimart.SubmitPayload{Model: model, Size: "3:4", Resolution: "1K", AspectRatio: "3:4", Extras: map[string]any{"resolution": "1K", "temperature": 0, "orientation": "portrait", "thinkingConfig": map[string]any{"thinkingBudget": 0}}}
			nestToAPISImageMetadata(payload, request, "1K")
			encoded, err := common.Marshal(payload)
			require.NoError(t, err)
			var got map[string]any
			require.NoError(t, common.Unmarshal(encoded, &got))
			require.Equal(t, "3:4", got["size"])
			require.Equal(t, map[string]any{"resolution": "1K", "temperature": float64(0), "orientation": "portrait", "thinkingConfig": map[string]any{"thinkingBudget": float64(0)}}, got["metadata"])
			for _, key := range []string{"resolution", "aspect_ratio", "orientation", "temperature", "thinkingConfig"} {
				require.NotContains(t, got, key)
			}
		})
	}
}

func TestToAPISGemini25OfficialPreservesNativeMetadataWithoutInventingResolution(t *testing.T) {
	var request dto.ImageRequest
	require.NoError(t, common.Unmarshal([]byte(`{"metadata":{"temperature":0,"thinkingConfig":{"thinkingBudget":0}}}`), &request))
	model := "gemini-2.5-flash-image-official"
	require.True(t, usesToAPISNestedImageMetadata(model, "https://toapis.cn"))
	require.False(t, usesToAPISNestedImageMetadata(model, "https://api.apimart.ai"))
	payload := &taskapimart.SubmitPayload{Model: model, Extras: map[string]any{"temperature": 0, "thinkingConfig": map[string]any{"thinkingBudget": 0}}}
	nestToAPISImageMetadata(payload, request, "2K")
	encoded, err := common.Marshal(payload)
	require.NoError(t, err)
	var got map[string]any
	require.NoError(t, common.Unmarshal(encoded, &got))
	require.Equal(t, map[string]any{"temperature": float64(0), "thinkingConfig": map[string]any{"thinkingBudget": float64(0)}}, got["metadata"])
	require.NotContains(t, got, "resolution")
}

func TestToAPISGPTImagesUseSizeAndOrdinary25FixedQuality(t *testing.T) {
	for _, model := range []string{"gpt-image-2", "gpt-image-2-official", "gpt-image-2-vip", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"} {
		for _, baseURL := range []string{"https://toapis.cn", "https://api.toapis.com", "https://api.apimart.ai"} {
			payload := &taskapimart.SubmitPayload{Model: model, Size: "16:9", AspectRatio: "16:9", Resolution: "2K", Extras: map[string]any{"quality": "max", "aspect_ratio": "16:9", "official_fallback": false}}
			normalizeToAPISGPTImagePayload(payload, baseURL)
			encoded, err := common.Marshal(payload)
			require.NoError(t, err)
			var got map[string]any
			require.NoError(t, common.Unmarshal(encoded, &got))
			require.Equal(t, "16:9", got["size"])
			require.Equal(t, "2K", got["resolution"])
			require.Equal(t, false, got["official_fallback"])
			if baseURL == "https://api.apimart.ai" {
				require.Equal(t, "16:9", got["aspect_ratio"])
				require.Equal(t, "max", got["quality"])
			} else {
				require.NotContains(t, got, "aspect_ratio")
				if model == "gpt-image-2.5-flare" || model == "gpt-image-2.5-sunburst" {
					require.Equal(t, "high", got["quality"])
				} else {
					require.Equal(t, "max", got["quality"])
				}
			}
		}
	}
}
