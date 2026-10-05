package service

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestDeepSeekFlashCNYRequestPriceIsSharedWithActualSettlement(t *testing.T) {
	modelBefore, completionBefore := ratio_setting.ModelRatio2JSONString(), ratio_setting.CompletionRatio2JSONString()
	cacheBefore, priceBefore := ratio_setting.CacheRatio2JSONString(), ratio_setting.ModelPrice2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(modelBefore))
		require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(completionBefore))
		require.NoError(t, ratio_setting.UpdateCacheRatioByJSONString(cacheBefore))
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(priceBefore))
	})
	for _, tc := range []struct {
		name, at string
		ratio    float64
	}{
		{"holiday", "2026-10-05T01:00:00Z", .5},
		{"peak", "2026-10-08T01:00:00Z", 1},
		{"exclusive endpoint", "2026-10-08T10:00:00Z", .5},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"deepseek-flash":1}`))
			require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(`{"deepseek-flash":4}`))
			require.NoError(t, ratio_setting.UpdateCacheRatioByJSONString(`{"deepseek-flash":0.02}`))
			require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{}`))
			at, err := time.Parse(time.RFC3339, tc.at)
			require.NoError(t, err)
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			info := &relaycommon.RelayInfo{OriginModelName: "deepseek-flash", UsingGroup: "default", UserGroup: "default", StartTime: at}
			price, err := helper.ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{MaxTokens: 300})
			require.NoError(t, err)
			require.False(t, price.UsePrice)
			require.Equal(t, tc.ratio, price.ModelRatio)
			require.Equal(t, tc.ratio, price.BaseModelRatio)
			require.Equal(t, 4.0, price.CompletionRatio)
			require.Equal(t, .02, price.CacheRatio)
			// Configuration changes while the supplier runs cannot replace its snapshot.
			require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"deepseek-flash":0.15}`))
			usage := &dto.Usage{PromptTokens: 18171, CompletionTokens: 285, PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 1000}}
			summary := calculateTextQuotaSummary(ctx, info, usage)
			require.NoError(t, summary.BillingError)
			require.Equal(t, tc.ratio, summary.ModelRatio)
			want := (float64(18171-1000) + 1000*.02 + 285*4) * tc.ratio * price.GroupRatioInfo.GroupRatio
			require.InDelta(t, want, summary.Quota, .5)
		})
	}
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{OriginModelName: "deepseek-flash", UsingGroup: "default", UserGroup: "default", StartTime: time.Date(2026, 10, 5, 1, 0, 0, 0, time.UTC)}
	_, err := helper.ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{MaxTokens: 300})
	require.ErrorContains(t, err, "peak ModelRatio=1")
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"deepseek-flash":1}`))
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"deepseek-flash":0.01}`))
	_, err = helper.ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{MaxTokens: 300})
	require.ErrorContains(t, err, "fixed ModelPrice")
	// XiaoT facade reports consumed credits as completion_tokens, not supplier
	// usage. Preserve its original nominal fixed charge instead of token billing.
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"xiaot-agent-deepseek-v4-flash":0.01}`))
	info.OriginModelName = "xiaot-agent-deepseek-v4-flash"
	price, err := helper.ModelPriceHelper(ctx, info, 0, &types.TokenCountMeta{})
	require.NoError(t, err)
	require.True(t, price.UsePrice)
	require.Equal(t, 0.01, price.ModelPrice)
}
