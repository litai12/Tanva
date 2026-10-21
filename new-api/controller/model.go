package controller

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/relay/channel/ai360"
	"github.com/QuantumNous/new-api/relay/channel/lingyiwanwu"
	"github.com/QuantumNous/new-api/relay/channel/minimax"
	"github.com/QuantumNous/new-api/relay/channel/moonshot"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

// https://platform.openai.com/docs/api-reference/models/list

var openAIModels []dto.OpenAIModels
var openAIModelsMap map[string]dto.OpenAIModels
var channelId2Models map[int][]string

func init() {
	// https://platform.openai.com/docs/models/model-endpoint-compatibility
	for i := 0; i < constant.APITypeDummy; i++ {
		if i == constant.APITypeAIProxyLibrary {
			continue
		}
		adaptor := relay.GetAdaptor(i)
		channelName := adaptor.GetChannelName()
		modelNames := adaptor.GetModelList()
		for _, modelName := range modelNames {
			canonicalModelName := model.CanonicalModelKey(modelName)
			if canonicalModelName == "" {
				continue
			}
			openAIModels = append(openAIModels, dto.OpenAIModels{
				Id:      canonicalModelName,
				Object:  "model",
				Created: 1626777600,
				OwnedBy: channelName,
			})
		}
	}
	for _, modelName := range ai360.ModelList {
		canonicalModelName := model.CanonicalModelKey(modelName)
		if canonicalModelName == "" {
			continue
		}
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      canonicalModelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: ai360.ChannelName,
		})
	}
	for _, modelName := range moonshot.ModelList {
		canonicalModelName := model.CanonicalModelKey(modelName)
		if canonicalModelName == "" {
			continue
		}
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      canonicalModelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: moonshot.ChannelName,
		})
	}
	for _, modelName := range lingyiwanwu.ModelList {
		canonicalModelName := model.CanonicalModelKey(modelName)
		if canonicalModelName == "" {
			continue
		}
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      canonicalModelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: lingyiwanwu.ChannelName,
		})
	}
	for _, modelName := range minimax.ModelList {
		canonicalModelName := model.CanonicalModelKey(modelName)
		if canonicalModelName == "" {
			continue
		}
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      canonicalModelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: minimax.ChannelName,
		})
	}
	for modelName, _ := range constant.MidjourneyModel2Action {
		canonicalModelName := model.CanonicalModelKey(modelName)
		if canonicalModelName == "" {
			continue
		}
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      canonicalModelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: "midjourney",
		})
	}
	openAIModelsMap = make(map[string]dto.OpenAIModels)
	for _, aiModel := range openAIModels {
		openAIModelsMap[aiModel.Id] = aiModel
	}
	channelId2Models = make(map[int][]string)
	for i := 1; i <= constant.ChannelTypeDummy; i++ {
		apiType, success := common.ChannelType2APIType(i)
		if !success || apiType == constant.APITypeAIProxyLibrary {
			continue
		}
		meta := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType: i,
		}}
		adaptor := relay.GetAdaptor(apiType)
		adaptor.Init(meta)
		rawModels := adaptor.GetModelList()
		models := make([]string, 0, len(rawModels))
		seen := make(map[string]struct{}, len(rawModels))
		for _, modelName := range rawModels {
			canonicalModelName := model.CanonicalModelKey(modelName)
			if canonicalModelName == "" {
				continue
			}
			if _, ok := seen[canonicalModelName]; ok {
				continue
			}
			seen[canonicalModelName] = struct{}{}
			models = append(models, canonicalModelName)
		}
		channelId2Models[i] = models
	}
	openAIModels = lo.UniqBy(openAIModels, func(m dto.OpenAIModels) string {
		return m.Id
	})
}

