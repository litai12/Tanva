package service

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestChannelTextPricingEstimateActualTiersAndSnapshotAcrossProtocols(t *testing.T) {
	pricesBefore := ratio_setting.ModelPrice2JSONString()
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"gpt-6-astra":999}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(pricesBefore)) })
	for _, format := range []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude, types.RelayFormatOpenAIResponses} {
		for _, counts := range [][2]int{{100, 101}, {101, 100}} {
			multiplier := .4
			settings := dto.ChannelSettings{TextPriceMultiplier: &multiplier, TextBasePerMillionCNY: map[string]dto.TextTokenCostCNY{
				"gpt-6-astra": {Input: 1, Output: 5, CacheRead: .1, CacheWrite: 1.25, Tiers: []dto.TextTokenCostCNY{
					{MaxPromptTokens: 100, Input: 1, Output: 5, CacheRead: .1, CacheWrite: 1.25},
					{Input: 2, Output: 7.5, CacheRead: .2, CacheWrite: 2.5},
				}},
			}}
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Set(string(constant.ContextKeyChannelSetting), settings)
			info := &relaycommon.RelayInfo{OriginModelName: "gpt-6-astra", RelayFormat: format,
				UsingGroup: "default", UserGroup: "default", StartTime: time.Now()}
			price, err := helper.ModelPriceHelper(ctx, info, counts[0], &types.TokenCountMeta{MaxTokens: 20})
			require.NoError(t, err)
			require.False(t, price.UsePrice, "channel token contract must override existing fixed model pricing")
			require.NotNil(t, price.ChannelTextPricing)
			quoted, err := price.ChannelTextPricing.Retail(counts[0])
			require.NoError(t, err)
			pre := (float64(common.Max(counts[0], common.PreConsumedQuota))*quoted.Input + 20*quoted.Output) / 2
			require.InDelta(t, pre*price.GroupRatioInfo.GroupRatio, price.QuotaToPreConsume, .5)
			// A later admin edit must not replace the accepted procurement contract.
			settings.TextBasePerMillionCNY["gpt-6-astra"].Tiers[1].Input = 100
			ctx.Set(string(constant.ContextKeyChannelSetting), settings)
			usage := &dto.Usage{PromptTokens: counts[1], CompletionTokens: 20}
			summary := calculateTextQuotaSummary(ctx, info, usage)
			require.NoError(t, summary.BillingError)
			actualInput, actualOutput := .4, 2.0
			if counts[1] > 100 {
				actualInput, actualOutput = .8, 3
			}
			expected := (float64(counts[1])*actualInput + 20*actualOutput) / 2 * price.GroupRatioInfo.GroupRatio
			require.InDelta(t, expected, summary.Quota, .5)
			require.Equal(t, actualInput/2, summary.ModelRatio)
		}
	}
}

func TestChannelTextPricingCacheUsageEquivalentAcrossProtocols(t *testing.T) {
	zero, hour := 0.0, .4
	settings := dto.ChannelSettings{TextSaleMultiplier: 2, TextCostPerMillionCNY: map[string]dto.TextTokenCostCNY{
		"channel-cache-model": {Input: .2, Output: 1, CacheRead: .02, CacheWrite: .25,
			CacheWrite5m: &zero, CacheWrite1h: &hour},
	}}
	for _, format := range []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude, types.RelayFormatOpenAIResponses} {
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		info := &relaycommon.RelayInfo{OriginModelName: "channel-cache-model", RelayFormat: format,
			UsingGroup: "default", UserGroup: "default", StartTime: time.Now(),
			ChannelMeta: &relaycommon.ChannelMeta{ChannelSetting: settings}}
		price, err := helper.ModelPriceHelper(ctx, info, 100, &types.TokenCountMeta{MaxTokens: 20})
		require.NoError(t, err, "channel contract works without a global model ratio")
		usage := &dto.Usage{PromptTokens: 115, CompletionTokens: 20,
			PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 10, CachedCreationTokens: 5}}
		if format == types.RelayFormatClaude {
			usage.PromptTokens = 100
		}
		summary := calculateTextQuotaSummary(ctx, info, usage)
		require.NoError(t, summary.BillingError)
		expected := (100*.4 + 10*.04 + 5*.5 + 20*2) / 2 * price.GroupRatioInfo.GroupRatio
		require.InDelta(t, expected, summary.Quota, .5)
		usage.PromptTokens = 100
		usage.ClaudeCacheCreation5mTokens = 2
		usage.ClaudeCacheCreation1hTokens = 3
		// Claude split-usage semantics are also preserved when returned through OpenAI/Responses.
		summary = calculateTextQuotaSummary(ctx, info, usage)
		expected = (100*.4 + 10*.04 + 2*0 + 3*.8 + 20*2) / 2 * price.GroupRatioInfo.GroupRatio
		require.InDelta(t, expected, summary.Quota, .5)
	}
}

