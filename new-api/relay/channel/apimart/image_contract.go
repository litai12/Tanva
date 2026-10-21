package apimart

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	taskapimart "github.com/QuantumNous/new-api/relay/channel/task/apimart"
)

func usesToAPISNestedImageMetadata(model, baseURL string) bool {
	if !isToAPISImageBaseURL(baseURL) {
		return false
	}
	if constant.IsToAPISNanoBanana21(model) {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(model)) {
	case "gemini-3.1-flash-image-preview", "gemini-3.1-flash-image-preview-vip", "gemini-3.1-flash-image-official",
		"gemini-3-pro-image-preview", "nano-banana-pro", "gemini-3-pro-image-official",
		"gemini-2.5-flash-image-preview", "nano-banana", "gemini-2.5-flash-image-official":
		return true
	}
	return false
}

// APIMart's Ext SKUs take top-level ratio/resolution, unlike ToAPIs' Nano
// metadata and VIP pixel-size contract. Public identities select the variant;
// the upstream model itself remains the channel's explicit model mapping.
func normalizeAPIMartImagePayload(payload *taskapimart.SubmitPayload, publicModel string) error {
	upstream := strings.ToLower(strings.TrimSpace(payload.Model))
	if upstream != "gpt-image-2.5-ext" && upstream != "gemini-nano-banana-2.1-ext" && upstream != "gemini-nano-banana-2.1" &&
		!constant.IsToAPISImage25VIP(publicModel) {
		return nil
	}
	if payload.Extras == nil {
		payload.Extras = map[string]any{}
	}
	if payload.Size == "" {
		if size, ok := payload.Extras["size"].(string); ok {
			payload.Size = strings.TrimSpace(size)
		} else {
			payload.Size = payload.AspectRatio
		}
	}
	if payload.Resolution == "" {
		if resolution, ok := payload.Extras["resolution"].(string); ok {
			payload.Resolution = resolution
		}
	}
	payload.AspectRatio = ""
	for _, key := range []string{"aspect_ratio", "image_size", "imageSize", "reference_images"} {
		delete(payload.Extras, key)
	}
	// Canonical size/resolution have already been validated using the public
	// SKU. Never let flattened metadata replace these billed inputs.
	delete(payload.Extras, "size")
	delete(payload.Extras, "resolution")
	if constant.IsToAPISImage25VIP(publicModel) {
		return nil // precise pixels + quality already match the retail quote
	}
	if upstream == "gpt-image-2.5-ext" {
		switch publicModel {
		case "gpt-image-2.5-flare":
			payload.Extras["version"] = "flare"
		case "gpt-image-2.5-sunburst":
			payload.Extras["version"] = "sunburst"
		}
		delete(payload.Extras, "quality") // Ext has a fixed version/tier contract
		delete(payload.Extras, "official_fallback")
		allowed := map[string]bool{"": true, "auto": true, "1:1": true, "16:9": true, "9:16": true, "4:3": true, "3:4": true, "3:2": true, "2:3": true, "5:4": true, "4:5": true, "21:9": true}
		if !allowed[payload.Size] {
			return fmt.Errorf("apimart gpt-image-2.5-ext does not support size %q", payload.Size)
		}
	}
	resolution := strings.ToUpper(strings.TrimSpace(payload.Resolution))
	if resolution == "" {
		resolution = "1K"
	}
	if resolution != "1K" && resolution != "2K" && resolution != "4K" {
		return fmt.Errorf("apimart %s resolution must be 1K, 2K, or 4K", payload.Model)
	}
	payload.Resolution = resolution
	return nil
}

func isToAPISImageBaseURL(baseURL string) bool {
	u, err := url.Parse(baseURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	for _, domain := range []string{"toapis.com", "toapis.cn", "toapis.xyz"} {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}

// These ToAPIs GPT models use size, not the generic APIMart aspect_ratio
// duplicate. Ordinary 2.5 always runs at high quality. Provider options such
// as official_fallback retain their explicit values.
func normalizeToAPISGPTImagePayload(payload *taskapimart.SubmitPayload, baseURL string) {
	if !isToAPISImageBaseURL(baseURL) {
		return
	}
	model := strings.ToLower(strings.TrimSpace(payload.Model))
	switch model {
	case "gpt-image-2", "gpt-image-2-vip", "gpt-image-2-official", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare-vip", "gpt-image-2.5-sunburst-vip":
		payload.AspectRatio = ""
		delete(payload.Extras, "aspect_ratio")
	}
	if model == "gpt-image-2.5-flare" || model == "gpt-image-2.5-sunburst" {
		if payload.Extras == nil {
			payload.Extras = map[string]any{}
		}
		payload.Extras["quality"] = "high"
	}
}

// ToAPIs Gemini image models keep resolution and search options inside
// metadata. Other APIMart channels retain their own top-level contract.
func nestToAPISImageMetadata(payload *taskapimart.SubmitPayload, request dto.ImageRequest, resolution string) {
	metadata := map[string]any{}
	if raw := request.Extra["metadata"]; len(raw) > 0 {
		_ = common.Unmarshal(raw, &metadata)
	}
	if metadata == nil {
		metadata = map[string]any{}
	}
	if payload.Extras == nil {
		payload.Extras = map[string]any{}
	}
	for key := range metadata {
		if _, explicit := request.Extra[key]; !explicit {
			delete(payload.Extras, key)
		}
	}
	// 2.5 Official documents native metadata but no resolution field. Keep
	// its caller-supplied metadata intact without inventing a new mapping.
	resolutionMetadata := !strings.EqualFold(strings.TrimSpace(payload.Model), "gemini-2.5-flash-image-official")
	if resolution != "" && resolutionMetadata {
		metadata["resolution"] = resolution
	}
	// Tanva's Gemini-facing alias is 512; the ToAPIs image contract uses 0.5K.
	if value, ok := metadata["resolution"].(string); ok && strings.TrimSpace(value) == "512" && strings.EqualFold(strings.TrimSpace(payload.Model), "gemini-3.1-flash-image-preview") {
		metadata["resolution"] = "0.5K"
	}
	for _, key := range []string{"google_search", "google_image_search", "orientation"} {
		if value, present := payload.Extras[key]; present {
			metadata[key] = value
		}
		delete(payload.Extras, key)
	}
	payload.AspectRatio = ""
	if resolutionMetadata {
		payload.Resolution = ""
		delete(payload.Extras, "resolution")
	}
	for _, key := range []string{"image_size", "imageSize", "aspect_ratio"} {
		delete(payload.Extras, key)
	}
	if len(metadata) > 0 {
		payload.Extras["metadata"] = metadata
	}
}
