package model

import "testing"

func TestNormalizeTanvaCurrencyOptionsPreservesModelNumbers(t *testing.T) {
	for _, tc := range []struct{ key, input, want string }{
		{"USDExchangeRate", "7.3", "1"}, {"Price", "7.3", "1"},
		{"general_setting.quota_display_type", "USD", "CNY"},
		{"general_setting.quota_display_type", "TOKENS", "CNY"},
		{"ModelRatio", `{"other-model":7.3}`, `{"other-model":7.3}`},
		{"ModelPrice", `{"other-model":0.01}`, `{"other-model":0.01}`},
		{"TopupGroupRatio", `{"default":1.5}`, `{"default":1.5}`},
	} {
		if got := normalizeTanvaCurrencyOption(tc.key, tc.input); got != tc.want {
			t.Fatalf("%s got %s want %s", tc.key, got, tc.want)
		}
	}
}
