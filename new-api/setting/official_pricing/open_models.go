package official_pricing

// Vendors outside OpenAI, Google and Anthropic. Rates are each vendor's own
// standard API list price. Provider, region, cache semantics and time-based
// discounts are recorded explicitly rather than inferred from serving routes.

func vendorPrice(id, provider, source string, tiers ...PriceTier) ModelPrice {
	model := entry(id, provider, source, tiers...)
	model.VerifiedAt = "2026-10-06"
	return model
}

func textRate(input, output, cache float64, write *float64) PriceTier {
	return rate(input, output, number(cache), write)
}

func openModelPrices() []ModelPrice {
	prices := []ModelPrice{}
	for _, id := range []string{"grok-4.7", "grok-4.6"} {
		short := textRate(2, 6, .5, nil)
		short.MaxPromptTokens = 199999
		model := vendorPrice(id, "xAI", "https://docs.x.ai/developers/models/"+id, short, textRate(4, 12, 1, nil))
		model.VerifiedAt = "2026-10-08"
		model.Notes = "Global standard API rates. Requests with at least 200,000 prompt tokens use the long-context rate for all tokens. US regional endpoint rates are 1.1x these prices."
		prices = append(prices, model)
	}
	const zai = "https://docs.z.ai/guides/overview/pricing"
	kimiTier := textRate(3, 15, .3, number(3))
	kimiTier.CacheWrite5m, kimiTier.CacheWrite1h = number(3), number(6)
	kimi := vendorPrice("kimi-k3", "Moonshot AI", "https://platform.moonshot.ai/docs/pricing/chat", kimiTier)
	kimi.VerifiedAt = "2026-10-08"
	kimi.Notes = "Uniform rates across the 1M-token context. Cache writes are billed separately: the default 5-minute TTL costs $3/M tokens, and 1-hour TTL costs $6/M tokens. Cache hits refresh the TTL without an additional write charge."
	qwen := vendorPrice("qwen3.8-max", "Alibaba Cloud", "https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max", textRate(2, 6, .25, number(2.5)))
	qwen.VerifiedAt = "2026-10-08"
	qwen.Notes = "Singapore (International) standard API prices. CacheRead is the implicit-cache input rate ($0.25/M tokens); explicit-cache creation costs $2.5/M tokens and explicit-cache reads cost $0.17/M tokens. Other deployment regions publish different prices."
	prices = append(prices,
		vendorPrice("glm-5.3", "Z.ai", zai, textRate(1.4, 4.4, .26, nil)),
		vendorPrice("glm-5.3-flash", "Z.ai", zai, textRate(.15, .5, .03, nil)),
		vendorPrice("glm-5.2", "Z.ai", zai, textRate(1.4, 4.4, .26, nil)),
		kimi,
		qwen,
		vendorPrice("minimax-m2.7", "MiniMax", "https://platform.minimax.io/docs/guides/pricing", textRate(.3, 1.2, .06, number(.375))),
		vendorPrice("mistral-medium-3.5", "Mistral AI", "https://mistral.ai/pricing", textRate(1.5, 7.5, .15, nil)),
		vendorPrice("nemotron-3-ultra", "NVIDIA", "https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b", textRate(.5, 2.5, .15, nil)),
	)
	m3 := textRate(.3, 1.2, .06, nil)
	m3.MaxPromptTokens = 512000
	prices = append(prices, vendorPrice("minimax-m3", "MiniMax", "https://platform.minimax.io/docs/guides/pricing", m3, textRate(.6, 2.4, .12, nil)))
	flash := vendorPrice("deepseek-v4.1-flash", "DeepSeek", "https://api-docs.deepseek.com/quick_start/pricing/", textRate(.3, 1.2, .006, nil))
	flash.VerifiedAt = "2026-10-08"
	flash.Notes = "First-party DeepSeek-V4.1-Flash (API model deepseek-flash) USD peak prices. Off-peak prices are 50% lower; this catalog does not automatically apply time-based discounts. Peak hours are Monday-Friday 01:00-04:00 and 06:00-10:00 UTC, excluding Chinese public holidays. The separate CNY price table is not converted into this USD catalog."
	prices = append(prices, flash)
	return prices
}
