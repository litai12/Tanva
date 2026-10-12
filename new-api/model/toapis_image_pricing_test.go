package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestToAPISVIPPublicPricingIncludesAllQualityResolutionSpecs(t *testing.T) {
	prices := map[string][3]float64{"low": {.2, .3, .4}, "medium": {.3, .4, .5}, "high": {.4, .6, .8}, "xhigh": {.6, 1, 1.4}, "max": {1.5, 3, 4.5}}
	for _, model := range []string{"gpt-image-2.5-flare-vip", "gpt-image-2.5-sunburst-vip"} {
		pricing := buildParamPricing(model, nil)
		require.NotNil(t, pricing)
		require.Equal(t, "CNY", pricing.Currency)
		require.Len(t, pricing.Results, 15)
		seen := map[string]bool{}
		for _, result := range pricing.Results {
			index := map[string]int{"1k": 0, "2k": 1, "4k": 2}[result.Resolution]
			require.Equal(t, prices[result.Quality][index], result.PriceCNY)
			require.Equal(t, "image:"+result.Resolution+":"+result.Quality, result.SpecKey)
			require.False(t, seen[result.SpecKey])
			seen[result.SpecKey] = true
		}
		base, ok := fixedImageBasePriceCNY(model)
		require.True(t, ok)
		require.Equal(t, .2, base)
	}
}

func TestToAPISNano21PublicPricingUsesLatestTanvasRetailPrices(t *testing.T) {
	for model, prices := range map[string][]float64{"gemini-nano-banana-2.1": {.2, .3, .4}, "gemini-nano-banana-2.1-official": {.3, .6, .9}} {
		pricing := buildParamPricing(model, nil)
		require.NotNil(t, pricing)
		require.Len(t, pricing.Results, 3)
		for index, result := range pricing.Results {
			require.Equal(t, prices[index], result.PriceCNY)
			require.Equal(t, "", result.Quality)
			require.Equal(t, "image:"+result.Resolution, result.SpecKey)
		}
		base, ok := fixedImageBasePriceCNY(model)
		require.True(t, ok)
		require.Equal(t, prices[0], base)
	}
}
