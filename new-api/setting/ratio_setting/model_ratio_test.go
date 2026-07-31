package ratio_setting

import "testing"

func TestDefaultSeedance2ModelRatiosUseOnePointFiveMarkup(t *testing.T) {
	want := 31.25 * 1.5
	defaults := GetDefaultModelRatioMap()

	for _, model := range []string{"seedance-2", "seedance-2-fast", "seedance-2-mini"} {
		if got := defaults[model]; got != want {
			t.Errorf("%s default ratio = %v, want %v", model, got, want)
		}
	}
}

func TestDefaultDoubaoSeed20RatiosUseSupportedVersions(t *testing.T) {
	for _, model := range []string{
		"doubao-seed-2-0-mini-260428",
		"doubao-seed-2-0-lite-260428",
		"doubao-seed-2-0-pro-260215",
	} {
		if _, ok := defaultModelRatio[model]; !ok {
			t.Errorf("defaultModelRatio does not contain %s", model)
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
}
