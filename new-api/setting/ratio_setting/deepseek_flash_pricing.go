package ratio_setting

import (
	"fmt"
	"time"
)

// Official CNY rates: peak input/cache/output = 2/.04/8 per million;
// off-peak = 1/.02/4. Gateway numeric currency units represent CNY for these
// models. Tanva applies its 1.5 markup separately; do not apply it here.
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
// https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html
const DeepSeekFlashPricingVersion = "deepseek-flash-cny-2026-09-10-v1"

func IsDeepSeekFlashCNYModel(modelName string) bool {
	switch FormatMatchingModelName(modelName) {
	case "deepseek-v4.1-flash", "deepseek-flash", "deepseek-v4-flash":
		return true
	default:
		return false
	}
}

// The official UTC rule uses weekdays even on Chinese makeup workdays.
// Beijing holiday dates exclude the entire published holiday interval.
var deepSeekFlashBeijingZone = time.FixedZone("Asia/Shanghai", 8*60*60)

func deepSeekFlashHoliday2026(month time.Month, day int) bool {
	switch month {
	case time.January:
		return day >= 1 && day <= 3
	case time.February:
		return day >= 15 && day <= 23
	case time.April:
		return day >= 4 && day <= 6
	case time.May:
		return day >= 1 && day <= 5
	case time.June:
		return day >= 19 && day <= 21
	case time.September:
		return day >= 25 && day <= 27
	case time.October:
		return day >= 1 && day <= 7
	default:
		return false
	}
}

// ResolveDeepSeekFlashCNYRatio selects the period once at request acceptance.
// The configured base ratio must be the peak CNY numeric rate: ModelRatio=1.
// Existing PriceData captures the result for reservation and final settlement.
// Unknown calendars fail before contacting the supplier, rather than billing
// an assumed holiday schedule. Non-target models are completely unchanged.
func ResolveDeepSeekFlashCNYRatio(modelName string, peakBaseRatio float64, requestedAt time.Time) (float64, string, error) {
	if !IsDeepSeekFlashCNYModel(modelName) {
		return peakBaseRatio, "", nil
	}
	if peakBaseRatio != 1 {
		return 0, "", fmt.Errorf("DeepSeek Flash CNY token pricing requires peak ModelRatio=1; apply the model pricing configuration patch")
	}
	if requestedAt.IsZero() {
		return 0, "", fmt.Errorf("DeepSeek Flash quote unavailable: request timestamp is missing")
	}
	beijing := requestedAt.In(deepSeekFlashBeijingZone)
	if beijing.Year() != 2026 {
		return 0, "", fmt.Errorf("DeepSeek Flash quote unavailable: Chinese holiday calendar is unknown for %d", beijing.Year())
	}
	utc := requestedAt.UTC()
	weekday, hour := utc.Weekday(), utc.Hour()
	peak := weekday >= time.Monday && weekday <= time.Friday &&
		!deepSeekFlashHoliday2026(beijing.Month(), beijing.Day()) &&
		((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10))
	if peak {
		return peakBaseRatio, "peak", nil
	}
	return peakBaseRatio * 0.5, "off_peak", nil
}
