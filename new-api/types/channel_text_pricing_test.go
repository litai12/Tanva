package types

import (
	"math"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestChannelTextContractTiersAndExplicitZero(t *testing.T) {
	zero := 0.0
	pricing := ChannelTextPricing{Multiplier: 2, Cost: TextTokenCostCNY{
		Input: .2, Output: 1, CacheRead: .02, CacheWrite: .25,
		Tiers: []TextTokenCostCNY{
			{MaxPromptTokens: 100, Input: .2, Output: 1, CacheRead: .02, CacheWrite: .25},
			{Input: .4, Output: 1.5, CacheRead: .04, CacheWrite: .5, CacheWrite1h: &zero, AudioInput: &zero},
		},
	}}
	for _, tc := range []struct {
		tokens                       int
		input, output, read, write1h float64
	}{
		{0, .4, 2, .04, .8}, {100, .4, 2, .04, .8}, {101, .8, 3, .08, 0},
	} {
		rate, err := pricing.Retail(tc.tokens)
		require.NoError(t, err)
		require.Equal(t, tc.input, rate.Input)
		require.Equal(t, tc.output, rate.Output)
		require.Equal(t, tc.read, rate.CacheRead)
		require.InDelta(t, tc.write1h, *rate.CacheWrite1h, 1e-12)
	}
	snapshot := pricing.Snapshot()
	zero = 1
	pricing.Cost.Tiers[1].Input = 90
	rate, err := snapshot.Retail(101)
	require.NoError(t, err)
	require.Equal(t, .8, rate.Input)
	require.Zero(t, *rate.AudioInput)
	require.Zero(t, *rate.CacheWrite1h)
}

func TestChannelTextContractRejectsInvalidRatesAndTiers(t *testing.T) {
	valid := TextTokenCostCNY{Input: .2, Output: 1}
	for _, cost := range []TextTokenCostCNY{
		{Input: 0}, {Input: -1}, {Input: math.NaN()}, {Input: 1, Output: math.Inf(1)},
		{Input: 1, CacheRead: -1}, {Input: math.MaxFloat64},
		{Input: 1, Tiers: []TextTokenCostCNY{{Input: 1, MaxPromptTokens: 100}}},
		{Input: 1, Tiers: []TextTokenCostCNY{{Input: 1}, {Input: 1}}},
		{Input: 1, Tiers: []TextTokenCostCNY{{Input: 1, MaxPromptTokens: 100}, {Input: 1, MaxPromptTokens: 50}, {Input: 1}}},
	} {
		require.Error(t, (ChannelTextPricing{Cost: cost, Multiplier: 2}).Validate())
	}
	for _, multiplier := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		require.Error(t, (ChannelTextPricing{Cost: valid, Multiplier: multiplier}).Validate())
	}
	_, err := (ChannelTextPricing{Cost: valid, Multiplier: 2}).Retail(-1)
	require.Error(t, err)
}
