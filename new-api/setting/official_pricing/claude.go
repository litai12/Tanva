package official_pricing

const claudeSource = "https://platform.claude.com/docs/en/about-claude/pricing"

func claudePrice(id string, input, output, cache float64) ModelPrice {
	tier := rate(input, output, number(cache), number(input*1.25))
	tier.CacheWrite5m, tier.CacheWrite1h = number(input*1.25), number(input*2)
	return entry(id, "Anthropic", claudeSource, tier)
}

func claudePrices() []ModelPrice {
	prices := []ModelPrice{
		claudePrice("claude-fable-5-1", 10, 50, .25),
		claudePrice("claude-fable-5", 10, 50, 1),
		claudePrice("claude-mythos-5-1", 10, 50, .25),
		claudePrice("claude-mythos-5", 10, 50, 1),
		claudePrice("claude-opus-5-5", 4, 20, .2),
		claudePrice("claude-opus-5", 5, 25, .5),
		claudePrice("claude-opus-4-8", 5, 25, .5),
		claudePrice("claude-opus-4-7", 5, 25, .5),
		claudePrice("claude-opus-4-6", 5, 25, .5),
		claudePrice("claude-opus-4-5-20251101", 5, 25, .5),
		claudePrice("claude-opus-4-1-20250805", 15, 75, 1.5),
		claudePrice("claude-opus-4-20250514", 15, 75, 1.5),
		claudePrice("claude-sonnet-5-5", 2, 10, .1),
		claudePrice("claude-sonnet-5", 2, 10, .2),
		claudePrice("claude-sonnet-4-6", 3, 15, .3),
		claudePrice("claude-sonnet-4-5-20250929", 3, 15, .3),
		claudePrice("claude-sonnet-4-20250514", 3, 15, .3),
		claudePrice("claude-haiku-4-5-20251001", 1, 5, .1),
		claudePrice("claude-3-5-haiku-20241022", .8, 4, .08),
	}
	for i := range prices {
		switch prices[i].OfficialModelID {
		case "claude-sonnet-5-5":
			prices[i].VerifiedAt = "2026-10-08"
		case "claude-sonnet-4-5-20250929", "claude-sonnet-4-20250514":
			prices[i].Notes = "The 1M context beta was retired on 2026-04-30. First-party requests exceeding the standard 200K context return an error; historical long-context surcharge prices do not apply. Catalog pricing does not establish model availability."
		case "claude-opus-4-6", "claude-sonnet-4-6":
			prices[i].Notes = "The full 1M context window uses standard pricing, without a long-context surcharge, since 2026-03-13."
		}
	}
	return prices
}
