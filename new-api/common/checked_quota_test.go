package common

import (
	"github.com/shopspring/decimal"
	"math"
	"testing"
)

func TestCheckedQuotaRejectsOverflowBeforeNarrowing(t *testing.T) {
	for _, raw := range []string{"-1", "-0.01", "9223372036854775808", "2305843009213694000000000"} {
		value, err := decimal.NewFromString(raw)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := CheckedQuota(value); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	for _, invalid := range []float64{math.NaN(), math.Inf(1), -1} {
		if _, err := CheckedQuotaProduct(invalid, 500000); err == nil {
			t.Fatal("accepted invalid factor")
		}
	}
	quota, err := CheckedQuotaProduct(0.5, 500000, 1)
	if err != nil || quota != 250000 {
		t.Fatalf("got %d, %v", quota, err)
	}
}
