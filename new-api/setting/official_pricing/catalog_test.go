package official_pricing

import (
	"math"
	"net/url"
	"testing"
)

func TestVerifiedLocalModelRates(t *testing.T) {
	for _, test := range []struct {
		id                   string
		input, output, cache float64
	}{
		{"gpt-6-astra", 10, 50, 1}, {"gpt-6.1-sol", 2, 10, .1},
		{"gpt-6-sol", 2, 10, .2}, {"gpt-6-luna", .1, .5, .01},
		{"gpt-5.6-sol", 4, 20, .4}, {"gpt-5.6-terra", 2, 12, .2},
		{"gpt-5.6-luna", .2, 1.2, .02}, {"gemini-3.5-flash", 1.5, 9, .15},
		{"gemini-3.6-flash", .75, 3.75, .075}, {"gemini-3.7-flash", .75, 3.75, .075},
		{"gemini-3.8-flash", .75, 3.75, .075}, {"gemini-3-flash-preview", .5, 3, .05},
		{"gemini-3.1-flash-lite", .25, 1.5, .025}, {"claude-fable-5", 10, 50, 1},
		{"claude-opus-4-8", 5, 25, .5}, {"claude-sonnet-5", 2, 10, .2},
		{"claude-sonnet-5-5", 2, 10, .1},
		{"claude-haiku-4.5", 1, 5, .1}, {"claude-sonnet-4.5", 3, 15, .3},
	} {
		t.Run(test.id, func(t *testing.T) {
			got, ok := Lookup(test.id)
			if !ok || got.Input != test.input || got.Output != test.output || got.CacheRead == nil || *got.CacheRead != test.cache {
				t.Fatalf("incorrect official rate: %#v", got)
			}
		})
	}
}

func TestUnverifiedIDsAreNotGuessed(t *testing.T) {
	for _, id := range []string{"gemini-3.1-pro", "gemini-9-flash", "gpt-6.1-sol-high", "gpt-6-sol-vendor", "claude-opus-4-8-xhigh", " gpt-6-sol"} {
		if _, ok := Lookup(id); ok {
			t.Fatalf("unexpected implicit alias %q", id)
		}
	}
}

func TestCacheSemanticsAndContextTiers(t *testing.T) {
	opus, _ := Lookup("claude-opus-4-8")
	if *opus.CacheWrite != 6.25 || *opus.CacheWrite5m != 6.25 || *opus.CacheWrite1h != 10 {
		t.Fatal("Claude cache duration prices differ from official table")
	}
	gemini, _ := Lookup("gemini-3.1-pro-preview")
	if gemini.CacheWrite != nil || gemini.CacheWrite1h != nil || *gemini.CacheStorageUSDPerMillionTokenHour != 4.5 {
		t.Fatal("Gemini storage must not become a write token charge")
	}
	if len(gemini.Tiers) != 2 || gemini.Tiers[0].MaxPromptTokens != 200000 || gemini.Tiers[1].Input != 4 || gemini.Tiers[1].Output != 18 {
		t.Fatal("incorrect Gemini context tiers")
	}
	openAI, _ := Lookup("gpt-6.1-sol")
	if openAI.CacheWrite5m != nil || len(openAI.Tiers) != 2 || openAI.Tiers[0].MaxPromptTokens != 272000 || openAI.Tiers[1].Input != 4 || openAI.Tiers[1].Output != 15 || *openAI.Tiers[1].CacheWrite != 5 {
		t.Fatal("incorrect OpenAI cache or context tiers")
	}
	flash, _ := Lookup("gemini-3.8-flash")
	if flash.EffectiveUntil != "2026-12-31" || len(flash.UpcomingRates) != 1 || flash.UpcomingRates[0].EffectiveFrom != "2027-01-01" || flash.UpcomingRates[0].Tiers[0].Input != 1.5 {
		t.Fatal("announced promotion expiry missing")
	}
}

