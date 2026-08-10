package tencent

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestResolveTencentImageVersionUsesQualityOnly(t *testing.T) {
	t.Parallel()

	tests := []struct {
		quality    string
		resolution string
		want       string
	}{
		{quality: "auto", resolution: "1K", want: "image2_low"},
		{quality: "auto", resolution: "2K", want: "image2_low"},
		{quality: "auto", resolution: "4K", want: "image2_low"},
		{quality: "low", resolution: "4K", want: "image2_low"},
		{quality: "medium", resolution: "1K", want: "image2_medium"},
		{quality: "medium", resolution: "4K", want: "image2_medium"},
		{quality: "high", resolution: "1K", want: "image2_high"},
		{quality: "high", resolution: "4K", want: "image2_high"},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.quality+"_"+tt.resolution, func(t *testing.T) {
			t.Parallel()
			require.Equal(t, tt.want, resolveTencentImageVersion(tt.quality, tt.resolution))
		})
	}
}

func TestConvertImageRequestReadsTypedQualityAndKeepsResolutionIndependent(t *testing.T) {
	t.Parallel()

	var request dto.ImageRequest
	require.NoError(t, common.Unmarshal([]byte(`{
		"model":"gpt-image-2",
		"prompt":"an apple",
		"n":1,
		"size":"16:9",
		"resolution":"4K",
		"quality":"auto"
	}`), &request))
	require.Equal(t, "auto", request.Quality)
	require.NotContains(t, request.Extra, "quality")

	c, _ := gin.CreateTestContext(nil)
	common.SetContextKey(c, constant.ContextKeyChannelKey, "1412292672|secret-id|secret-key")
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-image-2"}}
	adaptor := &Adaptor{}

	converted, err := adaptor.ConvertImageRequest(c, info, request)
	require.NoError(t, err)
	payload, ok := converted.(*vodCreateImageTaskReq)
	require.True(t, ok)
	require.Equal(t, "OG", payload.ModelName)
	require.Equal(t, "image2_low", payload.ModelVersion)
	require.Equal(t, "4K", payload.OutputConfig.Resolution)
	require.Equal(t, "16:9", payload.OutputConfig.AspectRatio)
}

func TestConvertImageRequestRejectsMultipleImages(t *testing.T) {
	t.Parallel()

	n := uint(2)
	adaptor := &Adaptor{}
	_, err := adaptor.ConvertImageRequest(nil, nil, dto.ImageRequest{N: &n})
	require.EqualError(t, err, "tencent image: n=2 is unsupported; this channel returns exactly one image per request")
}
