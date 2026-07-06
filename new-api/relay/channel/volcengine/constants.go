package volcengine

var ModelList = []string{
	"Doubao-pro-128k",
	"Doubao-pro-32k",
	"Doubao-pro-4k",
	"Doubao-lite-128k",
	"Doubao-lite-32k",
	"Doubao-lite-4k",
	"Doubao-embedding",
	"doubao-seedream-4-0-250828",
	"seedream-4-0-250828",
	// doubao-seedream-5.0 系列（图片生成，同步接口）
	"doubao-seedream-5-0-260128",
	"doubao-seedream-5-0-lite-260128",
	"doubao-seedance-1-0-pro-250528",
	"seedance-1-0-pro-250528",
	"doubao-seed-1-6-thinking-250715",
	"seed-1-6-thinking-250715",
	// doubao-seed-2.0 系列（视频理解）
	"doubao-seed-2-0-pro-260428",
	"doubao-seed-2-0-lite-260428",
	"doubao-seed-2-0-lite-260215",
	"doubao-seed-2-0-mini-260428",
	"doubao-seed-2.0-pro",
	"doubao-seed-2.0-lite",
	"doubao-seed-2.0-mini",
	"deepseek-v4-flash-260425",
	"deepseek-v4-pro-260425",
	// doubao 语音（音频生成，同步 HTTP，openspeech /api/v3/tts/create，X-Api-Key 鉴权）
	"doubao-seed-audio-1-0",
}

var ChannelName = "ark-doubao"
