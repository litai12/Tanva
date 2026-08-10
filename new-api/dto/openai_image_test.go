package dto

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestImageRequestMarshalJSONPreservesExtraImageFields(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
		"model":"nanobanana2",
		"prompt":"restore product detail image",
		"image_urls":["https://example.com/a.png","https://example.com/b.png"],
		"image_size":"1080p"
	}`)

	var request ImageRequest
	require.NoError(t, common.Unmarshal(raw, &request))

	encoded, err := common.Marshal(request)
	require.NoError(t, err)

	var payload map[string]json.RawMessage
	require.NoError(t, common.Unmarshal(encoded, &payload))

	require.Contains(t, payload, "image_urls")
	require.Contains(t, payload, "image_size")

	var imageURLs []string
	require.NoError(t, common.Unmarshal(payload["image_urls"], &imageURLs))
	require.Equal(t, []string{"https://example.com/a.png", "https://example.com/b.png"}, imageURLs)

	var imageSize string
	require.NoError(t, common.Unmarshal(payload["image_size"], &imageSize))
	require.Equal(t, "1080p", imageSize)
}

func TestImageRequestKeepsQualityTypedAndResolutionExtra(t *testing.T) {
	t.Parallel()

	var request ImageRequest
	require.NoError(t, common.Unmarshal([]byte(`{
		"model":"gpt-image-2",
		"prompt":"an apple",
		"quality":"auto",
		"resolution":"4K"
	}`), &request))

	require.Equal(t, "auto", request.Quality)
	require.NotContains(t, request.Extra, "quality")
	require.Contains(t, request.Extra, "resolution")
}

func TestImageRequestGPTImage2ResolutionPriceRatio(t *testing.T) {
	t.Parallel()

	tests := []struct {
		resolution string
		wantRatio  float64
	}{
		{resolution: "1K", wantRatio: 1},
		{resolution: "2K", wantRatio: 1.5},
		{resolution: "4K", wantRatio: 2},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.resolution, func(t *testing.T) {
			t.Parallel()
			request := ImageRequest{
				Model:   "gpt-image-2",
				Quality: "auto",
				Extra: map[string]json.RawMessage{
					"resolution": json.RawMessage(`"` + tt.resolution + `"`),
				},
			}
			require.Equal(t, tt.wantRatio, request.GetTokenCountMeta().ImagePriceRatio)
		})
	}
}

func TestImageRequestQualityDoesNotPromoteResolutionPriceRatio(t *testing.T) {
	t.Parallel()

	request := ImageRequest{Model: "gpt-image-2", Quality: "high"}
	require.Equal(t, 1.0, request.GetTokenCountMeta().ImagePriceRatio)
}
