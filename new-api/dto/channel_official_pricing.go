package dto

import (
	"fmt"
	"math"

	"github.com/QuantumNous/new-api/setting/official_pricing"
	"github.com/QuantumNous/new-api/types"
)

// ChannelBaseFromOfficial converts USD list prices once into the channel's
// CNY base contract. Billing then applies its single price multiplier.
// Unpublished cache rates retain the ordinary-input procurement fallback;
// their absence in the official metadata is preserved and never called free.
func ChannelBaseFromOfficial(price official_pricing.ModelPrice, fx float64) (TextTokenCostCNY, error) {
	if price.Currency != "USD" || price.SourceURL == "" || price.VerifiedAt == "" {
		return TextTokenCostCNY{}, fmt.Errorf("official price requires audited USD source metadata")
	}
	for _, value := range []float64{fx} {
		if value <= 0 || math.IsNaN(value) || math.IsInf(value, 0) {
			return TextTokenCostCNY{}, fmt.Errorf("official FX must be finite and positive")
		}
	}
	scale := fx
	optional := func(value *float64) *float64 {
		if value == nil {
			return nil
		}
		v := *value * scale
		return &v
	}
	rate := func(input, output float64, read, write, write5m, write1h, image, audio *float64) TextTokenCostCNY {
		cost := TextTokenCostCNY{Input: input * scale, Output: output * scale, CacheRead: input * scale, CacheWrite: input * scale,
			CacheWrite5m: optional(write5m), CacheWrite1h: optional(write1h), ImageInput: optional(image), AudioInput: optional(audio)}
		if read != nil {
			cost.CacheRead = *read * scale
		}
		if write != nil {
			cost.CacheWrite = *write * scale
		}
		return cost
	}
	cost := rate(price.Input, price.Output, price.CacheRead, price.CacheWrite, price.CacheWrite5m, price.CacheWrite1h, price.ImageInput, price.AudioInput)
	if len(price.Tiers) > 1 {
		for _, tier := range price.Tiers {
			tierCost := rate(tier.Input, tier.Output, tier.CacheRead, tier.CacheWrite, tier.CacheWrite5m, tier.CacheWrite1h, tier.ImageInput, tier.AudioInput)
			tierCost.MaxPromptTokens = tier.MaxPromptTokens
			cost.Tiers = append(cost.Tiers, tierCost)
		}
	}
	if err := (types.ChannelTextPricing{Cost: cost, Multiplier: 1}).Validate(); err != nil {
		return TextTokenCostCNY{}, err
	}
	return cost, nil
}
