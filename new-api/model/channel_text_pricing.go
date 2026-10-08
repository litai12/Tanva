package model

import (
	"fmt"
	"sort"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/official_pricing"
	"github.com/QuantumNous/new-api/types"
)

// These are final retail CNY/M quotes, before existing group discounts.
// The multiplier is explanatory and must not be applied to these rates again.
type ChannelTextPrice struct {
	ChannelID               int                          `json:"channel_id"`
	ModelName               string                       `json:"model_name"`
	EnableGroups            []string                     `json:"enable_groups"`
	Currency                string                       `json:"currency"`
	PricingSource           string                       `json:"pricing_source"`
	PriceMultiplier         float64                      `json:"text_price_multiplier"`
	OfficialPricing         *official_pricing.ModelPrice `json:"official_pricing,omitempty"`
	BaselineUSDToCNY        *float64                     `json:"baseline_usd_to_cny,omitempty"`
	OfficialPriceMultiplier *float64                     `json:"official_price_multiplier,omitempty"`
	types.TextTokenCostCNY
}

// GetChannelTextPricedModels returns published models with a valid channel
// contract on a currently enabled route in one of the caller's routing groups.
// It does not add global ratios or change channel settings while reading them.
func GetChannelTextPricedModels(groups []string) (map[string]bool, error) {
	result := make(map[string]bool)
	if len(groups) == 0 {
		return result, nil
	}
	published := make(map[string]bool)
	for _, pricing := range GetPricing() {
		if len(pricing.ChannelTextPrices) > 0 {
			published[pricing.ModelName] = true
		}
	}
	if len(published) == 0 {
		return result, nil
	}
	var abilities []AbilityWithChannel
	err := DB.Table("abilities").
		Select("abilities.*, channels.type as channel_type, channels.setting as channel_setting").
		Joins("JOIN channels ON abilities.channel_id = channels.id").
		Where("abilities.enabled = ? AND channels.status = ?", true, common.ChannelStatusEnabled).
		Where("abilities."+commonGroupCol+" IN ?", groups).
		Scan(&abilities).Error
	if err != nil {
		return nil, err
	}
	for _, ability := range abilities {
		canonical := CanonicalModelKey(ability.Model)
		if !published[canonical] {
			continue
		}
		var settings dto.ChannelSettings
		if err := common.UnmarshalJsonStr(ability.ChannelSetting, &settings); err != nil {
			continue
		}
		contract, err := settings.TextPricing(ability.Model)
		if err != nil || contract == nil {
			continue
		}
		result[ability.Model] = true
		result[canonical] = true
	}
	return result, nil
}

// Auto-sync may append a model without passing channel-setting validation.
// Such abilities cannot execute a procurement contract and must not acquire
// a global fallback quote in the public directory. Other channels stay visible.
func filterUnpricedContractAbilities(abilities []AbilityWithChannel) ([]AbilityWithChannel, error) {
	filtered := make([]AbilityWithChannel, 0, len(abilities))
	for _, ability := range abilities {
		var settings dto.ChannelSettings
		if ability.ChannelSetting != "" {
			if err := common.UnmarshalJsonStr(ability.ChannelSetting, &settings); err != nil {
				return nil, err
			}
		}
		if settings.HasTextPricing() {
			if _, exists := settings.TextPriceBases()[ability.Model]; !exists {
				continue
			}
		}
		filtered = append(filtered, ability)
	}
	return filtered, nil
}

func channelTextQuotes(abilities []AbilityWithChannel) (map[string][]ChannelTextPrice, map[string]bool, error) {
	quotes := make(map[string][]ChannelTextPrice)
	legacy := make(map[string]bool)
	seen := make(map[string]*ChannelTextPrice)
	for _, ability := range abilities {
		canonical := CanonicalModelKey(ability.Model)
		var settings dto.ChannelSettings
		if ability.ChannelSetting != "" {
			if err := common.UnmarshalJsonStr(ability.ChannelSetting, &settings); err != nil {
				return nil, nil, err
			}
		}
		contract, err := settings.TextPricing(ability.Model)
		if err != nil {
			return nil, nil, fmt.Errorf("channel %d model %s: %w", ability.ChannelId, ability.Model, err)
		}
		if contract == nil {
			legacy[canonical] = true
			continue
		}
		key := fmt.Sprintf("%d/%s", ability.ChannelId, ability.Model)
		if quote, found := seen[key]; found {
			if !common.StringsContains(quote.EnableGroups, ability.Group) {
				quote.EnableGroups = append(quote.EnableGroups, ability.Group)
			}
			continue
		}
		rate, err := contract.Retail(0)
		if err != nil {
			return nil, nil, err
		}
		for _, tier := range contract.Cost.Tiers {
			threshold := tier.MaxPromptTokens
			if threshold == 0 && len(contract.Cost.Tiers) > 1 {
				threshold = contract.Cost.Tiers[len(contract.Cost.Tiers)-2].MaxPromptTokens + 1
			}
			tierRate, err := contract.Retail(threshold)
			if err != nil {
				return nil, nil, err
			}
			rate.Tiers = append(rate.Tiers, tierRate)
		}
		quote := &ChannelTextPrice{ChannelID: ability.ChannelId, ModelName: ability.Model,
			EnableGroups: []string{ability.Group}, Currency: "CNY", PricingSource: "legacy_contract",
			PriceMultiplier: contract.Multiplier, TextTokenCostCNY: rate}
		if len(settings.TextBasePerMillionCNY) > 0 {
			quote.PricingSource = "channel_base"
			if official, exists := settings.TextOfficialPricing[ability.Model]; exists {
				copy := official_pricing.Clone(official)
				quote.OfficialPricing = &copy
				fx, multiplier := settings.TextOfficialUSDToCNY, contract.Multiplier
				quote.BaselineUSDToCNY, quote.OfficialPriceMultiplier = &fx, &multiplier
			}
		}
		seen[key] = quote
	}
	for _, quote := range seen {
		sort.Strings(quote.EnableGroups)
		name := CanonicalModelKey(quote.ModelName)
		quotes[name] = append(quotes[name], *quote)
	}
	for name := range quotes {
		sort.Slice(quotes[name], func(i, j int) bool {
			if quotes[name][i].ChannelID == quotes[name][j].ChannelID {
				return quotes[name][i].ModelName < quotes[name][j].ModelName
			}
			return quotes[name][i].ChannelID < quotes[name][j].ChannelID
		})
	}
	return quotes, legacy, nil
}

// When every active route uses a channel contract, its real quote must also
// replace stale global display prices. This never changes persisted options.
func applyExclusiveChannelTextQuote(pricing *Pricing, quotes []ChannelTextPrice, hasLegacy bool) {
	if hasLegacy || len(quotes) == 0 {
		return
	}
	var input, output, read, write float64
	for _, quote := range quotes {
		input = max(input, quote.Input)
		output = max(output, quote.Output)
		read = max(read, quote.CacheRead)
		write = max(write, quote.CacheWrite)
	}
	pricing.QuotaType = 0
	pricing.ModelPrice = 0
	pricing.ModelRatio = input / 2
	pricing.CompletionRatio = output / input
	readRatio, writeRatio := read/input, write/input
	pricing.CacheRatio, pricing.CreateCacheRatio = &readRatio, &writeRatio
}
