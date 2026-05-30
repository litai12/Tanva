// Package mjproxy implements a new-api TASK adaptor for STANDARD midjourney-proxy
// upstreams (e.g. 147AI) so plain Midjourney becomes a managed model in new-api.
//
// Why a task adaptor instead of new-api's built-in /mj relay: the built-in MJ
// relay is webhook-driven (GET /mj/task/{id}/fetch returns a local DB cache that
// only advances via an upstream webhook). A task adaptor instead POLLS the
// upstream's own /mj/task/{id}/fetch directly, so a poll-based caller works
// without configuring any webhook.
//
// Protocol (standard midjourney-proxy, ported from the Tanva backend legacy mode):
//   - submit: POST {base}/mj/submit/imagine  body {"prompt","mode"}  Authorization: <key>
//             returns code + a task id (in result/id/jobId).
//   - poll:   GET  {base}/mj/task/{id}/fetch  → {status, imageUrl, progress, failReason}.
package mjproxy

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
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

// ModelList — managed standard-Midjourney models.
var ModelList = []string{
	"midjourney-fast",
	"midjourney-relax",
}

const ChannelName = "mjproxy"

type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
	apiKey      string
	baseURL     string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	return relaycommon.ValidateBasicTaskRequest(c, info, constant.TaskActionGenerate)
}

func (a *TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	return fmt.Sprintf("%s/mj/submit/imagine", strings.TrimRight(a.baseURL, "/")), nil
}

func (a *TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, _ *relaycommon.RelayInfo) error {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	setMjAuth(req, a.apiKey)
	return nil
}

// setMjAuth 同时设置 Authorization: Bearer 与 mj-api-secret，兼容两类上游：
// 标准 midjourney-proxy 读 mj-api-secret；OpenAI 风格(如 147AI 网关)读 Bearer。
func setMjAuth(req *http.Request, key string) {
	secret := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(key), "Bearer "))
	req.Header.Set("Authorization", "Bearer "+secret)
	req.Header.Set("mj-api-secret", secret)
}

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, err
	}
	prompt := buildImaginePrompt(req.Images, req.Prompt)
	if prompt == "" {
		return nil, fmt.Errorf("mjproxy: prompt or reference image required")
	}
	payload := map[string]any{
		"prompt": prompt,
		"mode":   resolveMode(req.Mode, info.OriginModelName),
	}
	data, err := common.Marshal(payload)
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

	jobID := extractTaskID(raw)
	if jobID == "" {
		reason := pickAny(raw, "description", "error", "message")
		taskErr = service.TaskErrorWrapper(fmt.Errorf("mjproxy submit returned no task id: %s", reason), "invalid_response", http.StatusInternalServerError)
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
	taskID, ok := body["task_id"].(string)
	if !ok || taskID == "" {
		return nil, fmt.Errorf("invalid task_id")
	}
	uri := fmt.Sprintf("%s/mj/task/%s/fetch", strings.TrimRight(baseUrl, "/"), taskID)
	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	setMjAuth(req, key)

	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

// ParseTaskResult maps a standard mj-proxy /mj/task/{id}/fetch response.
func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var raw map[string]any
	if err := common.Unmarshal(respBody, &raw); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}

	ti := &relaycommon.TaskInfo{Code: 0}
	imageURL := pickAny(raw, "imageUrl", "imageDmUrl")
	progress := pickAny(raw, "progress")
	switch strings.ToUpper(pickAny(raw, "status")) {
	case "SUCCESS":
		if imageURL == "" {
			ti.Status = model.TaskStatusInProgress
			ti.Progress = firstNonEmpty(progress, "90%")
		} else {
			ti.Status = model.TaskStatusSuccess
			ti.Progress = "100%"
			ti.Url = imageURL
		}
	case "FAILURE":
		ti.Status = model.TaskStatusFailure
		ti.Progress = "100%"
		ti.Reason = firstNonEmpty(pickAny(raw, "failReason", "description"), "未知原因")
	default: // NOT_START / SUBMITTED / IN_PROGRESS / unknown
		ti.Status = model.TaskStatusInProgress
		ti.Progress = firstNonEmpty(progress, "30%")
	}
	return ti, nil
}

func (a *TaskAdaptor) GetModelList() []string { return ModelList }

func (a *TaskAdaptor) GetChannelName() string { return ChannelName }

// ───────────────────────── helpers ─────────────────────────

// resolveMode returns FAST/RELAX from an explicit request mode or the model name.
func resolveMode(reqMode, modelName string) string {
	m := strings.ToUpper(strings.TrimSpace(reqMode))
	if m == "FAST" || m == "RELAX" || m == "TURBO" {
		return m
	}
	if strings.Contains(strings.ToLower(modelName), "relax") {
		return "RELAX"
	}
	return "FAST"
}

// buildImaginePrompt prepends reference image URLs to the prompt (mj image prompt).
func buildImaginePrompt(images []string, prompt string) string {
	parts := make([]string, 0, len(images)+1)
	for _, img := range images {
		if s := strings.TrimSpace(img); s != "" {
			parts = append(parts, s)
		}
	}
	if p := strings.TrimSpace(prompt); p != "" {
		parts = append(parts, p)
	}
	return strings.TrimSpace(strings.Join(parts, " "))
}

func extractTaskID(raw map[string]any) string {
	if s := pickAny(raw, "result"); s != "" {
		return s
	}
	if s := pickAny(raw, "id", "jobId"); s != "" {
		return s
	}
	if m, ok := raw["data"].(map[string]any); ok {
		if s := pickAny(m, "id", "jobId", "result"); s != "" {
			return s
		}
	}
	return ""
}

func pickAny(m map[string]any, keys ...string) string {
	if m == nil {
		return ""
	}
	for _, k := range keys {
		if s, ok := m[k].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
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
