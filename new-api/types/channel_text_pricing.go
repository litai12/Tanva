package types

import (
	"fmt"
	"math"
)

// TextTokenCostCNY is a channel procurement rate in CNY per million tokens.
// Optional dimensions preserve explicit zero. Tiers are ordered by inclusive
// prompt-token limits, with a final zero limit meaning unlimited context.
type TextTokenCostCNY struct {
	Input           float64            `json:"input"`
	Output          float64            `json:"output"`
	CacheRead       float64            `json:"cache_read"`
	CacheWrite      float64            `json:"cache_write"`
	CacheWrite5m    *float64           `json:"cache_write_5m,omitempty"`
	CacheWrite1h    *float64           `json:"cache_write_1h,omitempty"`
	ImageInput      *float64           `json:"image_input,omitempty"`
	AudioInput      *float64           `json:"audio_input,omitempty"`
	MaxPromptTokens int                `json:"max_prompt_tokens"`
	Tiers           []TextTokenCostCNY `json:"tiers,omitempty"`
}

// ChannelTextPricing is the immutable contract captured when a request is
// accepted; later channel edits cannot replace its settlement rates.
type ChannelTextPricing struct {
	Cost       TextTokenCostCNY
	Multiplier float64
}

func (p ChannelTextPricing) Validate() error {
	if p.Multiplier <= 0 || math.IsNaN(p.Multiplier) || math.IsInf(p.Multiplier, 0) {
		return fmt.Errorf("text price multiplier must be finite and positive")
	}
	validateRate := func(rate TextTokenCostCNY) error {
		if rate.Input <= 0 {
			return fmt.Errorf("text input procurement cost must be positive")
		}
		values := []float64{rate.Input, rate.Output, rate.CacheRead, rate.CacheWrite}
		for _, value := range []*float64{rate.CacheWrite5m, rate.CacheWrite1h, rate.ImageInput, rate.AudioInput} {
			if value != nil {
				values = append(values, *value)
			}
		}
		for _, value := range values {
			if value < 0 || math.IsNaN(value) || math.IsInf(value, 0) || math.IsInf(value*p.Multiplier, 0) {
				return fmt.Errorf("text procurement rates must be finite and nonnegative")
			}
			if math.IsInf(value/rate.Input, 0) {
				return fmt.Errorf("text procurement token ratios must be finite")
			}
		}
		if rate.Input*p.Multiplier/2 <= 0 || (rate.CacheWrite1h == nil && math.IsInf(rate.CacheWrite*p.Multiplier*(6.0/3.75), 0)) {
			return fmt.Errorf("text procurement retail rates exceed supported numeric bounds")
		}
		return nil
	}
	if err := validateRate(p.Cost); err != nil {
		return err
	}
	previous := 0
	for i, tier := range p.Cost.Tiers {
		if len(tier.Tiers) != 0 || tier.MaxPromptTokens < 0 || tier.MaxPromptTokens == int(^uint(0)>>1) ||
			(i < len(p.Cost.Tiers)-1 && tier.MaxPromptTokens <= previous) ||
			(i == len(p.Cost.Tiers)-1 && tier.MaxPromptTokens != 0) {
			return fmt.Errorf("text tiers must have increasing positive limits and a final unlimited tier")
		}
		if err := validateRate(tier); err != nil {
			return fmt.Errorf("text tier %d: %w", i, err)
		}
		previous = tier.MaxPromptTokens
	}
	return nil
}

func cloneTextCost(cost TextTokenCostCNY) TextTokenCostCNY {
	for _, field := range []**float64{&cost.CacheWrite5m, &cost.CacheWrite1h, &cost.ImageInput, &cost.AudioInput} {
		if *field != nil {
			value := **field
			*field = &value
		}
	}
	if cost.Tiers != nil {
		tiers := make([]TextTokenCostCNY, len(cost.Tiers))
		for i := range tiers {
			tiers[i] = cloneTextCost(cost.Tiers[i])
		}
		cost.Tiers = tiers
	}
	return cost
}

func (p ChannelTextPricing) Snapshot() *ChannelTextPricing {
	p.Cost = cloneTextCost(p.Cost)
	return &p
}

// Retail returns final CNY rates, without group discounts or another FX pass.
func (p ChannelTextPricing) Retail(promptTokens int) (TextTokenCostCNY, error) {
	if promptTokens < 0 {
		return TextTokenCostCNY{}, fmt.Errorf("negative prompt token count")
	}
	if err := p.Validate(); err != nil {
		return TextTokenCostCNY{}, err
	}
	rate := p.Cost
	for _, tier := range p.Cost.Tiers {
		if tier.MaxPromptTokens == 0 || promptTokens <= tier.MaxPromptTokens {
			rate = tier
			break
		}
	}
	rate = cloneTextCost(rate)
	rate.Tiers = nil
	rate.Input *= p.Multiplier
	rate.Output *= p.Multiplier
	rate.CacheRead *= p.Multiplier
	rate.CacheWrite *= p.Multiplier
	for _, field := range []**float64{&rate.CacheWrite5m, &rate.CacheWrite1h, &rate.ImageInput, &rate.AudioInput} {
		if *field != nil {
			**field *= p.Multiplier
		}
	}
	if rate.CacheWrite5m == nil {
		value := rate.CacheWrite
		rate.CacheWrite5m = &value
	}
	if rate.CacheWrite1h == nil {
		value := rate.CacheWrite * (6.0 / 3.75)
		rate.CacheWrite1h = &value
	}
	if rate.ImageInput == nil {
		value := rate.Input
		rate.ImageInput = &value
	}
	if rate.AudioInput == nil {
		value := rate.Input
		rate.AudioInput = &value
	}
	return rate, nil
}
