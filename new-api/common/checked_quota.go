package common

import (
	"fmt"
	"github.com/shopspring/decimal"
	"math"
)

// CheckedQuota validates before narrowing. Decimal.IntPart silently wraps
// values outside int64; a negative or wrapped charge must never reach a wallet.
func CheckedQuota(value decimal.Decimal) (int, error) {
	rounded := value.Round(0)
	max := decimal.NewFromInt(int64(^uint(0) >> 1))
	if value.IsNegative() || rounded.GreaterThan(max) {
		return 0, fmt.Errorf("billing quota out of range: %s", value.String())
	}
	return int(rounded.IntPart()), nil
}

func CheckedQuotaProduct(factors ...float64) (int, error) {
	value := decimal.NewFromInt(1)
	for _, factor := range factors {
		if math.IsNaN(factor) || math.IsInf(factor, 0) || factor < 0 {
			return 0, fmt.Errorf("invalid billing factor: %v", factor)
		}
		value = value.Mul(decimal.NewFromFloat(factor))
	}
	return CheckedQuota(value)
}
