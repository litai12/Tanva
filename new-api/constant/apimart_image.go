package constant

import (
	"net/url"
	"strings"
)

// APIMartImageTierModel maps Tanva's public image tiers to the documented
// APIMart SKU. Public names remain the billing identity; these are one-hop
// provider mappings, not aliases to recursively resolve through another tier.
func APIMartImageTierModel(model string) (string, bool) {
	switch model {
	case "gpt-image-2.5-flare", "gpt-image-2.5-sunburst":
		return "gpt-image-2.5-ext", true
	case "gpt-image-2.5-flare-vip":
		return "gpt-image-2.5-flare", true
	case "gpt-image-2.5-sunburst-vip":
		return "gpt-image-2.5-sunburst", true
	case ToAPISNanoBanana21:
		return "gemini-nano-banana-2.1-ext", true
	case ToAPISNanoBanana21Official:
		return ToAPISNanoBanana21, true
	}
	return "", false
}

func IsAPIMartImageBaseURL(baseURL string) bool {
	u, err := url.Parse(baseURL)
	if err != nil || u.Scheme != "https" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "api.apimart.ai" || host == "api.aishuch.com"
}
