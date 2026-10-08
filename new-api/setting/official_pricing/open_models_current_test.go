package official_pricing

import "testing"

func TestGrokCurrentLongContextBoundary(t *testing.T) {
	for _, id := range []string{"grok-4.7", "grok-4.6"} {
		model, exists := LookupID(id)
		if !exists || model.VerifiedAt != "2026-10-08" || len(model.Tiers) != 2 {
			t.Fatalf("missing current xAI contract: %s", id)
		}
		short, long := model.Tiers[0], model.Tiers[1]
		if short.MaxPromptTokens != 199999 || short.Input != 2 || short.Output != 6 ||
			short.CacheRead == nil || *short.CacheRead != .5 || long.MaxPromptTokens != 0 ||
			long.Input != 4 || long.Output != 12 || long.CacheRead == nil || *long.CacheRead != 1 {
			t.Fatalf("200,000 prompt tokens must start the long-context price: %s", id)
		}
	}
}

func TestKimiCurrentCacheDurationPrices(t *testing.T) {
	model, exists := LookupID("kimi-k3")
	if !exists || len(model.Tiers) != 1 || model.Tiers[0].MaxPromptTokens != 0 {
		t.Fatal("Kimi K3 uses uniform context pricing")
	}
	tier := model.Tiers[0]
	if model.CacheWrite == nil || *model.CacheWrite != 3 ||
		model.CacheWrite5m == nil || *model.CacheWrite5m != 3 ||
		model.CacheWrite1h == nil || *model.CacheWrite1h != 6 ||
		tier.CacheWrite == nil || *tier.CacheWrite != 3 ||
		tier.CacheWrite5m == nil || *tier.CacheWrite5m != 3 ||
		tier.CacheWrite1h == nil || *tier.CacheWrite1h != 6 {
		t.Fatal("Kimi default, 5-minute and 1-hour writes must remain separate from cache reads")
	}
}

func TestDeepSeekUsesFirstPartyUSDPeakContract(t *testing.T) {
	model, exists := LookupID("deepseek-v4.1-flash")
	if !exists || model.Provider != "DeepSeek" ||
		model.SourceURL != "https://api-docs.deepseek.com/quick_start/pricing/" ||
		model.Currency != "USD" || model.Input != .3 || model.Output != 1.2 ||
		model.CacheRead == nil || *model.CacheRead != .006 || model.Notes == "" {
		t.Fatal("DeepSeek must retain its own USD peak contract and time-based pricing note")
	}
}

func TestQwenKeepsSingaporeImplicitCacheContract(t *testing.T) {
	model, exists := LookupID("qwen3.8-max")
	if !exists || model.Input != 2 || model.Output != 6 ||
		model.CacheRead == nil || *model.CacheRead != .25 ||
		model.CacheWrite == nil || *model.CacheWrite != 2.5 ||
		model.SourceURL != "https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max" || model.Notes == "" {
		t.Fatal("Qwen must use one documented region and cache mode without mixing price tables")
	}
}
