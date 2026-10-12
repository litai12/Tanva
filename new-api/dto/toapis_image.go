package dto

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
)

// NormalizeToAPISImageRequest resolves billable inputs before quota estimation.
// The same normalized values are used by the adapter; metadata cannot override
// the billed quality, count, pixel size, or resolution.
func NormalizeToAPISImageRequest(request ImageRequest) (ImageRequest, error) {
	if !constant.IsToAPISPricedImage(request.Model) {
		return request, nil
	}
	extra := make(map[string]json.RawMessage, len(request.Extra)+1)
	for key, value := range request.Extra {
		extra[key] = value
	}
	metadata := map[string]json.RawMessage{}
	if raw := extra["metadata"]; len(raw) > 0 {
		if err := common.Unmarshal(raw, &metadata); err != nil || metadata == nil {
			return request, fmt.Errorf("%s metadata must be an object", request.Model)
		}
	}
	readString := func(raw json.RawMessage, key string) (string, error) {
		var value string
		if err := common.Unmarshal(raw, &value); err != nil {
			return "", fmt.Errorf("%s %s must be a string", request.Model, key)
		}
		return strings.TrimSpace(value), nil
	}
	tier := ""
	for _, fields := range []map[string]json.RawMessage{extra, metadata} {
		for _, key := range []string{"resolution", "imageSize", "image_size"} {
			if raw := fields[key]; len(raw) > 0 {
				value, err := readString(raw, key)
				if err != nil {
					return request, err
				}
				value = strings.ToUpper(value)
				if value != "1K" && value != "2K" && value != "4K" {
					return request, fmt.Errorf("%s resolution must be 1K, 2K, or 4K", request.Model)
				}
				if tier != "" && tier != value {
					return request, fmt.Errorf("%s resolution fields disagree", request.Model)
				}
				tier = value
			}
		}
	}
	if raw := metadata["n"]; len(raw) > 0 {
		var n uint
		if err := common.Unmarshal(raw, &n); err != nil || n != 1 {
			return request, fmt.Errorf("%s n must be 1", request.Model)
		}
	}
	if request.N != nil && *request.N != 1 {
		return request, fmt.Errorf("%s n must be 1", request.Model)
	}
	request.N = common.GetPointer(uint(1))
	if raw := metadata["size"]; len(raw) > 0 {
		value, err := readString(raw, "size")
		if err != nil {
			return request, err
		}
		if request.Size != "" && strings.TrimSpace(request.Size) != value {
			return request, fmt.Errorf("%s size fields disagree", request.Model)
		}
		request.Size = value
	}
	for _, fields := range []map[string]json.RawMessage{extra, metadata} {
		if raw := fields["aspect_ratio"]; len(raw) > 0 {
			value, err := readString(raw, "aspect_ratio")
			if err != nil {
				return request, err
			}
			if request.Size != "" && strings.TrimSpace(request.Size) != value {
				return request, fmt.Errorf("%s size and aspect_ratio disagree", request.Model)
			}
			request.Size = value
		}
	}
	size := strings.ToLower(strings.TrimSpace(request.Size))
	if size == "" || size == "auto" {
		size = "1:1"
	}
	if constant.IsToAPISImage25VIP(request.Model) {
		quality := strings.ToLower(strings.TrimSpace(request.Quality))
		if raw := metadata["quality"]; len(raw) > 0 && quality == "" {
			value, err := readString(raw, "quality")
			if err != nil {
				return request, err
			}
			quality = strings.ToLower(value)
		}
		if quality == "" || quality == "auto" {
			quality = "high"
		}
		if _, ok := constant.ToAPISImagePriceCNY(request.Model, quality, "1K"); !ok {
			return request, fmt.Errorf("%s quality must be auto, low, medium, high, xhigh, or max", request.Model)
		}
		request.Quality = quality
		isRatio := strings.Contains(size, ":")
		separator := "x"
		if isRatio {
			separator = ":"
		}
		parts := strings.Split(size, separator)
		if len(parts) != 2 {
			return request, fmt.Errorf("%s size must be WIDTHxHEIGHT or WIDTH:HEIGHT", request.Model)
		}
		w, ew := strconv.Atoi(parts[0])
		h, eh := strconv.Atoi(parts[1])
		if ew != nil || eh != nil || w <= 0 || h <= 0 || w > 4096 || h > 4096 {
			return request, fmt.Errorf("%s size dimensions must be positive and at most 4096", request.Model)
		}
		gcd := func(a, b int) int {
			for b != 0 {
				a, b = b, a%b
			}
			return a
		}
		divisor := gcd(w, h)
		ratio := fmt.Sprintf("%d:%d", w/divisor, h/divisor)
		allowed := map[string]bool{"1:1": true, "16:9": true, "9:16": true, "4:3": true, "3:4": true, "3:2": true, "2:3": true, "5:4": true, "4:5": true, "7:3": true}
		if !allowed[ratio] {
			return request, fmt.Errorf("%s unsupported size ratio", request.Model)
		}
		if isRatio {
			if tier == "" {
				tier = "1K"
			}
			w /= divisor
			h /= divisor
			edge := map[string]int{"1K": 1024, "2K": 2048, "4K": 4096}[tier]
			step := edge / (max(w, h) * 16)
			w *= step * 16
			h *= step * 16
		}
		resolved := "1K"
		// Standard 1K landscape/portrait requests include 1536x1024.
		// These retail tiers are independent of ToAPIs' token-based VIP costs.
		if max(w, h) > 3072 {
			resolved = "4K"
		} else if max(w, h) > 1536 {
			resolved = "2K"
		}
		if tier != "" && tier != resolved {
			return request, fmt.Errorf("%s pixel size conflicts with resolution", request.Model)
		}
		tier = resolved
		request.Size = fmt.Sprintf("%dx%d", w, h)
	} else {
		allowed := map[string]bool{"1:1": true, "16:9": true, "9:16": true, "4:3": true, "3:4": true, "3:2": true, "2:3": true, "5:4": true, "4:5": true, "21:9": true, "1:4": true, "4:1": true, "1:8": true, "8:1": true}
		if !allowed[size] {
			return request, fmt.Errorf("%s unsupported size ratio", request.Model)
		}
		request.Size = size
		if tier == "" {
			tier = "1K"
		}
	}
	refs := []string{}
	appendRefs := func(raw json.RawMessage) error {
		if len(raw) == 0 || string(raw) == "null" {
			return nil
		}
		var values []string
		if err := common.Unmarshal(raw, &values); err != nil {
			var value string
			if err := common.Unmarshal(raw, &value); err != nil {
				return fmt.Errorf("%s references must be URL strings", request.Model)
			}
			values = []string{value}
		}
		for _, value := range values {
			u, err := url.Parse(strings.TrimSpace(value))
			if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
				return fmt.Errorf("%s references must be remote HTTP(S) URLs", request.Model)
			}
			refs = append(refs, u.String())
		}
		return nil
	}
	if err := appendRefs(request.Image); err != nil {
		return request, err
	}
	for _, fields := range []map[string]json.RawMessage{extra, metadata} {
		for _, key := range []string{"images", "urls", "image_urls", "reference_images", "input_reference"} {
			if err := appendRefs(fields[key]); err != nil {
				return request, err
			}
			delete(fields, key)
		}
	}
	if constant.IsToAPISNanoBanana21(request.Model) && len(refs) > 14 {
		return request, fmt.Errorf("%s supports at most 14 reference images", request.Model)
	}
	request.Image = nil
	if len(refs) > 0 {
		extra["image_urls"], _ = common.Marshal(refs)
	}
	for _, key := range []string{"resolution", "imageSize", "image_size", "quality", "size", "n", "model", "aspect_ratio"} {
		delete(metadata, key)
	}
	delete(extra, "imageSize")
	delete(extra, "image_size")
	delete(extra, "aspect_ratio")
	extra["resolution"], _ = common.Marshal(tier)
	if len(metadata) > 0 {
		extra["metadata"], _ = common.Marshal(metadata)
	} else {
		delete(extra, "metadata")
	}
	request.Extra = extra
	return request, nil
}
