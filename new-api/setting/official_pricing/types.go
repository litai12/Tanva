// Package official_pricing contains verified first-party API list prices.
// Prices are USD per million tokens; currency conversion belongs to billing.
package official_pricing

type PriceTier struct {
	MaxPromptTokens                    int      `json:"max_prompt_tokens"`
	Input                              float64  `json:"input"`
	Output                             float64  `json:"output"`
	CacheRead                          *float64 `json:"cache_read,omitempty"`
	CacheWrite                         *float64 `json:"cache_write,omitempty"`
	CacheWrite5m                       *float64 `json:"cache_write_5m,omitempty"`
	CacheWrite1h                       *float64 `json:"cache_write_1h,omitempty"`
	ImageInput                         *float64 `json:"image_input,omitempty"`
	VideoInput                         *float64 `json:"video_input,omitempty"`
	AudioInput                         *float64 `json:"audio_input,omitempty"`
	AudioCacheRead                     *float64 `json:"audio_cache_read,omitempty"`
	CacheStorageUSDPerMillionTokenHour *float64 `json:"cache_storage_usd_per_million_token_hour,omitempty"`
}

// PricePeriod records an announced future price without silently applying it.
type PricePeriod struct {
	EffectiveFrom string      `json:"effective_from"`
	Tiers         []PriceTier `json:"tiers"`
}

type ModelPrice struct {
	OfficialModelID string   `json:"official_model_id"`
	Provider        string   `json:"provider"`
	Currency        string   `json:"currency"`
	Tier            string   `json:"tier"`
	SourceURL       string   `json:"source_url"`
	VerifiedAt      string   `json:"verified_at"`
	EffectiveUntil  string   `json:"effective_until,omitempty"`
	Notes           string   `json:"notes,omitempty"`
	Input           float64  `json:"input"`
	Output          float64  `json:"output"`
	CacheRead       *float64 `json:"cache_read,omitempty"`
	// CacheWrite is the provider's default token write rate. OpenAI does not
	// describe it as a 5-minute write; Claude's default is its 5-minute rate.
	CacheWrite                         *float64      `json:"cache_write,omitempty"`
	CacheWrite5m                       *float64      `json:"cache_write_5m,omitempty"`
	CacheWrite1h                       *float64      `json:"cache_write_1h,omitempty"`
	CacheStorageUSDPerMillionTokenHour *float64      `json:"cache_storage_usd_per_million_token_hour,omitempty"`
	ImageInput                         *float64      `json:"image_input,omitempty"`
	VideoInput                         *float64      `json:"video_input,omitempty"`
	AudioInput                         *float64      `json:"audio_input,omitempty"`
	AudioCacheRead                     *float64      `json:"audio_cache_read,omitempty"`
	Tiers                              []PriceTier   `json:"tiers"`
	UpcomingRates                      []PricePeriod `json:"upcoming_rates,omitempty"`
}

func number(value float64) *float64 { return &value }

func rate(input, output float64, cache, write *float64) PriceTier {
	// This catalog contains audited chat/vision models. OpenAI vision and
	// Anthropic vision bill tokenized images at the model's input token rate;
	// Gemini's Standard input table likewise covers images. Tokenization
	// multipliers change the usage count, not the per-token price a second time.
	return PriceTier{Input: input, Output: output, CacheRead: cache, CacheWrite: write, ImageInput: number(input)}
}

func entry(id, provider, source string, tiers ...PriceTier) ModelPrice {
	base := tiers[0]
	return ModelPrice{OfficialModelID: id, Provider: provider, Currency: "USD", Tier: "standard",
		SourceURL: source, VerifiedAt: "2026-10-05", Input: base.Input, Output: base.Output,
		CacheRead: base.CacheRead, CacheWrite: base.CacheWrite, CacheWrite5m: base.CacheWrite5m,
		CacheWrite1h: base.CacheWrite1h, CacheStorageUSDPerMillionTokenHour: base.CacheStorageUSDPerMillionTokenHour,
		ImageInput: base.ImageInput, VideoInput: base.VideoInput, AudioInput: base.AudioInput, AudioCacheRead: base.AudioCacheRead,
		Tiers: tiers}
}