func TestSonnet55CurrentCachePriceAcrossFullContext(t *testing.T) {
	sonnet, exists := LookupID("claude-sonnet-5-5")
	if !exists || sonnet.VerifiedAt != "2026-10-08" || len(sonnet.Tiers) != 1 {
		t.Fatal("current Sonnet 5.5 evidence and single standard context tier are required")
	}
	tier := sonnet.Tiers[0]
	if tier.MaxPromptTokens != 0 || tier.Input != 2 || tier.Output != 10 ||
		tier.CacheRead == nil || *tier.CacheRead != .1 ||
		tier.CacheWrite == nil || *tier.CacheWrite != 2.5 ||
		tier.CacheWrite5m == nil || *tier.CacheWrite5m != 2.5 ||
		tier.CacheWrite1h == nil || *tier.CacheWrite1h != 4 {
		t.Fatal("Sonnet 5.5 must use current cache pricing without a long-context surcharge")
	}
}

func TestVerifiedSnapshotAndRetiredClaudeContext(t *testing.T) {
	snapshot, exists := Lookup("gpt-5.4-2026-03-05")
	if !exists || snapshot.OfficialModelID != "gpt-5.4" || snapshot.Input != 2.5 {
		t.Fatal("documented GPT snapshot identity missing")
	}
	for _, id := range []string{"claude-sonnet-4.5", "claude-sonnet-4", "claude-opus-4-6", "claude-sonnet-4-6"} {
		price, exists := Lookup(id)
		if !exists || len(price.Tiers) != 1 || price.Tiers[0].MaxPromptTokens != 0 || price.Notes == "" {
			t.Fatalf("historical Claude long-context surcharge must not be used: %s", id)
		}
	}
}

func TestCatalogSnapshotsDoNotMutateAuthority(t *testing.T) {
	item, _ := Lookup("gemini-3.8-flash")
	*item.CacheRead = 100
	*item.Tiers[0].CacheRead = 100
	item.UpcomingRates[0].Tiers[0].Input = 100
	*item.ImageInput = 100
	*item.Tiers[0].AudioInput = 100
	*item.UpcomingRates[0].Tiers[0].AudioCacheRead = 100
	item, _ = Lookup("gemini-3.8-flash")
	if *item.CacheRead != .075 || *item.Tiers[0].CacheRead != .075 || item.UpcomingRates[0].Tiers[0].Input != 1.5 ||
		*item.ImageInput != .75 || *item.Tiers[0].AudioInput != .75 || *item.UpcomingRates[0].Tiers[0].AudioCacheRead != .15 {
		t.Fatal("caller changed authoritative rates")
	}
	list := List()
	list[0].Tiers[0].Input = 100
	got, _ := LookupID(list[0].OfficialModelID)
	if got.Tiers[0].Input == 100 {
		t.Fatal("List leaked mutable authority")
	}
}

func TestGeminiModalityPricesAreExplicitAndTiered(t *testing.T) {
	for _, item := range geminiPrices() {
		for _, tier := range item.Tiers {
			if tier.ImageInput == nil || tier.VideoInput == nil || tier.AudioInput == nil || tier.AudioCacheRead == nil ||
				*tier.ImageInput != tier.Input || *tier.VideoInput != tier.Input {
				t.Fatalf("Gemini modality rate missing or incorrect: %s", item.OfficialModelID)
			}
		}
	}
	lite, _ := Lookup("gemini-3.1-flash-lite")
	if *lite.AudioInput != .5 || *lite.AudioCacheRead != .05 || *lite.Tiers[0].AudioInput != .5 {
		t.Fatal("audio rate must not inherit the cheaper text rate")
	}
	pro, _ := Lookup("gemini-3.1-pro-preview")
	if *pro.Tiers[1].AudioInput != 4 || *pro.Tiers[1].AudioCacheRead != .4 || *pro.Tiers[1].ImageInput != 4 {
		t.Fatal("long-context modality rates must use the same context tier")
	}
}

