package apimart

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
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

func TestToAPISNano21UsesNestedResolution(t *testing.T) {
	var request dto.ImageRequest
	require.NoError(t, common.Unmarshal([]byte(`{"model":"gemini-nano-banana-2.1","prompt":"test","size":"4:3","metadata":{"resolution":"4K","custom":"preserved"},"image_urls":["https://example.test/ref.png"]}`), &request))
	payload, err := (&Adaptor{}).ConvertImageRequest(nil, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: request.Model}}, request)
	require.NoError(t, err)
	encoded, err := common.Marshal(payload)
	require.NoError(t, err)
	var got map[string]any
	require.NoError(t, common.Unmarshal(encoded, &got))
	require.Equal(t, "4:3", got["size"])
	require.Equal(t, map[string]any{"resolution": "4K", "custom": "preserved"}, got["metadata"])
	require.Equal(t, float64(1), got["n"])
	require.NotContains(t, got, "resolution")
	require.NotContains(t, got, "aspect_ratio")
	require.NotContains(t, got, "custom")
}