func ListModels(c *gin.Context, modelType int) {
	userOpenAiModels := make([]dto.OpenAIModels, 0)
	// Resolve channel-only prices lazily once per request. The group-scoped
	// fallback must not publish another group's prices through a token allowlist.
	var channelPricedModels map[string]bool
	channelPricesLoaded := false
	hasModelPrice := func(name string) bool {
		if _, _, exists := ratio_setting.GetModelRatioOrPrice(name); exists {
			return true
		}
		if !channelPricesLoaded {
			channelPricesLoaded = true
			group := common.GetContextKeyString(c, constant.ContextKeyTokenGroup)
			groups := []string{group}
			if group == "" || group == "auto" {
				userGroup, err := model.GetUserGroup(c.GetInt("id"), false)
				if err != nil {
					return false
				}
				groups = []string{userGroup}
				if group == "auto" {
					groups = service.GetUserAutoGroup(userGroup)
				}
			}
			// A failed read cannot grant visibility to a channel-only model.
			channelPricedModels, _ = model.GetChannelTextPricedModels(groups)
		}
		return channelPricedModels[name]
	}

	acceptUnsetRatioModel := operation_setting.SelfUseModeEnabled
	if !acceptUnsetRatioModel {
		userId := c.GetInt("id")
		if userId > 0 {
			userSettings, _ := model.GetUserSetting(userId, false)
			if userSettings.AcceptUnsetRatioModel {
				acceptUnsetRatioModel = true
			}
		}
	}

	modelLimitEnable := common.GetContextKeyBool(c, constant.ContextKeyTokenModelLimitEnabled)
	if modelLimitEnable {
		s, ok := common.GetContextKey(c, constant.ContextKeyTokenModelLimit)
		var tokenModelLimit map[string]bool
		if ok {
			tokenModelLimit = s.(map[string]bool)
		} else {
			tokenModelLimit = map[string]bool{}
		}
		for allowModel, allowed := range tokenModelLimit {
			if !allowed || (!acceptUnsetRatioModel && !hasModelPrice(allowModel)) {
				continue
			}
			if oaiModel, ok := openAIModelsMap[allowModel]; ok {
				oaiModel.SupportedEndpointTypes = model.GetModelSupportEndpointTypes(allowModel)
				userOpenAiModels = append(userOpenAiModels, oaiModel)
			} else {
				userOpenAiModels = append(userOpenAiModels, dto.OpenAIModels{
					Id:                     allowModel,
					Object:                 "model",
					Created:                1626777600,
					OwnedBy:                "custom",
					SupportedEndpointTypes: model.GetModelSupportEndpointTypes(allowModel),
				})
			}
		}
	} else {
		userId := c.GetInt("id")
		userGroup, err := model.GetUserGroup(userId, false)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "get user group failed",
			})
			return
		}
		group := userGroup
		tokenGroup := common.GetContextKeyString(c, constant.ContextKeyTokenGroup)
		if tokenGroup != "" {
			group = tokenGroup
		}
		var models []string
		if tokenGroup == "auto" {
			for _, autoGroup := range service.GetUserAutoGroup(userGroup) {
				groupModels := model.GetGroupEnabledModels(autoGroup)
				for _, g := range groupModels {
					if !common.StringsContains(models, g) {
						models = append(models, g)
					}
				}
			}
		} else {
			models = model.GetGroupEnabledModels(group)
		}
		for _, modelName := range models {
			if !acceptUnsetRatioModel && !hasModelPrice(modelName) {
				continue
			}
			if oaiModel, ok := openAIModelsMap[modelName]; ok {
				oaiModel.SupportedEndpointTypes = model.GetModelSupportEndpointTypes(modelName)
				userOpenAiModels = append(userOpenAiModels, oaiModel)
			} else {
				userOpenAiModels = append(userOpenAiModels, dto.OpenAIModels{
					Id:                     modelName,
					Object:                 "model",
					Created:                1626777600,
					OwnedBy:                "custom",
					SupportedEndpointTypes: model.GetModelSupportEndpointTypes(modelName),
				})
			}
		}
	}

	switch modelType {
	case constant.ChannelTypeAnthropic:
		useranthropicModels := make([]dto.AnthropicModel, len(userOpenAiModels))
		for i, model := range userOpenAiModels {
			useranthropicModels[i] = dto.AnthropicModel{
				ID:          model.Id,
				CreatedAt:   time.Unix(int64(model.Created), 0).UTC().Format(time.RFC3339),
				DisplayName: model.Id,
				Type:        "model",
			}
		}
		c.JSON(200, gin.H{
			"data":     useranthropicModels,
			"first_id": useranthropicModels[0].ID,
			"has_more": false,
			"last_id":  useranthropicModels[len(useranthropicModels)-1].ID,
		})
	case constant.ChannelTypeGemini:
		userGeminiModels := make([]dto.GeminiModel, len(userOpenAiModels))
		for i, model := range userOpenAiModels {
			userGeminiModels[i] = dto.GeminiModel{
				Name:        model.Id,
				DisplayName: model.Id,
			}
		}
		c.JSON(200, gin.H{
			"models":        userGeminiModels,
			"nextPageToken": nil,
		})
	default:
		c.JSON(200, gin.H{
			"success": true,
			"data":    userOpenAiModels,
			"object":  "list",
		})
	}
}