func TestChatVisionRatesUseBillableInputTokenPrice(t *testing.T) {
	for _, model := range List() {
		if model.ImageInput == nil || *model.ImageInput != model.Input {
			t.Fatalf("missing explicit chat vision price: %s", model.OfficialModelID)
		}
		for _, tier := range model.Tiers {
			if tier.ImageInput == nil || *tier.ImageInput != tier.Input {
				t.Fatalf("vision rate differs from billable input rate: %s", model.OfficialModelID)
			}
		}
	}
}

func TestEveryPriceHasEvidenceAndValidTiers(t *testing.T) {
	for _, item := range List() {
		if item.Currency != "USD" || item.Tier != "standard" || (item.VerifiedAt != "2026-10-05" && item.VerifiedAt != "2026-10-06" && item.VerifiedAt != "2026-10-08") || len(item.Tiers) == 0 {
			t.Fatalf("missing authority metadata for %s", item.OfficialModelID)
		}
		u, err := url.Parse(item.SourceURL)
		if err != nil || u.Scheme != "https" || !officialHosts[u.Host] {
			t.Fatalf("nonofficial source %s", item.SourceURL)
		}
		last := 0
		for i, tier := range item.Tiers {
			if tier.Input <= 0 || tier.Output <= 0 || math.IsNaN(tier.Input) || math.IsNaN(tier.Output) {
				t.Fatalf("invalid price %s", item.OfficialModelID)
			}
			if tier.MaxPromptTokens == 0 && i != len(item.Tiers)-1 {
				t.Fatalf("unbounded tier precedes bounded tier %s", item.OfficialModelID)
			}
			if tier.MaxPromptTokens != 0 && tier.MaxPromptTokens <= last {
				t.Fatalf("tiers unsorted %s", item.OfficialModelID)
			}
			last = tier.MaxPromptTokens
		}
	}
}

var officialHosts = map[string]bool{"developers.openai.com": true, "ai.google.dev": true, "platform.claude.com": true,
	"docs.x.ai": true, "docs.z.ai": true, "platform.moonshot.ai": true, "www.alibabacloud.com": true,
	"platform.minimax.io": true, "mistral.ai": true, "build.nvidia.com": true, "fireworks.ai": true, "api-docs.deepseek.com": true}

func TestFactoryOpenModelRates(t *testing.T) {
	for _, test := range []struct {
		id                   string
		input, output, cache float64
		tiers                int
	}{
		{"grok-4.7", 2, 6, .5, 2}, {"grok-4.6", 2, 6, .5, 2}, {"glm-5.3", 1.4, 4.4, .26, 1},
		{"glm-5.3-flash", .15, .5, .03, 1}, {"glm-5.2", 1.4, 4.4, .26, 1}, {"kimi-k3", 3, 15, .3, 1},
		{"qwen3.8-max", 2, 6, .25, 1}, {"minimax-m3", .3, 1.2, .06, 2}, {"minimax-m2.7", .3, 1.2, .06, 1},
		{"mistral-medium-3.5", 1.5, 7.5, .15, 1}, {"nemotron-3-ultra", .5, 2.5, .15, 1}, {"deepseek-v4.1-flash", .3, 1.2, .006, 1},
	} {
		got, ok := LookupID(test.id)
		if !ok || got.Input != test.input || got.Output != test.output || *got.CacheRead != test.cache || len(got.Tiers) != test.tiers {
			t.Fatalf("incorrect vendor rate for %s: %#v", test.id, got)
		}
	}
	if grok, _ := LookupID("grok-4.7"); grok.Tiers[0].MaxPromptTokens != 199999 || grok.Tiers[1].Input != 4 || grok.Tiers[1].Output != 12 {
		t.Fatal("xAI long-context tier missing")
	}
	if flash, _ := LookupID("deepseek-v4.1-flash"); flash.Notes == "" {
		t.Fatal("serving-provider substitution must be recorded")
	}
}
