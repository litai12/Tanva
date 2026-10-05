package operation_setting

import "testing"

func TestTanvaCurrencyIsRMBWithoutLegacyConversion(t *testing.T) {
	before := generalSetting
	t.Cleanup(func() { generalSetting = before })
	for _, legacyType := range []string{QuotaDisplayTypeUSD, QuotaDisplayTypeTokens, QuotaDisplayTypeCustom, QuotaDisplayTypeCNY} {
		generalSetting.QuotaDisplayType = legacyType
		if GetQuotaDisplayType() != "CNY" || GetCurrencySymbol() != "¥" || !IsCNYDisplay() || !IsCurrencyDisplay() {
			t.Fatalf("legacy %s must not change Tanva RMB display", legacyType)
		}
		if GetUsdToCurrencyRate(7.3) != 1 || GetGeneralSetting().QuotaDisplayType != "CNY" {
			t.Fatalf("legacy %s must not convert RMB numbers", legacyType)
		}
	}
}
