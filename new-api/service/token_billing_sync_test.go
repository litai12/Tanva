package service

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestTokenBillingEstimateAndActualUseIndependentTiers(t *testing.T) {
	modelBefore := ratio_setting.ModelRatio2JSONString()
	completionBefore := ratio_setting.CompletionRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"gpt-6-astra":3}`))
	require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(`{"gpt-6-astra":5}`))
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(modelBefore))
		require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(completionBefore))
	})
	for _, tc := range []struct {
		name             string
		estimate, actual int
		ratio, output    float64
	}{
		{"estimate high actual low", 272001, 272000, 3, 5},
		{"estimate low actual high", 272000, 272001, 6, 3.75},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			info := &relaycommon.RelayInfo{OriginModelName: "gpt-6-astra", UsingGroup: "default", UserGroup: "default", StartTime: time.Now()}
			price, err := helper.ModelPriceHelper(ctx, info, tc.estimate, &types.TokenCountMeta{MaxTokens: 1000})
			require.NoError(t, err)
			require.True(t, price.HasBaseTokenRatios)
			expectedPre := float64(common.Max(tc.estimate, common.PreConsumedQuota))*price.ModelRatio + 1000*price.ModelRatio*price.CompletionRatio
			require.Equal(t, int(expectedPre*price.GroupRatioInfo.GroupRatio), price.QuotaToPreConsume)
			usage := &dto.Usage{PromptTokens: tc.actual, CompletionTokens: 1000, PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 1000}}
			summary := calculateTextQuotaSummary(ctx, info, usage)
			require.NoError(t, summary.BillingError)
			require.Equal(t, tc.ratio, summary.ModelRatio)
			require.Equal(t, tc.output, summary.CompletionRatio)
			// Cache reads replace normal input tokens; output uses its independent ratio.
			expected := (float64(tc.actual-1000) + 1000*price.CacheRatio + 1000*tc.output) * tc.ratio * price.GroupRatioInfo.GroupRatio
			require.InDelta(t, expected, summary.Quota, 0.5)
		})
	}
}

func TestBillingSessionActualQuotaIsSettledOnlyOnce(t *testing.T) {
	for _, actual := range []int{60, 140, 0} {
		funding := &syncTestFunding{}
		session := &BillingSession{relayInfo: &relaycommon.RelayInfo{IsPlayground: true}, funding: funding, preConsumedQuota: 100}
		require.NoError(t, session.Settle(actual))
		require.NoError(t, session.Settle(actual))
		require.Equal(t, 1, funding.calls)
		require.Equal(t, actual-100, funding.delta)
	}
}

type syncTestFunding struct{ calls, delta int }

func (f *syncTestFunding) Source() string         { return BillingSourceWallet }
func (f *syncTestFunding) PreConsume(int) error   { return nil }
func (f *syncTestFunding) Settle(delta int) error { f.calls++; f.delta = delta; return nil }
func (f *syncTestFunding) Refund() error          { return nil }
