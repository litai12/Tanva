package controller

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

type channelRetryBilling struct{ settled, refunded int }

func (b *channelRetryBilling) Settle(int) error         { b.settled++; return nil }
func (b *channelRetryBilling) Refund(*gin.Context)      { b.refunded++ }
func (b *channelRetryBilling) NeedsRefund() bool        { return true }
func (b *channelRetryBilling) GetPreConsumedQuota() int { return 1234 }

func TestRelayChannelRetryRepricesBeforeDispatchAndKeepsOneReservation(t *testing.T) {
	modelBefore, completionBefore := ratio_setting.ModelRatio2JSONString(), ratio_setting.CompletionRatio2JSONString()
	priceBefore := ratio_setting.ModelPrice2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"retry-priced-model":3}`))
	require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(`{"retry-priced-model":5}`))
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{}`))
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(modelBefore))
		require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(completionBefore))
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(priceBefore))
	})
	contract := dto.ChannelSettings{TextSaleMultiplier: 2, TextCostPerMillionCNY: map[string]dto.TextTokenCostCNY{
		"retry-priced-model": {Input: .2, Output: 1, CacheRead: .02, CacheWrite: .25},
	}}
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyChannelId, 11)
	common.SetContextKey(ctx, constant.ContextKeyChannelSetting, contract)
	billing := &channelRetryBilling{}
	info := &relaycommon.RelayInfo{OriginModelName: "retry-priced-model", UsingGroup: "default", UserGroup: "default",
		StartTime: time.Now(), Billing: billing, FinalPreConsumedQuota: 1234, RequestId: "original-charge",
		BillingSource: "subscription", SubscriptionId: 19, SubscriptionPreConsumed: 1234,
		ChannelMeta: &relaycommon.ChannelMeta{ChannelId: 11, ChannelSetting: contract}}
	meta := &types.TokenCountMeta{MaxTokens: 20}
	_, err := helper.ModelPriceHelper(ctx, info, 100, meta)
	require.NoError(t, err)
	firstSnapshot := info.PriceData.ChannelTextPricing
	require.NotNil(t, firstSnapshot)
	assertReservation := func() {
		t.Helper()
		require.Same(t, billing, info.Billing)
		require.Equal(t, 1234, info.FinalPreConsumedQuota)
		require.Equal(t, "original-charge", info.RequestId)
		require.Equal(t, "subscription", info.BillingSource)
		require.Equal(t, 19, info.SubscriptionId)
		require.EqualValues(t, 1234, info.SubscriptionPreConsumed)
		require.Zero(t, billing.settled)
		require.Zero(t, billing.refunded)
	}
	// Same-channel re-selection preserves the original snapshot, despite an edit.
	changed := contract
	changed.TextSaleMultiplier = 100
	common.SetContextKey(ctx, constant.ContextKeyChannelSetting, changed)
	require.Nil(t, refreshRelayPricingForSelectedChannel(ctx, info, 11, info.OriginModelName, 100, meta))
	require.Same(t, firstSnapshot, info.PriceData.ChannelTextPricing)
	assertReservation()
	// lluban fails and a legacy channel is selected. Its empty context settings
	// must win over stale ChannelMeta still pointing at lluban before InitChannelMeta.
	common.SetContextKey(ctx, constant.ContextKeyChannelId, 12)
	common.SetContextKey(ctx, constant.ContextKeyChannelSetting, dto.ChannelSettings{})
	require.Nil(t, refreshRelayPricingForSelectedChannel(ctx, info, 11, info.OriginModelName, 100, meta))
	require.Nil(t, info.PriceData.ChannelTextPricing)
	require.Equal(t, 3.0, info.PriceData.ModelRatio)
	require.Equal(t, 5.0, info.PriceData.CompletionRatio)
	assertReservation()
	// A legacy channel then fails and lluban is selected: use the actual channel.
	info.ChannelMeta = &relaycommon.ChannelMeta{ChannelId: 12}
	common.SetContextKey(ctx, constant.ContextKeyChannelId, 13)
	common.SetContextKey(ctx, constant.ContextKeyChannelSetting, contract)
	require.Nil(t, refreshRelayPricingForSelectedChannel(ctx, info, 12, info.OriginModelName, 100, meta))
	require.NotNil(t, info.PriceData.ChannelTextPricing)
	require.Equal(t, .2, info.PriceData.ModelRatio)
	assertReservation()
	// Invalid pricing cannot proceed to a supplier or replace the last quote.
	previous := info.PriceData
	common.SetContextKey(ctx, constant.ContextKeyChannelId, 14)
	changed.TextSaleMultiplier = 0
	common.SetContextKey(ctx, constant.ContextKeyChannelSetting, changed)
	priceErr := refreshRelayPricingForSelectedChannel(ctx, info, 13, info.OriginModelName, 100, meta)
	require.NotNil(t, priceErr)
	require.Equal(t, types.ErrorCodeModelPriceError, priceErr.GetErrorCode())
	require.True(t, types.IsSkipRetryError(priceErr))
	require.Equal(t, previous, info.PriceData)
	assertReservation()
}
