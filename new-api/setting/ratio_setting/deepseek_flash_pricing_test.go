package ratio_setting

import (
	"testing"
	"time"
)

func TestDeepSeekFlashCNYPeriodBoundariesAndHolidays(t *testing.T) {
	for _, tc := range []struct {
		at   string
		want float64
	}{
		{"2026-10-08T00:59:59.999Z", .5}, {"2026-10-08T01:00:00Z", 1},
		{"2026-10-08T03:59:59.999Z", 1}, {"2026-10-08T04:00:00Z", .5},
		{"2026-10-08T05:59:59.999Z", .5}, {"2026-10-08T06:00:00Z", 1},
		{"2026-10-08T09:59:59.999Z", 1}, {"2026-10-08T10:00:00Z", .5},
		{"2026-10-05T01:00:00Z", .5}, {"2026-10-07T06:00:00Z", .5},
		{"2026-01-01T01:00:00Z", .5}, {"2026-02-23T01:00:00Z", .5},
		{"2026-04-06T06:00:00Z", .5}, {"2026-05-05T01:00:00Z", .5},
		{"2026-06-19T01:00:00Z", .5}, {"2026-09-25T06:00:00Z", .5},
		// Makeup Saturdays/Sundays still receive off-peak rates.
		{"2026-01-04T01:00:00Z", .5}, {"2026-02-14T01:00:00Z", .5},
		{"2026-02-28T01:00:00Z", .5}, {"2026-05-09T01:00:00Z", .5},
		{"2026-09-20T01:00:00Z", .5}, {"2026-10-10T01:00:00Z", .5},
		{"2025-12-31T16:00:00Z", .5},
	} {
		at, err := time.Parse(time.RFC3339Nano, tc.at)
		if err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"deepseek-v4.1-flash", "deepseek-flash", "deepseek-v4-flash"} {
			got, period, err := ResolveDeepSeekFlashCNYRatio(name, 1, at)
			if err != nil || got != tc.want {
				t.Fatalf("%s %s: ratio=%v err=%v", name, tc.at, got, err)
			}
			if (period == "peak") != (tc.want == 1) {
				t.Fatalf("%s: unexpected period %s", tc.at, period)
			}
		}
	}
}

func TestDeepSeekFlashCNYCalendarUnknownAndOtherModelsUnchanged(t *testing.T) {
	for _, at := range []time.Time{time.Time{}, time.Date(2026, 12, 31, 16, 0, 0, 0, time.UTC)} {
		if _, _, err := ResolveDeepSeekFlashCNYRatio("deepseek-flash", 1, at); err == nil {
			t.Fatal("unknown calendar should fail")
		}
	}
	for _, name := range []string{"gpt-6-astra", "deepseek-chat", "deepseek-v4-pro", "deepseek-v4-flash-260425", "xiaot-agent-deepseek-v4-flash"} {
		got, period, err := ResolveDeepSeekFlashCNYRatio(name, .15, time.Time{})
		if got != .15 || period != "" || err != nil {
			t.Fatalf("changed unrelated model %s", name)
		}
	}
}

func TestDeepSeekFlashCNYDefaultsContainNoRetailMarkup(t *testing.T) {
	for _, name := range []string{"deepseek-v4.1-flash", "deepseek-flash", "deepseek-v4-flash"} {
		if defaultModelRatio[name] != 1 || defaultCompletionRatio[name] != 4 || defaultCacheRatio[name] != .02 {
			t.Fatalf("%s has incorrect CNY input/output/cache default ratios", name)
		}
	}
}