// dashboardModelCandidates adds configured models to the built-in suggestions.
// Disabled channels remain editable, so this deliberately does not filter by
// status or ability. Read only the columns needed here, never channel keys.
// Build fresh collections so database changes cannot mutate the static relay
// catalog used by public model and routing handlers.
func dashboardModelCandidates() ([]dto.OpenAIModels, map[int][]string, error) {
	var channels []struct {
		Type   int
		Models string
	}
	if err := model.DB.Model(&model.Channel{}).Select("type", "models").Order("id ASC").Find(&channels).Error; err != nil {
		return nil, nil, err
	}

	all := append([]dto.OpenAIModels{}, openAIModels...)
	seen := make(map[string]bool, len(all))
	for _, entry := range all {
		seen[entry.Id] = true
	}
	byType := make(map[int][]string, len(channelId2Models))
	typeSeen := make(map[int]map[string]bool, len(channelId2Models))
	for channelType, names := range channelId2Models {
		byType[channelType] = append([]string{}, names...)
		typeSeen[channelType] = make(map[string]bool, len(names))
		for _, name := range names {
			typeSeen[channelType][name] = true
		}
	}
	for _, channel := range channels {
		if typeSeen[channel.Type] == nil {
			typeSeen[channel.Type] = make(map[string]bool)
		}
		for _, name := range strings.Split(channel.Models, ",") {
			name = model.CanonicalModelKey(name)
			if name == "" {
				continue
			}
			if !typeSeen[channel.Type][name] {
				byType[channel.Type] = append(byType[channel.Type], name)
				typeSeen[channel.Type][name] = true
			}
			if !seen[name] {
				all = append(all, dto.OpenAIModels{Id: name, Object: "model", Created: 1626777600, OwnedBy: constant.GetChannelTypeName(channel.Type)})
				seen[name] = true
			}
		}
	}
	return all, byType, nil
}

func ChannelListModels(c *gin.Context) {
	models, _, err := dashboardModelCandidates()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(200, gin.H{
		"success": true,
		"data":    models,
	})
}

func DashboardListModels(c *gin.Context) {
	_, models, err := dashboardModelCandidates()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(200, gin.H{
		"success": true,
		"data":    models,
	})
}

func EnabledListModels(c *gin.Context) {
	c.JSON(200, gin.H{
		"success": true,
		"data":    model.GetEnabledModels(),
	})
}

func RetrieveModel(c *gin.Context, modelType int) {
	modelId := model.CanonicalModelKey(c.Param("model"))
	if aiModel, ok := openAIModelsMap[modelId]; ok {
		switch modelType {
		case constant.ChannelTypeAnthropic:
			c.JSON(200, dto.AnthropicModel{
				ID:          aiModel.Id,
				CreatedAt:   time.Unix(int64(aiModel.Created), 0).UTC().Format(time.RFC3339),
				DisplayName: aiModel.Id,
				Type:        "model",
			})
		default:
			c.JSON(200, aiModel)
		}
	} else {
		openAIError := types.OpenAIError{
			Message: fmt.Sprintf("The model '%s' does not exist", modelId),
			Type:    "invalid_request_error",
			Param:   "model",
			Code:    "model_not_found",
		}
		c.JSON(200, gin.H{
			"error": openAIError,
		})
	}
}
