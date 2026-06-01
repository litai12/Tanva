package volcmediakit

import (
	"fmt"
	"strings"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// SubmitPayload is the MediaKit POST /api/v1/tools/enhance-video body.
// resolution (preset) and resolution_limit (short-edge px) are mutually exclusive.
type SubmitPayload struct {
	VideoURL        string `json:"video_url"`
	ToolVersion     string `json:"tool_version,omitempty"`
	Scene           string `json:"scene,omitempty"`
	Resolution      string `json:"resolution,omitempty"`
	ResolutionLimit int    `json:"resolution_limit,omitempty"`
	FPS             int    `json:"fps,omitempty"`
}

// BuildSubmitPayload translates a TaskSubmitReq into the MediaKit enhance body.
// The source video URL is taken from metadata.video_url (primary contract),
// falling back to the normalized image/reference fields. Enhance params
// (tool_version / scene / resolution / resolution_limit / fps) come from
// metadata; req.Resolution is honored as a fallback for resolution.
func BuildSubmitPayload(req *relaycommon.TaskSubmitReq) (*SubmitPayload, error) {
	if req == nil {
		return nil, fmt.Errorf("volc-mediakit: nil task request")
	}
	videoURL := extractVideoURL(req)
	if videoURL == "" {
		return nil, fmt.Errorf("volc-mediakit: video_url is required (pass via metadata.video_url)")
	}

	resolution := firstNonEmpty(metaString(req, "resolution"), strings.TrimSpace(req.Resolution))
	limit := metaInt(req, "resolution_limit", "resolutionLimit")
	if resolution != "" && limit > 0 {
		return nil, fmt.Errorf("volc-mediakit: resolution and resolution_limit are mutually exclusive")
	}

	p := &SubmitPayload{
		VideoURL:    videoURL,
		ToolVersion: normalizeToolVersion(metaString(req, "tool_version", "toolVersion")),
	}
	if scene := metaString(req, "scene"); scene != "" {
		p.Scene = scene
	}
	if resolution != "" {
		// Upstream expects lowercase preset (720p / 1080p / 4k).
		p.Resolution = strings.ToLower(resolution)
	}
	if limit > 0 {
		p.ResolutionLimit = limit
	}
	if fps := metaInt(req, "fps"); fps > 0 {
		p.FPS = fps
	}
	return p, nil
}

// extractVideoURL pulls the source video URL from metadata.video_url (primary),
// then the normalized image/reference fields as fallbacks.
func extractVideoURL(req *relaycommon.TaskSubmitReq) string {
	if u := metaString(req, "video_url", "videoUrl"); u != "" {
		return u
	}
	if v := strings.TrimSpace(req.InputReference); v != "" {
		return v
	}
	if v := strings.TrimSpace(req.Image); v != "" {
		return v
	}
	// Standard reference-URL aliases (normalizeTaskSubmitReq folds these into
	// Images for prompt-based models; we bypass that validator, so check all).
	for _, list := range [][]string{req.Images, req.Urls, req.ReferenceImages} {
		for _, u := range list {
			if v := strings.TrimSpace(u); v != "" {
				return v
			}
		}
	}
	return ""
}

// ============================
// Billing — mirrors backend VOLC_ENHANCE_VIDEO_PRICING (credits.service.ts).
// ============================
//
// The backend charges a per-call credit amount looked up by
// version × resolution-tier × fps-band (it does NOT scale by actual duration).
// new-api reproduces the exact charge: the model's base ModelPrice represents
// the standard/720P/<=30fps cell (= baselineCredits credits = 9.0 CNY, since
// hono_api_credits = ceil(price_cny * 10)). EstimateBilling returns the ratio
// table_credits / baselineCredits, so the deducted quota equals the backend's.

const baselineCredits = 90 // standard / 720P / <=30fps

// enhanceCreditsTable mirrors backend VOLC_ENHANCE_VIDEO_PRICING verbatim.
var enhanceCreditsTable = map[string]map[string]map[string]int{
	"standard": {
		"720P":  {"lte30": 90, "gt30": 180},
		"1080P": {"lte30": 180, "gt30": 360},
		"2K":    {"lte30": 360, "gt30": 720},
		"4K":    {"lte30": 720, "gt30": 1440},
	},
	"professional": {
		"720P":  {"lte30": 750, "gt30": 1500},
		"1080P": {"lte30": 1500, "gt30": 3000},
		"2K":    {"lte30": 3000, "gt30": 6000},
		"4K":    {"lte30": 6000, "gt30": 12000},
	},
}

// normalizeToolVersion: only "professional" is special; everything else → standard.
func normalizeToolVersion(v string) string {
	if strings.EqualFold(strings.TrimSpace(v), "professional") {
		return "professional"
	}
	return "standard"
}

// normalizeResolutionTier mirrors backend normalizeVolcEnhanceResolutionTier:
// preset wins; else map short-edge limit; else default 1080P.
func normalizeResolutionTier(resolution string, limit int) string {
	switch strings.ToUpper(strings.TrimSpace(resolution)) {
	case "720P":
		return "720P"
	case "1080P":
		return "1080P"
	case "2K":
		return "2K"
	case "4K":
		return "4K"
	}
	if limit > 0 {
		l := limit
		if l < 64 {
			l = 64
		}
		if l > 2160 {
			l = 2160
		}
		switch {
		case l <= 720:
			return "720P"
		case l <= 1080:
			return "1080P"
		case l <= 1440:
			return "2K"
		default:
			return "4K"
		}
	}
	return "1080P"
}

// normalizeFpsBand mirrors backend: fps>30 → gt30, else lte30.
func normalizeFpsBand(fps int) string {
	if fps > 30 {
		return "gt30"
	}
	return "lte30"
}

// EnhanceCredits returns the backend-equivalent credit charge for the params.
func EnhanceCredits(toolVersion, resolution string, resolutionLimit, fps int) int {
	v := normalizeToolVersion(toolVersion)
	tier := normalizeResolutionTier(resolution, resolutionLimit)
	band := normalizeFpsBand(fps)
	if byTier, ok := enhanceCreditsTable[v]; ok {
		if byBand, ok := byTier[tier]; ok {
			if c, ok := byBand[band]; ok && c > 0 {
				return c
			}
		}
	}
	return baselineCredits
}

// EnhanceRatio is the OtherRatio over the standard/720P/<=30fps base ModelPrice.
func EnhanceRatio(toolVersion, resolution string, resolutionLimit, fps int) float64 {
	return float64(EnhanceCredits(toolVersion, resolution, resolutionLimit, fps)) / float64(baselineCredits)
}

// ============================
// Response shapes
// ============================

// SubmitResponse mirrors POST /api/v1/tools/enhance-video:
//
//	{ "success": true, "task_id": "amk-...", "request_id": "..." }
type SubmitResponse struct {
	Success   bool   `json:"success"`
	TaskID    string `json:"task_id"`
	RequestID string `json:"request_id,omitempty"`
	Message   string `json:"message,omitempty"`
	Error     string `json:"error,omitempty"`
}

// ErrorMessage returns a human-readable summary for logging.
func (s *SubmitResponse) ErrorMessage() string {
	if s.Error != "" {
		return s.Error
	}
	if s.Message != "" {
		return s.Message
	}
	return ""
}

// DetailResult is the completed task payload.
type DetailResult struct {
	Duration   float64 `json:"duration,omitempty"`
	FPS        float64 `json:"fps,omitempty"`
	Resolution string  `json:"resolution,omitempty"`
	ToolVer    string  `json:"tool_version,omitempty"`
	VideoURL   string  `json:"video_url,omitempty"`
}

// DetailResponse mirrors GET /api/v1/tasks/{task_id}.
type DetailResponse struct {
	Success  bool          `json:"success"`
	TaskID   string        `json:"task_id,omitempty"`
	TaskType string        `json:"task_type,omitempty"`
	Status   string        `json:"status,omitempty"`
	Result   *DetailResult `json:"result,omitempty"`
	Message  string        `json:"message,omitempty"`
	Error    string        `json:"error,omitempty"`
}

// VideoURL returns the enhanced video URL, or "" if not ready.
func (d *DetailResponse) VideoURL() string {
	if d.Result != nil {
		return strings.TrimSpace(d.Result.VideoURL)
	}
	return ""
}

// FailureReason pulls a human message when the task ends unsuccessfully.
func (d *DetailResponse) FailureReason() string {
	if d.Error != "" {
		return d.Error
	}
	if d.Message != "" {
		return d.Message
	}
	return "task failed"
}

const (
	StatusSubmitted  = "submitted"
	StatusQueued     = "queued"
	StatusRunning    = "running"
	StatusProcessing = "processing"
	StatusCompleted  = "completed"
	StatusFailed     = "failed"
)

// ============================
// metadata helpers
// ============================

// metaString returns the first non-empty string metadata value among keys.
// Multiple keys let us accept both snake_case (upstream/backend) and camelCase
// (frontend params_def) spellings, e.g. "tool_version" / "toolVersion".
func metaString(req *relaycommon.TaskSubmitReq, keys ...string) string {
	if req == nil || req.Metadata == nil {
		return ""
	}
	for _, key := range keys {
		if v, ok := req.Metadata[key].(string); ok {
			if s := strings.TrimSpace(v); s != "" {
				return s
			}
		}
	}
	return ""
}

// metaInt reads an integer metadata value (first match among keys), tolerant of
// JSON float64 / string forms.
func metaInt(req *relaycommon.TaskSubmitReq, keys ...string) int {
	if req == nil || req.Metadata == nil {
		return 0
	}
	for _, key := range keys {
		switch v := req.Metadata[key].(type) {
		case float64:
			return int(v)
		case int:
			return v
		case int64:
			return int(v)
		case string:
			var n int
			if _, err := fmt.Sscanf(strings.TrimSpace(v), "%d", &n); err == nil {
				return n
			}
		}
	}
	return 0
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}