func TestChannelTextPricingOverridesDeepSeekPeriodAndGlobalRatio(t *testing.T) {
	for _, at := range []time.Time{time.Date(2026, 10, 8, 1, 0, 0, 0, time.UTC), time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)} {
		settings := dto.ChannelSettings{TextSaleMultiplier: 2, TextCostPerMillionCNY: map[string]dto.TextTokenCostCNY{
			"deepseek-flash": {Input: .2, Output: 1, CacheRead: .05},
		}}
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		ctx.Set(string(constant.ContextKeyChannelSetting), settings)
		info := &relaycommon.RelayInfo{OriginModelName: "deepseek-flash", UsingGroup: "default", UserGroup: "default", StartTime: at}
		price, err := helper.ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{MaxTokens: 20})
		require.NoError(t, err)
		require.Equal(t, .2, price.ModelRatio)
		require.Equal(t, 5.0, price.CompletionRatio)
		require.Equal(t, .25, price.CacheRatio)
		summary := calculateTextQuotaSummary(ctx, info, &dto.Usage{PromptTokens: 1000, CompletionTokens: 20})
		require.NoError(t, summary.BillingError)
		require.InDelta(t, (1000*.4+20*2)/2*price.GroupRatioInfo.GroupRatio, summary.Quota, .5)
	}
}

func TestChannelTextPricingPreservesExplicitFreeAudioAndImageInput(t *testing.T) {
	zero := 0.0
	settings := dto.ChannelSettings{TextSaleMultiplier: 2, TextCostPerMillionCNY: map[string]dto.TextTokenCostCNY{
		"gemini-contract-model": {Input: 2, Output: 4, ImageInput: &zero, AudioInput: &zero},
	}}
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set(string(constant.ContextKeyChannelSetting), settings)
	info := &relaycommon.RelayInfo{OriginModelName: "gemini-contract-model", UsingGroup: "default", UserGroup: "default", StartTime: time.Now()}
	price, err := helper.ModelPriceHelper(ctx, info, 100, &types.TokenCountMeta{})
	require.NoError(t, err)
	summary := calculateTextQuotaSummary(ctx, info, &dto.Usage{PromptTokens: 100,
		PromptTokensDetails: dto.InputTokenDetails{ImageTokens: 20, AudioTokens: 30}})
	require.NoError(t, summary.BillingError)
	require.InDelta(t, 50*2*price.GroupRatioInfo.GroupRatio, summary.Quota, .5)
}

func TestChannelTextPricingRejectsMissingModelBeforeUpstream(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set(string(constant.ContextKeyChannelSetting), dto.ChannelSettings{
		TextSaleMultiplier: 2, TextCostPerMillionCNY: map[string]dto.TextTokenCostCNY{
			"priced-model": {Input: .2, Output: 1},
		},
	})
	info := &relaycommon.RelayInfo{OriginModelName: "gpt-6-astra", UsingGroup: "default", UserGroup: "default", StartTime: time.Now()}
	_, err := helper.ModelPriceHelper(ctx, info, 100, &types.TokenCountMeta{})
	require.ErrorContains(t, err, "not configured")
	require.Empty(t, info.PriceData)
	legacy, err := (dto.ChannelSettings{}).TextPricing("gpt-6-astra")
	require.NoError(t, err)
	require.Nil(t, legacy)
}
