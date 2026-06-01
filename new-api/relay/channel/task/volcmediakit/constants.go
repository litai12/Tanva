package volcmediakit

// VolcEngine AI MediaKit 画质增强 (video super-resolution / enhancement).
//
// Upstream is a simple Bearer-auth async task API (NOT VolcEngine V4 signing):
//
//	submit → POST {base}/api/v1/tools/enhance-video   (returns task_id)
//	poll   → GET  {base}/api/v1/tasks/{task_id}        (returns status + result.video_url)
//
// Doc: backend/docs/火山超分（画质增强）接入API文档.md
//      MediaKit console: https://console.volcengine.com/imp/ai-mediakit
//
// Only one model is served: "volc-enhance-video". The version (standard /
// professional), resolution, and fps differences are billed via EstimateBilling
// (see payload.go enhanceCreditsTable) so the per-call charge matches the backend.

// ChannelName is the internal identifier used by logs and admin UI.
const ChannelName = "volc-mediakit"

const (
	submitPath     = "/api/v1/tools/enhance-video"
	pollPathPrefix = "/api/v1/tasks/"
)

// PollPath returns the GET status path for a task id.
func PollPath(taskID string) string { return pollPathPrefix + taskID }

// EnhanceModel is the single model id served by this channel.
const EnhanceModel = "volc-enhance-video"
