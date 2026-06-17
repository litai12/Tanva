// Package youchuan implements a new-api TASK adaptor for the Youchuan (悠船)
// proprietary Midjourney V7 / Niji 7 image API, so V7/Niji become managed
// models in new-api (distributor routing + abilities + ModelPrice billing).
//
// Upstream protocol (proprietary, ported from the Tanva backend MidjourneyProvider):
//   - submit: POST {base}/v1/tob/diffusion   body {"text": "<imgUrl...> <prompt>"}
//             headers x-youchuan-app / x-youchuan-secret ; returns a jobId.
//   - poll:   GET  {base}/v1/tob/job/{jobId}  ; messy status (成功/失败 or
//             JOBSTATUS* enums), progress like "30%", image URL scattered across
//             many fields; status can read SUCCESS before the image URL appears.
//
// The channel key stores both credentials as "appId|secret" (single line); it is
// split in BuildRequestHeader and FetchTask. Engine selection (v7 vs niji) is
// carried by prompt flags the frontend already adds — the adaptor does not inject
// any, matching the backend's buildYouchuanDiffusionPayload.
package youchuan

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

// ModelList — managed Youchuan models (route via abilities; price via ModelPrice).
var ModelList = []string{
	"midjourney-v7",
	"midjourney-v8",
	"niji-7",
	"midjourney-niji-7",
}

// ChannelName is the human-readable channel name.
const ChannelName = "youchuan"

// maxYouchuanTextChars caps the prompt; 悠船 returns 5xx on overly long text.
const maxYouchuanTextChars = 10000

// youchuanV7UnsupportedParams are legacy V7/Niji flags stripped for compatibility.
var youchuanV7UnsupportedParams = []*regexp.Regexp{
	regexp.MustCompile(`(?i)--cref\s+\S+`),
	regexp.MustCompile(`(?i)--sref\s+\S+`),
	regexp.MustCompile(`(?i)--oref\s+\S+`),
	regexp.MustCompile(`(?i)--iw\s+\S+`),
	regexp.MustCompile(`(?i)--sw\s+\S+`),
	regexp.MustCompile(`(?i)--sv\s+\S+`),
	regexp.MustCompile(`(?i)--ow\s+\S+`),
	regexp.MustCompile(`(?i)--exp\s+\S+`),
}

// youchuanV8UnsupportedParams are not supported by the Youchuan v8.1 diffusion API.
var youchuanV8UnsupportedParams = []*regexp.Regexp{
	regexp.MustCompile(`(?i)--cref\s+\S+`),
	regexp.MustCompile(`(?i)--cw\s+\S+`),
	regexp.MustCompile(`(?i)--bs\s+\S+`),
	regexp.MustCompile(`(?i)--stop\s+\S+`),
	regexp.MustCompile(`(?i)--weird\s+\S+`),
	regexp.MustCompile(`(?i)--tile\b`),
	regexp.MustCompile(`(?i)--draft\b`),
	regexp.MustCompile(`(?i)--turbo\b`),
	regexp.MustCompile(`::`),
}

type TaskAdaptor struct {
	taskcommon.BaseBilling // EstimateBilling/AdjustBilling defaults; per-call price via ModelPrice
	ChannelType            int
	apiKey                 string // channel key, stored as "appId|secret"
	baseURL                string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
}

// ValidateRequestAndSetAction accepts POST /v1/video/generations as "generate".
// Note: the shared validator requires a non-empty prompt; image-only requests are
// not supported through this managed path.
func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	return relaycommon.ValidateBasicTaskRequest(c, info, constant.TaskActionGenerate)
}

func (a *TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	return fmt.Sprintf("%s/v1/tob/diffusion", strings.TrimRight(a.baseURL, "/")), nil
}

