package relay

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/stretchr/testify/require"
)

func TestAPIMartImageTiersResolveOnceAndKeepBillingIdentity(t *testing.T) {
	mapping := `{"gpt-image-2.5-flare":"gpt-image-2.5-ext","gpt-image-2.5-sunburst":"gpt-image-2.5-ext","gpt-image-2.5-flare-vip":"gpt-image-2.5-flare","gpt-image-2.5-sunburst-vip":"gpt-image-2.5-sunburst","gemini-nano-banana-2.1":"gemini-nano-banana-2.1-ext","gemini-nano-banana-2.1-official":"gemini-nano-banana-2.1"}`
	for _, public := range []string{"gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare-vip", "gpt-image-2.5-sunburst-vip", constant.ToAPISNanoBanana21, constant.ToAPISNanoBanana21Official} {
		for _, base := range []string{"https://api.apimart.ai", "https://api.aishuch.com"} {
			t.Run(public+base, func(t *testing.T) {
				info := imageTierRelayInfoWithChannelType(public, constant.ChannelTypeApimart)
				info.ChannelBaseUrl = base
				request := dto.ImageRequest{Model: public}
				require.NoError(t, applyChannelBoundImageModel(imageTierTestContext([]string{public}, mapping), info, &request))
				expected, ok := constant.APIMartImageTierModel(public)
				require.True(t, ok)
				require.Equal(t, expected, request.Model)
				require.Equal(t, expected, info.UpstreamModelName)
				require.Equal(t, public, info.OriginModelName)
			})
		}
	}
}

func TestAPIMartImageTierMappingDoesNotPermitToAPISDowngrade(t *testing.T) {
	for _, base := range []string{"https://toapis.cn", "https://api.aishuch.com.attacker.invalid", "http://api.aishuch.com"} {
		public := constant.ToAPISNanoBanana21Official
		info := imageTierRelayInfoWithChannelType(public, constant.ChannelTypeApimart)
		info.ChannelBaseUrl = base
		request := dto.ImageRequest{Model: public}
		require.Error(t, applyChannelBoundImageModel(imageTierTestContext([]string{public}, `{"gemini-nano-banana-2.1-official":"gemini-nano-banana-2.1"}`), info, &request))
	}
}

func TestAPIMartTierOverridesPreserveVersionAndFallback(t *testing.T) {
	before := []byte(`{"model":"gpt-image-2.5-ext","version":"flare","official_fallback":false}`)
	require.Error(t, validateToAPISImagePriceOverride(before, []byte(`{"model":"gpt-image-2.5-ext","version":"sunburst","official_fallback":false}`)))
	require.Error(t, validateToAPISImagePriceOverride(before, []byte(`{"model":"gpt-image-2.5-ext","version":"flare","official_fallback":true}`)))
}
