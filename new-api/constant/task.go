package constant

type TaskPlatform string

const (
	TaskPlatformSuno       TaskPlatform = "suno"
	TaskPlatformMidjourney              = "mj"
	TaskPlatformTencentVod              = "tencent_vod"
	// TaskPlatformTapCanvas 是 TapCanvas 资产规划订单在任务日志里的镜像：
	// 进度与结算由 Tanva 订单对账器驱动，任务轮询与超时清理（会退款）必须跳过。
	TaskPlatformTapCanvas = "tapcanvas"
)

const (
	SunoActionMusic  = "MUSIC"
	SunoActionLyrics = "LYRICS"

	TaskActionGenerate          = "generate"
	TaskActionTextGenerate      = "textGenerate"
	TaskActionFirstTailGenerate = "firstTailGenerate"
	TaskActionReferenceGenerate = "referenceGenerate"
	TaskActionRemix             = "remixGenerate"
	TaskActionAssetPlan         = "asset_plan"
)

var SunoModel2Action = map[string]string{
	"suno_music":  SunoActionMusic,
	"suno_lyrics": SunoActionLyrics,
}