func (a *TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, _ *relaycommon.RelayInfo) error {
	appID, secret := splitYouchuanKey(a.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("x-youchuan-app", appID)
	req.Header.Set("x-youchuan-secret", secret)
	return nil
}

// BuildRequestBody builds the Youchuan {text} payload from the standard task
// request: prepend image URLs, strip unsupported V7 flags, cap length.
func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, err
	}
	modelName := firstNonEmpty(req.Model, info.UpstreamModelName, info.OriginModelName)
	text := buildYouchuanText(req.Images, req.Prompt, modelName)
	if text == "" {
		return nil, fmt.Errorf("youchuan: prompt or reference image required")
	}
	data, err := common.Marshal(map[string]string{"text": text})
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (taskID string, taskData []byte, taskErr *dto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		taskErr = service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
		return
	}
	_ = resp.Body.Close()

	var raw map[string]any
	if err := common.Unmarshal(responseBody, &raw); err != nil {
		taskErr = service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody), "unmarshal_response_body_failed", http.StatusInternalServerError)
		return
	}

	jobID := extractJobID(raw)
	if jobID == "" {
		reason := pickAny(raw, "description", "message", "comment")
		taskErr = service.TaskErrorWrapper(fmt.Errorf("youchuan submit returned no jobId: %s", reason), "invalid_response", http.StatusInternalServerError)
		return
	}

	ov := dto.NewOpenAIVideo()
	ov.ID = info.PublicTaskID
	ov.TaskID = info.PublicTaskID
	ov.CreatedAt = time.Now().Unix()
	ov.Model = info.OriginModelName
	c.JSON(http.StatusOK, ov)

	return jobID, responseBody, nil
}

func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	jobID, ok := body["task_id"].(string)
	if !ok || jobID == "" {
		return nil, fmt.Errorf("invalid task_id")
	}
	appID, secret := splitYouchuanKey(key)
	uri := fmt.Sprintf("%s/v1/tob/job/%s", strings.TrimRight(baseUrl, "/"), url.PathEscape(jobID))
	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("x-youchuan-app", appID)
	req.Header.Set("x-youchuan-secret", secret)

	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

// ParseTaskResult maps the messy Youchuan poll response to a TaskInfo.
// SUCCESS without an image URL is kept IN_PROGRESS so polling continues.
func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var raw map[string]any
	if err := common.Unmarshal(respBody, &raw); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}

	ti := &relaycommon.TaskInfo{Code: 0}
	urls := extractYouchuanImageURLs(raw)
	progress := pickAny(raw, "progress")
	if m, ok := raw["data"].(map[string]any); ok && progress == "" {
		progress = pickAny(m, "progress")
	}

	switch normalizeYouchuanStatus(raw) {
	case "SUCCESS":
		if len(urls) == 0 {
			// 状态已成功但图片 URL 尚未就绪：继续轮询（与后端一致）。
			ti.Status = model.TaskStatusInProgress
			ti.Progress = "90%"
		} else {
			ti.Status = model.TaskStatusSuccess
			ti.Progress = "100%"
			ti.Url = urls[0]
		}
	case "FAILURE", "CANCEL":
		ti.Status = model.TaskStatusFailure
		ti.Progress = "100%"
		ti.Reason = firstNonEmpty(pickAny(raw, "failReason", "description", "comment", "message"), "未知原因")
	default:
		ti.Status = model.TaskStatusInProgress
		ti.Progress = firstNonEmpty(progress, "30%")
	}
	return ti, nil
}

func (a *TaskAdaptor) GetModelList() []string { return ModelList }

func (a *TaskAdaptor) GetChannelName() string { return ChannelName }

// ───────────────────────── helpers ─────────────────────────

// splitYouchuanKey splits a "appId|secret" channel key into its two parts.
func splitYouchuanKey(key string) (appID, secret string) {
	parts := strings.SplitN(strings.TrimSpace(key), "|", 2)
	if len(parts) != 2 {
		return strings.TrimSpace(key), ""
	}
	return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
}

// buildYouchuanText prepends image URLs, strips unsupported flags by model, caps length.
func buildYouchuanText(images []string, prompt string, modelName string) string {
	cleaned := strings.TrimSpace(prompt)
	unsupportedParams := youchuanV7UnsupportedParams
	if strings.EqualFold(strings.TrimSpace(modelName), "midjourney-v8") {
		unsupportedParams = youchuanV8UnsupportedParams
	}
	for _, re := range unsupportedParams {
		cleaned = re.ReplaceAllString(cleaned, "")
	}
	cleaned = strings.TrimSpace(cleaned)
	if r := []rune(cleaned); len(r) > maxYouchuanTextChars {
		cleaned = strings.TrimSpace(string(r[:maxYouchuanTextChars]))
	}

	parts := make([]string, 0, len(images)+1)
	for _, img := range images {
		if s := strings.TrimSpace(img); s != "" {
			parts = append(parts, s)
		}
	}
	if cleaned != "" {
		parts = append(parts, cleaned)
	}
	return strings.TrimSpace(strings.Join(parts, " "))
}

