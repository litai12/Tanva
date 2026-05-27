package relay

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

func TestApplyChannelBoundImageModelAppliesModelMapping(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gpt-image-2"},
		`{"gpt-image-2":"gpt-image-2-base-upstream"}`,
	)
	request := dto.ImageRequest{Model: "gpt-image-2"}
	info := imageTierRelayInfo("gpt-image-2")

	if err := applyChannelBoundImageModel(c, info, &request); err != nil {
		t.Fatalf("applyChannelBoundImageModel error: %v", err)
	}
	if request.Model != "gpt-image-2-base-upstream" {
		t.Fatalf("request.Model = %q", request.Model)
	}
	if info.UpstreamModelName != "gpt-image-2-base-upstream" {
		t.Fatalf("UpstreamModelName = %q", info.UpstreamModelName)
	}
}

func TestApplyChannelBoundImageModelPassesThroughWithoutMapping(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext([]string{"gpt-image-2"}, `{}`)
	request := dto.ImageRequest{Model: "gpt-image-2"}
	info := imageTierRelayInfo("gpt-image-2")

	if err := applyChannelBoundImageModel(c, info, &request); err != nil {
		t.Fatalf("applyChannelBoundImageModel error: %v", err)
	}
	if request.Model != "gpt-image-2" {
		t.Fatalf("request.Model = %q", request.Model)
	}
}

func TestApplyChannelBoundImageModelRejectsUnconfiguredExplicitOfficialOnApimartChannel(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gpt-image-2"},
		`{"gpt-image-2-official":"gpt-image-2"}`,
	)
	request := dto.ImageRequest{Model: "gpt-image-2-official"}
	info := imageTierRelayInfoWithChannelType("gpt-image-2-official", constant.ChannelTypeApimart)

	if err := applyChannelBoundImageModel(c, info, &request); err == nil {
		t.Fatal("expected applyChannelBoundImageModel to reject unconfigured official tier")
	}
}

func TestApplyChannelBoundImageModelRejectsOfficialOnNonApimartChannel(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gpt-image-2-official"},
		`{"gpt-image-2-official":"gpt-image-2"}`,
	)
	request := dto.ImageRequest{Model: "gpt-image-2-official"}
	info := imageTierRelayInfoWithChannelType("gpt-image-2-official", constant.ChannelTypeMagic666)

	if err := applyChannelBoundImageModel(c, info, &request); err == nil {
		t.Fatal("expected applyChannelBoundImageModel to reject non-APIMart official routing")
	}
}

func TestApplyChannelBoundImageModelAllowsExplicitOfficialMappingOnApimartChannel(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gpt-image-2-official"},
		`{"gpt-image-2-official":"gpt-image-2"}`,
	)
	request := dto.ImageRequest{Model: "gpt-image-2-official"}
	info := imageTierRelayInfoWithChannelType("gpt-image-2-official", constant.ChannelTypeApimart)

	if err := applyChannelBoundImageModel(c, info, &request); err != nil {
		t.Fatalf("applyChannelBoundImageModel error: %v", err)
	}
	if request.Model != "gpt-image-2" {
		t.Fatalf("request.Model = %q", request.Model)
	}
	if info.UpstreamModelName != "gpt-image-2" {
		t.Fatalf("UpstreamModelName = %q", info.UpstreamModelName)
	}
}

func TestApplyChannelBoundImageModelAllowsExplicitOfficialPassthroughOnApimartChannel(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gpt-image-2-official"},
		`{}`,
	)
	request := dto.ImageRequest{Model: "gpt-image-2-official"}
	info := imageTierRelayInfoWithChannelType("gpt-image-2-official", constant.ChannelTypeApimart)

	if err := applyChannelBoundImageModel(c, info, &request); err != nil {
		t.Fatalf("applyChannelBoundImageModel error: %v", err)
	}
	if request.Model != "gpt-image-2-official" {
		t.Fatalf("request.Model = %q", request.Model)
	}
	if info.UpstreamModelName != "gpt-image-2-official" {
		t.Fatalf("UpstreamModelName = %q", info.UpstreamModelName)
	}
}

func TestApplyChannelBoundImageModelMapsGeminiOfficialOnApimartChannel(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gemini-3-pro-image-preview-official"},
		`{"gemini-3-pro-image-preview-official":"gemini-3-pro-image-preview"}`,
	)
	request := dto.ImageRequest{Model: "gemini-3-pro-image-preview-official"}
	info := imageTierRelayInfoWithChannelType("gemini-3-pro-image-preview-official", constant.ChannelTypeApimart)

	if err := applyChannelBoundImageModel(c, info, &request); err != nil {
		t.Fatalf("applyChannelBoundImageModel error: %v", err)
	}
	if request.Model != "gemini-3-pro-image-preview" {
		t.Fatalf("request.Model = %q", request.Model)
	}
	if info.UpstreamModelName != "gemini-3-pro-image-preview" {
		t.Fatalf("UpstreamModelName = %q", info.UpstreamModelName)
	}
}

func imageTierTestContext(channelModels []string, modelMapping string) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(c, constant.ContextKeyChannelModels, channelModels)
	common.SetContextKey(c, constant.ContextKeyChannelModelMapping, modelMapping)
	return c
}

func imageTierRelayInfo(modelName string) *relaycommon.RelayInfo {
	return imageTierRelayInfoWithChannelType(modelName, constant.ChannelTypeUnknown)
}

func imageTierRelayInfoWithChannelType(modelName string, channelType int) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		OriginModelName: modelName,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       channelType,
			UpstreamModelName: modelName,
		},
	}
}

