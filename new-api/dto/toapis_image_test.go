package dto

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/require"
)

func TestToAPISVIPImageRetailMatrix(t *testing.T) {
	prices := map[string][3]float64{"low": {.2, .3, .4}, "medium": {.3, .4, .5}, "high": {.4, .6, .8}, "xhigh": {.6, 1, 1.4}, "max": {1.5, 3, 4.5}}
	for _, model := range []string{"gpt-image-2.5-flare-vip", "gpt-image-2.5-sunburst-vip"} {
		for quality, row := range prices {
			for index, resolution := range []string{"1K", "2K", "4K"} {
				t.Run(model+"/"+quality+"/"+resolution, func(t *testing.T) {
					request, err := NormalizeToAPISImageRequest(ImageRequest{Model: model, Prompt: "test", Size: "1:1", Quality: quality, Extra: map[string]json.RawMessage{"resolution": json.RawMessage(fmt.Sprintf("%q", resolution))}})
					require.NoError(t, err)
					require.Equal(t, map[string]string{"1K": "1024x1024", "2K": "2048x2048", "4K": "4096x4096"}[resolution], request.Size)
					require.InDelta(t, row[index], request.GetTokenCountMeta().ImagePriceRatio*.2, 1e-12)
				})
			}
		}
	}
}

func TestToAPISVIPDefaultsAndPixelBilling(t *testing.T) {
	for _, quality := range []string{"", "auto", "HIGH"} {
		request, err := NormalizeToAPISImageRequest(ImageRequest{Model: "gpt-image-2.5-flare-vip", Quality: quality, Size: "1536x1024"})
		require.NoError(t, err)
		require.Equal(t, "high", request.Quality)
		require.Equal(t, "1536x1024", request.Size)
		require.Equal(t, 2.0, request.GetTokenCountMeta().ImagePriceRatio)
		require.Equal(t, uint(1), *request.N)
	}
	request, err := NormalizeToAPISImageRequest(ImageRequest{Model: "gpt-image-2.5-sunburst-vip", Extra: map[string]json.RawMessage{"aspect_ratio": json.RawMessage(`"16:9"`), "metadata": json.RawMessage(`{"resolution":"2K","quality":"medium"}`)}})
	require.NoError(t, err)
	require.Equal(t, "2048x1152", request.Size)
	require.Equal(t, "medium", request.Quality)
	require.InDelta(t, .4, request.GetTokenCountMeta().ImagePriceRatio*.2, 1e-12)
}

func TestToAPISNano21ResolutionAndReferences(t *testing.T) {
	for index, resolution := range []string{"1K", "2K", "4K"} {
		raw := fmt.Sprintf(`{"model":"gemini-nano-banana-2.1","prompt":"test","size":"16:9","metadata":{"resolution":%q},"image_urls":["https://example.test/ref.png"]}`, resolution)
		var request ImageRequest
		require.NoError(t, common.Unmarshal([]byte(raw), &request))
		request, err := NormalizeToAPISImageRequest(request)
		require.NoError(t, err)
		require.Equal(t, "16:9", request.Size)
		require.InDelta(t, []float64{.3, .4, .5}[index], request.GetTokenCountMeta().ImagePriceRatio*.3, 1e-12)
	}
	refs := make([]string, 14)
	for index := range refs {
		refs[index] = fmt.Sprintf("https://example.test/%d.png", index)
	}
	request := ImageRequest{Model: constant.ToAPISNanoBanana21, Extra: map[string]json.RawMessage{}}
	request.Extra["reference_images"], _ = common.Marshal(refs)
	normalized, err := NormalizeToAPISImageRequest(request)
	require.NoError(t, err)
	var got []string
	require.NoError(t, common.Unmarshal(normalized.Extra["image_urls"], &got))
	require.Equal(t, refs, got)
	refs = append(refs, "https://example.test/15.png")
	request.Extra["reference_images"], _ = common.Marshal(refs)
	_, err = NormalizeToAPISImageRequest(request)
	require.ErrorContains(t, err, "at most 14")
}

func TestToAPISImageRejectsInvalidOrConflictingInputs(t *testing.T) {
	for _, extra := range []string{
		`"quality":"hd"`, `"n":0`, `"n":2`, `"size":"1024x512"`, `"size":"8192x8192"`,
		`"size":"1024x1024","resolution":"4K"`,
		`"resolution":"1K","metadata":{"resolution":"2K"}`,
		`"metadata":{"n":2}`, `"metadata":[]`,
		`"size":"1:1","aspect_ratio":"16:9"`,
		`"reference_images":["data:image/png;base64,abc"]`,
		`"image_urls":["blob:example"]`,
	} {
		var request ImageRequest
		require.NoError(t, common.Unmarshal([]byte(`{"model":"gpt-image-2.5-flare-vip","prompt":"test",`+extra+`}`), &request))
		_, err := NormalizeToAPISImageRequest(request)
		require.Error(t, err, extra)
	}
}