// extractJobID pulls the upstream jobId from a Youchuan submit response.
func extractJobID(raw map[string]any) string {
	if s := pickString(raw, "id"); s != "" {
		return s
	}
	if s := pickString(raw, "jobId"); s != "" {
		return s
	}
	if s := pickNested(raw, "data", "jobId"); s != "" {
		return s
	}
	if s := pickNested(raw, "cost", "jobId"); s != "" {
		return s
	}
	if m, ok := raw["result"].(map[string]any); ok {
		if s := pickString(m, "jobId"); s != "" {
			return s
		}
	}
	if s := pickString(raw, "result"); s != "" {
		return s
	}
	return ""
}

// normalizeYouchuanStatus collapses 悠船's status zoo into SUCCESS/FAILURE/CANCEL/IN_PROGRESS.
func normalizeYouchuanStatus(raw map[string]any) string {
	s := firstNonEmpty(pickString(raw, "comment"), pickString(raw, "status"), pickNested(raw, "data", "status"))
	s = strings.TrimSpace(s)
	upper := strings.ToUpper(s)

	if s == "成功" || upper == "SUCCESS" || strings.Contains(upper, "JOBSTATUSSUCCESS") {
		return "SUCCESS"
	}
	if s == "失败" || upper == "FAILED" || upper == "FAILURE" {
		return "FAILURE"
	}
	for _, f := range []string{
		"JOBSTATUSFAIL", "JOBSTATUSERROR", "JOBSTATUSREJECT", "JOBSTATUSTEXTREJECT",
		"JOBSTATUSBADPROMPT", "JOBSTATUSINVALIDPARAMETER", "JOBSTATUSTIMEOUT",
		"JOBSTATUSREQUESTTIMEOUT", "JOBSTATUSINVALIDIMAGEPROMPTLINK",
		"JOBSTATUSCREDITNOTENOUGH", "JOBSTATUSIMAGEPROMPTDENIED", "JOBSTATUSDUPLICATEIMAGE",
	} {
		if strings.Contains(upper, f) {
			return "FAILURE"
		}
	}
	if strings.Contains(upper, "JOBSTATUSCANCELED") {
		return "CANCEL"
	}
	// JOBSTATUSCREATED/RUNNING/QUEUED 及未知一律视为进行中（比误判终态安全）。
	return "IN_PROGRESS"
}

// extractYouchuanImageURLs scrapes http(s) image URLs from the response's known
// fields (top-level and nested data/result), de-duplicated in order.
func extractYouchuanImageURLs(raw map[string]any) []string {
	seen := map[string]bool{}
	out := make([]string, 0, 4)
	keys := []string{"urls", "imageUrl", "imageUrls", "imgUrl", "url", "result_url", "output", "images"}

	add := func(v any) {
		for _, s := range flattenURLs(v) {
			if (strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")) && !seen[s] {
				seen[s] = true
				out = append(out, s)
			}
		}
	}
	for _, k := range keys {
		add(raw[k])
	}
	for _, parent := range []string{"data", "result"} {
		if m, ok := raw[parent].(map[string]any); ok {
			for _, k := range keys {
				add(m[k])
			}
		}
	}
	return out
}

// flattenURLs turns a string / []string / []object{imageUrl|url|imgUrl} into strings.
func flattenURLs(v any) []string {
	switch t := v.(type) {
	case string:
		return []string{t}
	case []any:
		r := make([]string, 0, len(t))
		for _, e := range t {
			switch et := e.(type) {
			case string:
				r = append(r, et)
			case map[string]any:
				for _, k := range []string{"imageUrl", "url", "imgUrl"} {
					if s, ok := et[k].(string); ok {
						r = append(r, s)
					}
				}
			}
		}
		return r
	}
	return nil
}

func pickString(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	if s, ok := m[key].(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}

func pickNested(m map[string]any, parent, key string) string {
	if sub, ok := m[parent].(map[string]any); ok {
		return pickString(sub, key)
	}
	return ""
}

func pickAny(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if s := pickString(m, k); s != "" {
			return s
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
