package relay

import (
	"testing"

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

func TestToAPISImageMappingCannotChangeBillingSKU(t *testing.T) {
	for _, models := range [][2]string{{"gpt-image-2", "gpt-image-2.5-flare-vip"}, {"gpt-image-2.5-flare-vip", "gpt-image-2.5-flare"}, {"gemini-nano-banana-2.1", "nanobanana2"}} {
		c := imageTierTestContext([]string{models[0]}, `{"`+models[0]+`":"`+models[1]+`"}`)
		request := dto.ImageRequest{Model: models[0]}
		require.Error(t, applyChannelBoundImageModel(c, imageTierRelayInfo(models[0]), &request))
	}
}
