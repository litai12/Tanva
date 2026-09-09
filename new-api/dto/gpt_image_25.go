package dto

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const GPTImage25Model = "gpt-image-2.5"

// NormalizeGPTImage25Request implements Jichuan's pixel-size contract. Unlike
// GPT Image 2, 4K is a 4096px long edge, including 4096x4096 square images.
// Resolution and quality are independent. Keep the resolved tier for billing.
func NormalizeGPTImage25Request(request ImageRequest) (ImageRequest, error) {
	quality := strings.ToLower(strings.TrimSpace(request.Quality))
	if quality == "" || quality == "auto" || quality == "low" {
		quality = "max"
	}
	switch quality {
	case "high", "xhigh", "max":
	default:
		return request, fmt.Errorf("gpt-image-2.5 quality must be high, xhigh, or max: %q", request.Quality)
	}
	request.Quality = quality
	if request.N != nil && (*request.N == 0 || *request.N > 8) {
		return request, fmt.Errorf("gpt-image-2.5 n must be between 1 and 8")
	}
	metadata := map[string]json.RawMessage{}
	if raw := request.Extra["metadata"]; len(raw) > 0 {
		if err := common.Unmarshal(raw, &metadata); err != nil {
			return request, fmt.Errorf("gpt-image-2.5 metadata: %w", err)
		}
	}
	tier := ""
	for _, fields := range []map[string]json.RawMessage{request.Extra, metadata} {
		for _, key := range []string{"resolution", "imageSize", "image_size"} {
			if raw := fields[key]; len(raw) > 0 {
				var value string
				if err := common.Unmarshal(raw, &value); err != nil {
					return request, fmt.Errorf("gpt-image-2.5 %s must be a string", key)
				}
				value = strings.ToUpper(strings.TrimSpace(value))
				if value != "1K" && value != "2K" && value != "4K" {
					return request, fmt.Errorf("gpt-image-2.5 %s must be 1K, 2K, or 4K", key)
				}
				if tier != "" && tier != value {
					return request, fmt.Errorf("gpt-image-2.5 resolution fields disagree")
				}
				tier = value
			}
		}
	}
	size := strings.ToLower(strings.TrimSpace(request.Size))
	if size == "" || size == "auto" {
		size = "1:1"
	}
	separator := "x"
	isRatio := strings.Contains(size, ":")
	if isRatio {
		separator = ":"
	}
	parts := strings.Split(size, separator)
	if len(parts) != 2 {
		return request, fmt.Errorf("gpt-image-2.5 size must be WIDTH:HEIGHT or WIDTHxHEIGHT")
	}
	w, ew := strconv.Atoi(strings.TrimSpace(parts[0]))
	h, eh := strconv.Atoi(strings.TrimSpace(parts[1]))
	if ew != nil || eh != nil || w <= 0 || h <= 0 {
		return request, fmt.Errorf("gpt-image-2.5 size dimensions must be positive integers")
	}
	if isRatio {
		if tier == "" {
			tier = "1K"
		}
		edge := map[string]int{"1K": 1024, "2K": 2048, "4K": 4096}[tier]
		scale := float64(edge) / float64(max(w, h))
		w = max(16, int(math.Round(float64(w)*scale/16))*16)
		h = max(16, int(math.Round(float64(h)*scale/16))*16)
	} else if w > 4096 || h > 4096 {
		return request, fmt.Errorf("gpt-image-2.5 pixel dimensions must not exceed 4096")
	}
	resolvedTier := "1K"
	if max(w, h) > 2048 {
		resolvedTier = "4K"
	} else if max(w, h) > 1024 {
		resolvedTier = "2K"
	}
	if tier != "" && tier != resolvedTier {
		return request, fmt.Errorf("gpt-image-2.5 pixel size conflicts with resolution %s", tier)
	}
	request.Size = fmt.Sprintf("%dx%d", w, h)
	extra := make(map[string]json.RawMessage, len(request.Extra)+1)
	for key, value := range request.Extra {
		extra[key] = value
	}
	extra["resolution"], _ = common.Marshal(resolvedTier)
	request.Extra = extra
	return request, nil
}
