package dto

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/official_pricing"
	"github.com/stretchr/testify/require"
)

func TestChannelSingleMultiplierDefaultsAndLegacyReadCompatibility(t *testing.T) {
	base := TextTokenCostCNY{Input: 1, Output: 5, CacheRead: .1, CacheWrite: 1.25}
	settings := ChannelSettings{TextBasePerMillionCNY: map[string]TextTokenCostCNY{"m": base},
		TextCostPerMillionCNY: map[string]TextTokenCostCNY{"m": {Input: 900}}, TextSaleMultiplier: 900}
	contract, err := settings.TextPricing("m")
	require.NoError(t, err)
	rate, err := contract.Retail(0)
	require.NoError(t, err)
	require.Equal(t, .4, rate.Input)
	require.Equal(t, 2.0, rate.Output)
	zero := 0.0
	settings.TextPriceMultiplier = &zero
	_, err = settings.TextPricing("m")
	require.Error(t, err)
	_, err = settings.TextPricing("missing")
	require.ErrorContains(t, err, "not configured")
	validMultiplier := .4
	settings.TextPriceMultiplier = &validMultiplier
	settings.TextBasePerMillionCNY = map[string]TextTokenCostCNY{}
	_, err = settings.TextPricing("m")
	require.ErrorContains(t, err, "not configured", "an empty single-mode base cannot fall back to legacy/global pricing")
	legacy := ChannelSettings{TextCostPerMillionCNY: map[string]TextTokenCostCNY{"m": base}, TextSaleMultiplier: 2}
	contract, err = legacy.TextPricing("m")
	require.NoError(t, err)
	rate, err = contract.Retail(0)
	require.NoError(t, err)
	require.Equal(t, 2.0, rate.Input)
}

func TestChannelOfficialBaseConvertsFXOnceAndKeepsTiers(t *testing.T) {
	price, exists := official_pricing.LookupID("gpt-6-luna")
	require.True(t, exists)
	base, err := ChannelBaseFromOfficial(price, 7.3)
	require.NoError(t, err)
	require.InDelta(t, .73, base.Input, 1e-12)
	require.InDelta(t, 3.65, base.Output, 1e-12)
	require.Len(t, base.Tiers, 2)
	require.InDelta(t, 1.46, base.Tiers[1].Input, 1e-12)
	_, err = ChannelBaseFromOfficial(price, -1)
	require.Error(t, err)
}
