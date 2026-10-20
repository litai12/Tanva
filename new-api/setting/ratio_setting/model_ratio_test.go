package ratio_setting

import (
	"math"
	"testing"
)

func TestDefaultSeedance2ModelRatiosUseOnePointFiveMarkup(t *testing.T) {
	want := 31.25 * 1.5
	defaults := GetDefaultModelRatioMap()

	for _, model := range []string{"seedance-2", "seedance-2-fast", "seedance-2-mini"} {
		if got := defaults[model]; got != want {
			t.Errorf("%s default ratio = %v, want %v", model, got, want)
		}
	}
}

func TestDefaultHailuoH3RatioUsesTwoKRetailPrice(t *testing.T) {
	// RMB 1.20/s maps to ModelRatio 45. The Tencent VOD adaptor applies 1.25x
	// for 4K, producing ModelRatio 56.25 / RMB 1.50 per processed second.
	if got := GetDefaultModelRatioMap()["hailuo-h3"]; got != 45 {
		t.Fatalf("hailuo-h3 ModelRatio = %v, want 45", got)
	}
}

func TestDefaultDoubaoSeed20RatiosUseSupportedVersions(t *testing.T) {
	expectedRatios := map[string]float64{
		"doubao-seed-2-0-mini-260428": 0.2 / 1000 * USD * 1.5,
		"doubao-seed-2-0-lite-260428": 0.6 / 1000 * USD * 1.5,
		"doubao-seed-2-0-pro-260215":  3.2 / 1000 * USD * 1.5,
	}
	for model, expectedRatio := range expectedRatios {
		if _, ok := defaultModelRatio[model]; !ok {
			t.Errorf("defaultModelRatio does not contain %s", model)
		}
		if got := defaultModelRatio[model]; got != expectedRatio {
			t.Errorf("%s default ratio = %v, want %v", model, got, expectedRatio)
		}
		if _, ok := defaultCompletionRatio[model]; !ok {
			t.Errorf("defaultCompletionRatio does not contain %s", model)
		}
		if _, ok := defaultCacheRatio[model]; !ok {
			t.Errorf("defaultCacheRatio does not contain %s", model)
		}
	}

	if _, ok := defaultModelRatio["doubao-seed-2-0-pro-260428"]; ok {
		t.Error("defaultModelRatio contains unsupported doubao-seed-2-0-pro-260428")
	}
	for _, model := range []string{
		"doubao-seed-2-0-mini-260428",
		"doubao-seed-2-0-lite-260428",
	} {
		if got := defaultAudioRatio[model]; got != 15 {
			t.Errorf("%s default audio ratio = %v, want 15", model, got)
		}
	}
}

func TestDefaultDoubaoSeed21OfficialTokenPrices(t *testing.T) {
	for _, test := range []struct {
		model                    string
		input, output, cacheRead float64
	}{
		{"doubao-seed-2-1-pro-260915", 6, 30, 1.2},
		{"doubao-seed-2-1-lite-260915", 0.8, 2.7, 0.16},
		{"doubao-seed-2-1-turbo-260628", 3, 15, 0.6},
	} {
		t.Run(test.model, func(t *testing.T) {
			// The gateway converts CNY/M input to ModelRatio by dividing by two.
			input := defaultModelRatio[test.model] * 2
			output := input * defaultCompletionRatio[test.model]
			cacheRead := input * defaultCacheRatio[test.model]
			for _, price := range []struct {
				kind      string
				got, want float64
			}{
				{"input", input, test.input * 1.5},
				{"output", output, test.output * 1.5},
				{"cache read", cacheRead, test.cacheRead * 1.5},
			} {
				if math.Abs(price.got-price.want) > 1e-12 {
					t.Errorf("%s retail price = %v CNY/M, want %v", price.kind, price.got, price.want)
				}
			}
		})
	}
	if got := defaultAudioRatio["doubao-seed-2-1-lite-260915"]; got != 15 {
		t.Errorf("Seed 2.1 Lite audio ratio = %v, want 15", got)
	}
}
