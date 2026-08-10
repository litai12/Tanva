package apimart

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	taskapimart "github.com/QuantumNous/new-api/relay/channel/task/apimart"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/require"
)

func TestConvertImageRequestForwardsTypedImageParameters(t *testing.T) {
	t.Parallel()

	n := uint(1)
	watermark := false
	request := dto.ImageRequest{
		Model:             "gpt-image-2",
		Prompt:            "an apple",
		N:                 &n,
		Size:              "16:9",
		Quality:           "auto",
		ResponseFormat:    "url",
		Background:        json.RawMessage(`"transparent"`),
		Moderation:        json.RawMessage(`"low"`),
		OutputFormat:      json.RawMessage(`"png"`),
		OutputCompression: json.RawMessage(`80`),
		Watermark:         &watermark,
		Extra: map[string]json.RawMessage{
			"resolution": json.RawMessage(`"4K"`),
		},
	}

	metadata := map[string]any{"n": int(n)}
	appendTypedImageMetadata(request, metadata)
	payload, err := taskapimart.BuildSubmitPayload(&relaycommon.TaskSubmitReq{
		Model:      "gpt-image-2",
		Prompt:     request.Prompt,
		Size:       request.Size,
		Resolution: "4K",
		Metadata:   metadata,
	})
	require.NoError(t, err)

	encoded, err := common.Marshal(payload)
	require.NoError(t, err)
	var upstream map[string]any
	require.NoError(t, common.Unmarshal(encoded, &upstream))
	require.Equal(t, "gpt-image-2", upstream["model"])
	require.Equal(t, "4K", upstream["resolution"])
	require.Equal(t, "auto", upstream["quality"])
	require.Equal(t, "transparent", upstream["background"])
	require.Equal(t, "low", upstream["moderation"])
	require.Equal(t, "png", upstream["output_format"])
	require.Equal(t, float64(80), upstream["output_compression"])
	require.Equal(t, float64(1), upstream["n"])
	require.Equal(t, false, upstream["watermark"])
}
