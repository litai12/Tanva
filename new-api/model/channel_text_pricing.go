package model

import (
	"fmt"
	"sort"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
)

// These are final retail CNY/M quotes, before existing group discounts.
// The multiplier is explanatory and must not be applied to these rates again.
type ChannelTextPrice struct {
	ChannelID      int      `json:"channel_id"`
	ModelName      string   `json:"model_name"`
	EnableGroups   []string `json:"enable_groups"`
	Currency       string   `json:"currency"`
	PricingSource  string   `json:"pricing_source"`
	SaleMultiplier float64  `json:"text_sale_multiplier"`
	types.TextTokenCostCNY
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
		seen[key] = &ChannelTextPrice{ChannelID: ability.ChannelId, ModelName: ability.Model,
			EnableGroups: []string{ability.Group}, Currency: "CNY", PricingSource: "procurement",
			SaleMultiplier: contract.Multiplier, TextTokenCostCNY: rate}
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

// Models without a global token/fixed price and served only under channel
// contracts expose the highest base quote in the legacy summary. Existing
// global summaries are preserved. Neither case changes persisted options.
func applyExclusiveChannelTextQuote(pricing *Pricing, quotes []ChannelTextPrice, hasLegacy bool) {
	if hasLegacy || len(quotes) == 0 {
		return
	}
	modelRatios := ratio_setting.GetModelRatioCopy()
	for _, candidate := range RoutingModelCandidates(pricing.ModelName) {
		if _, configured := ratio_setting.GetModelPrice(candidate, false); configured {
			return
		}
		if _, configured := modelRatios[ratio_setting.FormatMatchingModelName(candidate)]; configured {
			return
		}
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
