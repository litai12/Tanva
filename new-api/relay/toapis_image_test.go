package relay

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/stretchr/testify/require"
)

func TestToAPISImageOverridesCannotChangePricedInputs(t *testing.T) {
	original := []byte(`{"model":"gpt-image-2.5-flare-vip","size":"2048x2048","quality":"medium","n":1,"prompt":"test"}`)
	for _, field := range []string{`"quality":"max"`, `"size":"4096x4096"`, `"n":2`, `"metadata":{"resolution":"4K"}`, `"model":"gpt-image-2.5-sunburst"`} {
		after := []byte(`{"model":"gpt-image-2.5-flare-vip","size":"2048x2048","quality":"medium","n":1,"prompt":"test",` + field + `}`)
		require.Error(t, validateToAPISImagePriceOverride(original, after))
	}
	require.NoError(t, validateToAPISImagePriceOverride(original, []byte(`{"model":"gpt-image-2.5-flare-vip","size":"2048x2048","quality":"medium","n":1,"prompt":"updated","background":"transparent"}`)))
}

func TestToAPISNano21OfficialRequiresExactApimartCapability(t *testing.T) {
	for _, tc := range []struct {
		name        string
		models      []string
		channelType int
		wantError   bool
	}{
		{"configured", []string{constant.ToAPISNanoBanana21Official}, constant.ChannelTypeApimart, false},
		{"only-ordinary", []string{constant.ToAPISNanoBanana21}, constant.ChannelTypeApimart, true},
		{"wrong-channel", []string{constant.ToAPISNanoBanana21Official}, constant.ChannelTypeMagic666, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := dto.ImageRequest{Model: constant.ToAPISNanoBanana21Official}
			info := imageTierRelayInfoWithChannelType(request.Model, tc.channelType)
			err := applyChannelBoundImageModel(imageTierTestContext(tc.models, `{}`), info, &request)
			if tc.wantError {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
				require.Equal(t, constant.ToAPISNanoBanana21Official, request.Model)
				require.Equal(t, request.Model, info.UpstreamModelName)
			}
		})
	}
}

func TestToAPISImageMappingCannotChangeBillingSKU(t *testing.T) {
	for _, models := range [][2]string{{"gpt-image-2", "gpt-image-2.5-flare-vip"}, {"gpt-image-2.5-flare-vip", "gpt-image-2.5-flare"}, {"gemini-nano-banana-2.1", "nanobanana2"}, {"gemini-nano-banana-2.1", "gemini-nano-banana-2.1-official"}, {"gemini-nano-banana-2.1-official", "gemini-nano-banana-2.1"}} {
		c := imageTierTestContext([]string{models[0]}, `{"`+models[0]+`":"`+models[1]+`"}`)
		request := dto.ImageRequest{Model: models[0]}
		require.Error(t, applyChannelBoundImageModel(c, imageTierRelayInfo(models[0]), &request))
	}
}
