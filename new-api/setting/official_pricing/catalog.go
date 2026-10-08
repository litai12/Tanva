package official_pricing

import "sort"

var catalog = buildCatalog()

// These aliases are spelling/version IDs with documented pricing identity.
// Unknown suffixes, provider facades, and reasoning-effort names are not guessed.
var aliases = map[string]string{
	"gpt-5.4-2026-03-05": "gpt-5.4",
	"claude-haiku-4.5":   "claude-haiku-4-5-20251001",
	"claude-haiku-4-5":   "claude-haiku-4-5-20251001",
	"claude-sonnet-4":    "claude-sonnet-4-20250514",
	"claude-sonnet-4.5":  "claude-sonnet-4-5-20250929",
	"claude-sonnet-4-5":  "claude-sonnet-4-5-20250929",
	"claude-opus-4-5":    "claude-opus-4-5-20251101",
	"claude-opus-4":      "claude-opus-4-20250514",
	"claude-opus-4-1":    "claude-opus-4-1-20250805",
}

func buildCatalog() map[string]ModelPrice {
	out := make(map[string]ModelPrice)
	for _, entries := range [][]ModelPrice{openAIPrices(), geminiPrices(), claudePrices(), openModelPrices()} {
		for _, item := range entries {
			out[item.OfficialModelID] = item
		}
	}
	return out
}

// Lookup resolves exact official IDs and the finite, verified alias list only.
func Lookup(modelName string) (ModelPrice, bool) {
	if id, exists := aliases[modelName]; exists {
		modelName = id
	}
	return LookupID(modelName)
}

func LookupID(officialModelID string) (ModelPrice, bool) {
	item, exists := catalog[officialModelID]
	if !exists {
		return ModelPrice{}, false
	}
	return cloneModel(item), true
}

// List returns independent snapshots in a stable order.
func List() []ModelPrice {
	out := make([]ModelPrice, 0, len(catalog))
	for _, item := range catalog {
		out = append(out, cloneModel(item))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].OfficialModelID < out[j].OfficialModelID })
	return out
}

// Clone preserves a captured price contract without resolving a newer catalog
// entry, and isolates every optional rate and announced future tier.
func Clone(item ModelPrice) ModelPrice {
	return cloneModel(item)
}

func cloneNumber(value *float64) *float64 {
	if value == nil {
		return nil
	}
	return number(*value)
}

func cloneTier(tier PriceTier) PriceTier {
	tier.CacheRead = cloneNumber(tier.CacheRead)
	tier.CacheWrite = cloneNumber(tier.CacheWrite)
	tier.CacheWrite5m = cloneNumber(tier.CacheWrite5m)
	tier.CacheWrite1h = cloneNumber(tier.CacheWrite1h)
	tier.ImageInput = cloneNumber(tier.ImageInput)
	tier.VideoInput = cloneNumber(tier.VideoInput)
	tier.AudioInput = cloneNumber(tier.AudioInput)
	tier.AudioCacheRead = cloneNumber(tier.AudioCacheRead)
	tier.CacheStorageUSDPerMillionTokenHour = cloneNumber(tier.CacheStorageUSDPerMillionTokenHour)
	return tier
}

func cloneTiers(tiers []PriceTier) []PriceTier {
	out := make([]PriceTier, len(tiers))
	for i, tier := range tiers {
		out[i] = cloneTier(tier)
	}
	return out
}

func cloneModel(item ModelPrice) ModelPrice {
	item.CacheRead = cloneNumber(item.CacheRead)
	item.CacheWrite = cloneNumber(item.CacheWrite)
	item.CacheWrite5m = cloneNumber(item.CacheWrite5m)
	item.CacheWrite1h = cloneNumber(item.CacheWrite1h)
	item.CacheStorageUSDPerMillionTokenHour = cloneNumber(item.CacheStorageUSDPerMillionTokenHour)
	item.ImageInput = cloneNumber(item.ImageInput)
	item.VideoInput = cloneNumber(item.VideoInput)
	item.AudioInput = cloneNumber(item.AudioInput)
	item.AudioCacheRead = cloneNumber(item.AudioCacheRead)
	item.Tiers = cloneTiers(item.Tiers)
	periods := make([]PricePeriod, len(item.UpcomingRates))
	for i, period := range item.UpcomingRates {
		period.Tiers = cloneTiers(period.Tiers)
		periods[i] = period
	}
	item.UpcomingRates = periods
	return item
}
