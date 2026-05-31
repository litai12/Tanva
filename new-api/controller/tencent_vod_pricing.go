package controller

import (
	"fmt"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// tencentVodCreatePayload 是从 CreateAigcVideoTask 请求体里提取的定价维度。
type tencentVodCreatePayload struct {
	ModelName    string
	ModelVersion string
	Duration     int
	Resolution   string
	Audio        string // OutputConfig.AudioGeneration
}

type tencentVodOutputConfig struct {
	Duration        float64 `json:"Duration"`
	Resolution      string  `json:"Resolution"`
	AspectRatio     string  `json:"AspectRatio"`
	AudioGeneration string  `json:"AudioGeneration"`
}

type tencentVodCreateBody struct {
	ModelName    string                 `json:"ModelName"`
	ModelVersion string                 `json:"ModelVersion"`
	OutputConfig tencentVodOutputConfig `json:"OutputConfig"`
}

// 价格表（近似、可调；过渡期仅用于统计）。baseCredits 取自后端 credits.config.ts。
type tencentVodPrice struct {
	baseCredits int
	refDuration float64
}

var tencentVodBasePrices = map[string]map[string]tencentVodPrice{
	"vidu": {
		"q2": {600, 5},
		"q3": {600, 8},
	},
	"seedance": {
		"1.5-pro":  {600, 5},
		"2.0":      {600, 5},
		"2.0-pro":  {1100, 5},
		"2.0-lite": {700, 5},
		"2.0-mini": {500, 5},
	},
}

var tencentVodResolutionFactor = map[string]float64{
	"480P":  0.6,
	"720P":  1.0,
	"1080P": 1.8,
}

const (
	tencentVodDefaultBaseCredits = 600
	tencentVodDefaultRefDuration = 5.0
	tencentVodQuotaPerCredit     = 5000 // 100积分=1元=$1=500000quota ⟹ 1积分=5000quota
)

// computeTencentVodCredits 按 (模型,版本) 基础价 × 时长系数 × 分辨率系数 计算积分。
func computeTencentVodCredits(p tencentVodCreatePayload) int {
	name := strings.ToLower(strings.TrimSpace(p.ModelName))
	ver := strings.ToLower(strings.TrimSpace(p.ModelVersion))

	base := tencentVodDefaultBaseCredits
	ref := tencentVodDefaultRefDuration
	if price, ok := tencentVodBasePrices[name][ver]; ok {
		base = price.baseCredits
		ref = price.refDuration
	} else {
		common.SysLog(fmt.Sprintf("tencent_vod pricing: unknown model %q/%q, using default %d credits", p.ModelName, p.ModelVersion, base))
	}

	durFactor := 1.0
	if p.Duration > 0 && ref > 0 {
		durFactor = float64(p.Duration) / ref
	}
	resFactor := 1.0
	if f, ok := tencentVodResolutionFactor[strings.ToUpper(strings.TrimSpace(p.Resolution))]; ok {
		resFactor = f
	}

	credits := float64(base) * durFactor * resFactor
	if credits < 0 {
		credits = 0
	}
	return int(math.Round(credits))
}

// tencentVodQuota 把积分换算为 new-api quota。
func tencentVodQuota(credits int) int {
	if credits <= 0 {
		return 0
	}
	return credits * tencentVodQuotaPerCredit
}

// tencentVodDisplayModel 生成日志/任务里展示的模型名，如 vidu-q3 / seedance-2.0-pro。
func tencentVodDisplayModel(modelName, modelVersion string) string {
	name := strings.ToLower(strings.TrimSpace(modelName))
	ver := strings.ToLower(strings.TrimSpace(modelVersion))
	if name == "" && ver == "" {
		return "tencent-vod-video"
	}
	if ver == "" {
		return name
	}
	return name + "-" + ver
}

func isTencentVodCreateAction(action string) bool {
	return strings.EqualFold(strings.TrimSpace(action), "CreateAigcVideoTask")
}

func isTencentVodDescribeAction(action string) bool {
	return strings.EqualFold(strings.TrimSpace(action), "DescribeTaskDetail")
}

// parseTencentVodCreatePayload 解析创建请求体的定价维度；解析失败返回 (零值,false)。
func parseTencentVodCreatePayload(body []byte) (tencentVodCreatePayload, bool) {
	var b tencentVodCreateBody
	if err := common.Unmarshal(body, &b); err != nil {
		return tencentVodCreatePayload{}, false
	}
	return tencentVodCreatePayload{
		ModelName:    b.ModelName,
		ModelVersion: b.ModelVersion,
		Duration:     int(math.Round(b.OutputConfig.Duration)),
		Resolution:   b.OutputConfig.Resolution,
		Audio:        b.OutputConfig.AudioGeneration,
	}, true
}
