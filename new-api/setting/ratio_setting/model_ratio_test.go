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
