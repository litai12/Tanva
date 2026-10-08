package official_pricing

const openAISource = "https://developers.openai.com/api/docs/pricing"

func openAIContextPrice(id string, input, output, cache, write float64) ModelPrice {
	short := rate(input, output, number(cache), number(write))
	short.MaxPromptTokens = 272000
	long := rate(input*2, output*1.5, number(cache*2), number(write*2))
	return entry(id, "OpenAI", openAISource, short, long)
}

func openAIPrices() []ModelPrice {
	prices := []ModelPrice{
		openAIContextPrice("gpt-6-astra", 10, 50, 1, 12.5),
		openAIContextPrice("gpt-6.1-sol", 2, 10, .1, 2.5),
		openAIContextPrice("gpt-6-sol", 2, 10, .2, 2.5),
		openAIContextPrice("gpt-6-luna", .1, .5, .01, .125),
		openAIContextPrice("gpt-5.6-sol", 4, 20, .4, 5),
		openAIContextPrice("gpt-5.6-terra", 2, 12, .2, 2.5),
		openAIContextPrice("gpt-5.6-luna", .2, 1.2, .02, .25),
	}
	for i := range prices {
		if prices[i].OfficialModelID == "gpt-5.6-sol" {
			prices[i].Notes = "Official promotional rate is guaranteed at least through 2026-11-21; no later price has been published."
		}
	}
	// These additional official chat models are explicit rows in the same
	// standard price table. A missing cache-write price remains absent.
	for _, item := range []struct {
		id                   string
		input, output, cache float64
	}{
		{"gpt-5.5", 5, 30, .5}, {"gpt-5.4", 2.5, 15, .25},
		{"gpt-5.4-mini", .75, 4.5, .075}, {"gpt-5.4-nano", .2, 1.25, .02},
		{"gpt-5.3-codex", 1.75, 14, .175}, {"gpt-5.2", 1.75, 14, .175},
		{"gpt-5.1", 1.25, 10, .125}, {"gpt-5", 1.25, 10, .125},
		{"gpt-5-mini", .25, 2, .025}, {"gpt-5-nano", .05, .4, .005},
		{"gpt-4.1", 2, 8, .5}, {"gpt-4.1-mini", .4, 1.6, .1},
		{"gpt-4.1-nano", .1, .4, .025}, {"gpt-4o", 2.5, 10, 1.25},
		{"gpt-4o-mini", .15, .6, .075},
	} {
		base := rate(item.input, item.output, number(item.cache), nil)
		model := entry(item.id, "OpenAI", openAISource, base)
		if item.id == "gpt-5.5" || item.id == "gpt-5.4" {
			base.MaxPromptTokens = 272000
			model.Tiers = []PriceTier{base, rate(item.input*2, item.output*1.5, number(item.cache*2), nil)}
		}
		prices = append(prices, model)
	}
	return prices
}
