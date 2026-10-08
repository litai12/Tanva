package official_pricing

const geminiSource = "https://ai.google.dev/gemini-api/docs/pricing"

func geminiRate(input, output, cache, storage float64) PriceTier {
	tier := rate(input, output, number(cache), nil)
	tier.CacheStorageUSDPerMillionTokenHour = number(storage)
	// The Standard table's undifferentiated input/cache rates cover input
	// modalities. Models with a separately published audio rate override it.
	tier.ImageInput, tier.VideoInput, tier.AudioInput = number(input), number(input), number(input)
	tier.AudioCacheRead = number(cache)
	return tier
}

func geminiAudioRate(input, output, cache, storage, audioInput, audioCacheRead float64) PriceTier {
	tier := geminiRate(input, output, cache, storage)
	tier.AudioInput, tier.AudioCacheRead = number(audioInput), number(audioCacheRead)
	return tier
}

func geminiPrices() []ModelPrice {
	prices := []ModelPrice{}
	for _, id := range []string{"gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash"} {
		model := entry(id, "Google", geminiSource, geminiRate(.75, 3.75, .075, .5))
		model.EffectiveUntil = "2026-12-31"
		model.Notes = "Standard paid tier promotional price through 2026-12-31. Cache storage is a separate token-hour charge, not a token write rate."
		model.UpcomingRates = []PricePeriod{{EffectiveFrom: "2027-01-01", Tiers: []PriceTier{geminiRate(1.5, 7.5, .15, 1)}}}
		prices = append(prices, model)
	}
	prices = append(prices, entry("gemini-3.5-flash", "Google", geminiSource, geminiRate(1.5, 9, .15, 1)))
	flashLite := entry("gemini-3.1-flash-lite", "Google", geminiSource, geminiAudioRate(.25, 1.5, .025, 1, .5, .05))
	prices = append(prices, flashLite)
	flash := entry("gemini-3-flash-preview", "Google", geminiSource, geminiAudioRate(.5, 3, .05, 1, 1, .1))
	prices = append(prices, flash)
	short := geminiRate(2, 12, .2, 4.5)
	short.MaxPromptTokens = 200000
	for _, id := range []string{"gemini-3.1-pro-preview", "gemini-3.1-pro-preview-customtools"} {
		prices = append(prices, entry(id, "Google", geminiSource, short, geminiRate(4, 18, .4, 4.5)))
	}
	pro25 := geminiRate(1.25, 10, .125, 4.5)
	pro25.MaxPromptTokens = 200000
	prices = append(prices, entry("gemini-2.5-pro", "Google", geminiSource, pro25, geminiRate(2.5, 15, .25, 4.5)))
	return prices
}
