package apimart

import (
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	taskapimart "github.com/QuantumNous/new-api/relay/channel/task/apimart"
)

func usesToAPISNestedImageMetadata(model, baseURL string) bool {
	if constant.IsToAPISNanoBanana21(model) {
		return true
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	toapis := false
	for _, domain := range []string{"toapis.com", "toapis.cn", "toapis.xyz"} {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			toapis = true
		}
	}
	if !toapis {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(model)) {
	case "gemini-3.1-flash-image-preview":
		return true
	}
	return false
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
	if resolution != "" {
		metadata["resolution"] = resolution
	}
	// Tanva's Gemini-facing alias is 512; the ToAPIs image contract uses 0.5K.
	if value, ok := metadata["resolution"].(string); ok && strings.TrimSpace(value) == "512" {
		metadata["resolution"] = "0.5K"
	}
	for _, key := range []string{"google_search", "google_image_search"} {
		if value, present := payload.Extras[key]; present {
			metadata[key] = value
		}
		delete(payload.Extras, key)
	}
	payload.AspectRatio = ""
	payload.Resolution = ""
	for _, key := range []string{"resolution", "image_size", "imageSize", "aspect_ratio"} {
		delete(payload.Extras, key)
	}
	if len(metadata) > 0 {
		payload.Extras["metadata"] = metadata
	}
}
