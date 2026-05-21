package apimart

import taskapimart "github.com/QuantumNous/new-api/relay/channel/task/apimart"

// ChannelName mirrors the task adaptor identifier so log/admin UI entries stay
// consistent across the sync and task paths.
const ChannelName = taskapimart.ChannelName

// syncModels enumerates the chat / audio models served synchronously through
// POST /v1/chat/completions, /v1/audio/*. Keep aligned with the SQL patch in
// new-api/patches/2026-05-21/001-apimart-add-chat-models.sql.
var syncModels = []string{
	"gemini-2.5-pro",            // Gemini 新版 chat 主力
	"gemini-2.5-flash",          // banana-2.5 Fast 对话
	"gemini-3-flash-preview",    // banana Pro 对话 / tool-selection
	"gemini-3.1-pro",            // 主力: 默认对话 / Image Chat / 提示词优化
	"gemini-3.1-pro-preview",    // banana-3.1 Ultra 对话
}

// ModelList is the admin-UI default set for this channel. Combines sync
// (chat/audio) and async (image/video) sets from the task package.
var ModelList = append(append([]string{}, syncModels...), taskapimart.AllAsyncModels()...)
