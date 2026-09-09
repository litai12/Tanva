package openai

import (
	"encoding/json"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"testing"
)

func TestJichuanQualityIsIndependentOfResolutionPrice(t *testing.T) {
	for _, quality := range []string{"high", "xhigh", "max"} {
		for _, resolution := range []string{"1K", "2K", "4K"} {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/v1/images/generations", nil)
			raw, _ := json.Marshal(resolution)
			req := dto.ImageRequest{Model: "gpt-image-2.5", Prompt: "product", Size: "1:1", Quality: quality, Extra: map[string]json.RawMessage{"resolution": raw, "image_urls": json.RawMessage(`["https://assets.example.test/ref.png"]`)}}
			info := &relaycommon.RelayInfo{}
			wire, err := convertGPTImage25JSON(c, info, req)
			require.NoError(t, err)
			got := wire.(map[string]any)
			require.Equal(t, quality, got["quality"])
			require.Equal(t, "https://assets.example.test/ref.png", got["image"])
			require.Equal(t, "/v1/images/edits", info.RequestURLPath)
			normalized, err := dto.NormalizeGPTImage25Request(req)
			require.NoError(t, err)
			baseline := normalized
			baseline.Quality = "high"
			require.Equal(t, baseline.GetTokenCountMeta(), normalized.GetTokenCountMeta())
		}
	}
}

func TestJichuanDefaultAndLegacyLowUseMax(t *testing.T) {
	for _, quality := range []string{"", "auto", "low"} {
		request, err := dto.NormalizeGPTImage25Request(dto.ImageRequest{Model: "gpt-image-2.5", Size: "1:1", Quality: quality})
		require.NoError(t, err)
		require.Equal(t, "max", request.Quality)
	}
}
