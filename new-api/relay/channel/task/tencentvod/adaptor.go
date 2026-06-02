// Package tencentvod implements a new-api task channel that proxies video
// generation to the Tanva backend's Tencent VOD AIGC service.
//
// Rationale: the Tencent VOD AIGC create/poll + TC3 signing + per-model
// request building already live (and are battle-tested) in the backend
// (apps backend `tencent-vod-aigc.service.ts` + `video-provider.service.ts`).
// Rather than re-port all of that to Go, this adaptor forwards the unified
// /v1/videos task request to two thin backend endpoints:
//
//	POST {base_url}/api/ai/internal/tencent-vod/video        (create)
//	GET  {base_url}/api/ai/internal/tencent-vod/video/{id}   (poll)
//
// authenticated with a shared internal token carried in the channel key.
//
// This makes Tencent VOD a first-class new-api channel: the distributor picks
// between apimart / ark / tencent-vod by ability + priority (same as image
// tasks), and every request gets a full relay log chain + billing — unlike the
// old /proxy/tencent/vod passthrough which had neither.
//
// Scope: Vidu + Kling models only. Seedance uses asset:// (VolcEngine-native)
// image references that Tencent VOD cannot consume, so Seedance stays on the
// ark-doubao-video channel.
package tencentvod

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
	taskcommon "github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

const ChannelName = "tencent-vod"

// createPayload is the body sent to the backend create endpoint. It is the
// channel-agnostic subset of the unified /v1/videos request the backend needs
// to rebuild a VideoProviderRequestDto and drive the Tencent VOD path.
type createPayload struct {
	Model       string                 `json:"model"`
	Prompt      string                 `json:"prompt,omitempty"`
	Images      []string               `json:"images,omitempty"`
	Duration    int                    `json:"duration,omitempty"`
	Size        string                 `json:"size,omitempty"`
	Resolution  string                 `json:"resolution,omitempty"`
	AspectRatio string                 `json:"aspect_ratio,omitempty"`
	Mode        string                 `json:"mode,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

// createResponse mirrors the backend create endpoint response.
type createResponse struct {
	TaskID string `json:"task_id"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

// queryResponse mirrors the backend poll endpoint response.
type queryResponse struct {
	Status   string `json:"status"`
	Url      string `json:"url,omitempty"`
	VideoUrl string `json:"video_url,omitempty"`
	Reason   string `json:"reason,omitempty"`
}

type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
	baseURL     string
	apiKey      string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = strings.TrimRight(info.ChannelBaseUrl, "/")
	a.apiKey = info.ApiKey
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	return relaycommon.ValidateBasicTaskRequest(c, info, constant.TaskActionGenerate)
}

func (a *TaskAdaptor) BuildRequestURL(info *relaycommon.RelayInfo) (string, error) {
	return fmt.Sprintf("%s/api/ai/internal/tencent-vod/video", a.baseURL), nil
}

func (a *TaskAdaptor) BuildRequestHeader(c *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Internal-Token", a.apiKey)
	return nil
}

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	v, exists := c.Get("task_request")
	if !exists {
		return nil, fmt.Errorf("request not found in context")
	}
	req, ok := v.(relaycommon.TaskSubmitReq)
	if !ok {
		return nil, fmt.Errorf("invalid request type in context")
	}

	// Keep the business model name (e.g. vidu-q3 / kling-v2-6); the backend
	// maps it to provider/version for the Tencent VOD request. The tencent-vod
	// channel must NOT model_mapping these to the apimart upstream ids.
	modelName := info.OriginModelName
	if modelName == "" {
		modelName = info.UpstreamModelName
	}

	body := createPayload{
		Model:       modelName,
		Prompt:      req.Prompt,
		Images:      req.Images,
		Duration:    req.Duration,
		Size:        req.Size,
		Resolution:  req.Resolution,
		AspectRatio: req.AspectRatio,
		Mode:        req.Mode,
		Metadata:    req.Metadata,
	}

	data, err := common.Marshal(body)
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

	var cResp createResponse
	if err := common.Unmarshal(responseBody, &cResp); err != nil {
		taskErr = service.TaskErrorWrapper(errors.Wrap(err, fmt.Sprintf("%s", responseBody)), "unmarshal_response_failed", http.StatusInternalServerError)
		return
	}
	if cResp.TaskID == "" {
		msg := cResp.Error
		if msg == "" {
			msg = fmt.Sprintf("backend returned no task id: %s", responseBody)
		}
		taskErr = service.TaskErrorWrapperLocal(fmt.Errorf("%s", msg), "task_failed", http.StatusBadRequest)
		return
	}

	ov := dto.NewOpenAIVideo()
	ov.ID = info.PublicTaskID
	ov.TaskID = info.PublicTaskID
	ov.CreatedAt = time.Now().Unix()
	ov.Model = info.OriginModelName
	c.JSON(http.StatusOK, ov)
	return cResp.TaskID, responseBody, nil
}

func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok || taskID == "" {
		return nil, fmt.Errorf("invalid task_id")
	}
	url := fmt.Sprintf("%s/api/ai/internal/tencent-vod/video/%s", strings.TrimRight(baseUrl, "/"), taskID)

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Internal-Token", key)

	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

func (a *TaskAdaptor) GetModelList() []string {
	return []string{"vidu-q2", "vidu-q3", "kling-v2-6", "kling-v3", "kling-v3-omni"}
}

func (a *TaskAdaptor) GetChannelName() string {
	return ChannelName
}

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var qResp queryResponse
	if err := common.Unmarshal(respBody, &qResp); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal backend task result")
	}

	taskInfo := &relaycommon.TaskInfo{}
	url := qResp.Url
	if url == "" {
		url = qResp.VideoUrl
	}

	switch strings.ToLower(strings.TrimSpace(qResp.Status)) {
	case "queued", "submitted", "pending", "":
		taskInfo.Status = model.TaskStatusSubmitted
	case "processing", "running", "in_progress":
		taskInfo.Status = model.TaskStatusInProgress
	case "succeeded", "success", "succeed":
		taskInfo.Status = model.TaskStatusSuccess
		taskInfo.Url = url
	case "failed", "error":
		taskInfo.Status = model.TaskStatusFailure
		taskInfo.Reason = qResp.Reason
	default:
		return nil, fmt.Errorf("unknown backend task status: %s", qResp.Status)
	}
	return taskInfo, nil
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(originTask *model.Task) ([]byte, error) {
	var qResp queryResponse
	if err := common.Unmarshal(originTask.Data, &qResp); err != nil {
		// originTask.Data may be the raw create response; fall back gracefully.
		qResp = queryResponse{}
	}

	ov := dto.NewOpenAIVideo()
	ov.ID = originTask.TaskID
	ov.Status = originTask.Status.ToVideoStatus()
	ov.SetProgressStr(originTask.Progress)
	ov.CreatedAt = originTask.CreatedAt
	ov.CompletedAt = originTask.UpdatedAt

	url := qResp.Url
	if url == "" {
		url = qResp.VideoUrl
	}
	if url != "" {
		ov.SetMetadata("url", url)
	}
	if qResp.Reason != "" {
		ov.Error = &dto.OpenAIVideoError{Message: qResp.Reason, Code: qResp.Reason}
	}
	return common.Marshal(ov)
}
