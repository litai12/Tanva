package openai

import (
	"encoding/json"
	"fmt"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/gin-gonic/gin"
	"net/url"
	"strings"
)

// Jichuan uses pixel size and remote references on the JSON edits endpoint.
func convertGPTImage25JSON(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	request, err := dto.NormalizeGPTImage25Request(request)
	if err != nil {
		return nil, err
	}
	wire := map[string]any{"model": request.Model, "prompt": request.Prompt, "size": request.Size, "quality": request.Quality, "response_format": "url"}
	if request.N != nil {
		wire["n"] = *request.N
	}
	refs := []string{}
	if len(request.Image) > 0 {
		var ref string
		if err := json.Unmarshal(request.Image, &ref); err != nil {
			if err := json.Unmarshal(request.Image, &refs); err != nil {
				return nil, err
			}
		} else {
			refs = append(refs, ref)
		}
	}
	for _, key := range []string{"image_urls", "urls"} {
		if raw := request.Extra[key]; len(raw) > 0 {
			var items []string
			if err := json.Unmarshal(raw, &items); err != nil {
				return nil, err
			}
			refs = append(refs, items...)
		}
	}
	remote := func(ref string) bool {
		u, e := url.Parse(ref)
		return e == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != ""
	}
	for _, ref := range refs {
		if !remote(ref) {
			return nil, fmt.Errorf("gpt-image-2.5 reference must be a remote HTTP(S) URL")
		}
	}
	if len(refs) > 0 {
		if len(refs) == 1 {
			wire["image"] = refs[0]
		} else {
			wire["image"] = refs
		}
		info.RelayMode = relayconstant.RelayModeImagesEdits
		info.RequestURLPath = "/v1/images/edits"
	}
	if raw := request.Extra["mask"]; len(raw) > 0 {
		var mask string
		if err := json.Unmarshal(raw, &mask); err != nil || !remote(mask) || len(refs) == 0 {
			return nil, fmt.Errorf("gpt-image-2.5 mask requires a remote URL and reference")
		}
		wire["mask"] = mask
	}
	if strings.Contains(c.Request.Header.Get("Content-Type"), "multipart") {
		return nil, fmt.Errorf("gpt-image-2.5 requires JSON with remote image URLs")
	}
	c.Request.Header.Set("Content-Type", "application/json")
	return wire, nil
}
