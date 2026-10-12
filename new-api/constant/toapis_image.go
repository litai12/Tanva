package constant

import "strings"

const ToAPISNanoBanana21 = "gemini-nano-banana-2.1"

func IsToAPISImage25VIP(model string) bool {
	switch strings.ToLower(strings.TrimSpace(model)) {
	case "gpt-image-2.5-flare-vip", "gpt-image-2.5-sunburst-vip":
		return true
	}
	return false
}

func IsToAPISPricedImage(model string) bool {
	return IsToAPISImage25VIP(model) || model == ToAPISNanoBanana21
}

// ToAPISImagePriceCNY is Tanva's fixed retail price, independent of the
// upstream VIP token settlement. Resolution and quality remain separate.
func ToAPISImagePriceCNY(model, quality, resolution string) (float64, bool) {
	tier := strings.ToUpper(strings.TrimSpace(resolution))
	index := map[string]int{"1K": 0, "2K": 1, "4K": 2}
	i, ok := index[tier]
	if !ok {
		return 0, false
	}
	if model == ToAPISNanoBanana21 {
		return [3]float64{0.3, 0.4, 0.5}[i], true
	}
	if !IsToAPISImage25VIP(model) {
		return 0, false
	}
	quality = strings.ToLower(strings.TrimSpace(quality))
	if quality == "" || quality == "auto" {
		quality = "high"
	}
	prices := map[string][3]float64{
		"low": {0.2, 0.3, 0.4}, "medium": {0.3, 0.4, 0.5},
		"high": {0.4, 0.6, 0.8}, "xhigh": {0.6, 1, 1.4},
		"max": {1.5, 3, 4.5},
	}
	row, ok := prices[quality]
	return row[i], ok
}
