package relay

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/gin-gonic/gin"
)

const gptImage2OfficialModel = "gpt-image-2-official"

func applyChannelBoundImageModel(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ImageRequest) error {
	if info == nil || request == nil {
		return nil
	}
	if info.ChannelMeta == nil {
		info.ChannelMeta = &relaycommon.ChannelMeta{}
	}
	upstreamModel := info.UpstreamModelName
	if upstreamModel == "" {
		upstreamModel = info.OriginModelName
	}
	channelModels := selectedChannelModels(c, info)
	if err := validateOfficialImageSkuChannel(upstreamModel, channelModels, info); err != nil {
		return err
	}
	mappedModel, mapped, err := helper.MapModelName(c.GetString("model_mapping"), upstreamModel)
	if err != nil {
		return err
	}
	info.UpstreamModelName = mappedModel
	info.IsModelMapped = mapped || mappedModel != info.OriginModelName
	request.SetModelName(mappedModel)
	return nil
}

func selectedChannelModels(c *gin.Context, info *relaycommon.RelayInfo) []string {
	if c != nil {
		if models, ok := common.GetContextKeyType[[]string](c, constant.ContextKeyChannelModels); ok {
			return models
		}
	}
	if info == nil || info.ChannelId == 0 {
		return nil
	}
	channel, err := model.CacheGetChannel(info.ChannelId)
	if err != nil || channel == nil {
		return nil
	}
	return channel.GetModels()
}

func validateOfficialImageSkuChannel(selectedModel string, channelModels []string, info *relaycommon.RelayInfo) error {
	if !isOfficialImageSku(selectedModel) {
		return nil
	}
	if info == nil || info.ChannelMeta == nil || info.ChannelType != constant.ChannelTypeApimart {
		return fmt.Errorf("%s must route through an APIMart official SKU channel", selectedModel)
	}
	for _, channelModel := range channelModels {
		if strings.TrimSpace(channelModel) == selectedModel {
			return nil
		}
	}
	return fmt.Errorf("%s is not bound to the selected channel", selectedModel)
}

func isOfficialImageSku(modelName string) bool {
	switch strings.TrimSpace(modelName) {
	case gptImage2OfficialModel, "gemini-3-pro-image-preview-official":
		return true
	default:
		return false
	}
}
