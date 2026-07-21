package apimart

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
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

// TaskAdaptor drives APIMart's unified async flow:
//
//	submit → POST {base}/v1/{images,videos}/generations   (returns task_id)
//	poll   → GET  {base}/v1/tasks/{task_id}               (returns status+result)
//
// Unlike wuyinkeji's per-model submit paths, APIMart splits only by image vs
// video. Per-model parameter differences (duration, aspect_ratio, resolution,
// sequential_image_generation, etc.) are forwarded via SubmitPayload.Extras
// which merges TaskSubmitReq.Metadata on top of the canonical fields.
type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType        int
	apiKey             string
	baseURL            string
	videoDurationProbe func(c *gin.Context, rawURL string) (float64, error)
}

const seedance2VideoDurationCacheContextKey = "apimart_seedance2_video_duration_cache"

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	return relaycommon.ValidateBasicTaskRequest(c, info, constant.TaskActionGenerate)
}

// EstimateBillingChecked charges Seedance 2 by total processed video seconds:
// the requested output duration plus every unique reference video's real
// duration. RelayTaskSubmit invokes this after channel model mapping and before
// pre-charge, so aliases cannot bypass reference-video billing.
func (a *TaskAdaptor) EstimateBillingChecked(c *gin.Context, info *relaycommon.RelayInfo) (map[string]float64, *dto.TaskError) {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	upstreamModel := ""
	if info.ChannelMeta != nil {
		upstreamModel = info.ChannelMeta.UpstreamModelName
	}
	if !isSeedance2BillingModel(upstreamModel) && !isSeedance2BillingModel(info.OriginModelName) {
		return nil, nil
	}
	if req.Duration <= 0 {
		return nil, service.TaskErrorWrapperLocal(
			fmt.Errorf("apimart Seedance 2 billing requires an explicit positive output duration"),
			"invalid_duration",
			http.StatusBadRequest,
		)
	}

	probe := a.videoDurationProbe
	if probe == nil {
		probe = probeReferenceVideoDuration
	}
	durationCache, _ := c.Get(seedance2VideoDurationCacheContextKey)
	cachedDurations, _ := durationCache.(map[string]float64)
	if cachedDurations == nil {
		cachedDurations = make(map[string]float64)
	}
	inputSeconds := 0.0
	for i, rawURL := range collectSeedance2VideoURLs(&req) {
		duration, cached := cachedDurations[rawURL]
		var probeErr error
		if !cached {
			duration, probeErr = probe(c, rawURL)
			if probeErr == nil && duration > 0 && !math.IsNaN(duration) && !math.IsInf(duration, 0) {
				cachedDurations[rawURL] = duration
			}
		}
		if probeErr != nil || duration <= 0 || math.IsNaN(duration) || math.IsInf(duration, 0) {
			return nil, service.TaskErrorWrapperLocal(
				fmt.Errorf("reference video %d must be a reachable MP4 with a readable duration", i+1),
				"invalid_reference_video_duration",
				http.StatusBadRequest,
			)
		}
		inputSeconds += duration
	}
	c.Set(seedance2VideoDurationCacheContextKey, cachedDurations)
	return map[string]float64{"seconds": float64(req.Duration) + inputSeconds}, nil
}

func probeReferenceVideoDuration(c *gin.Context, rawURL string) (float64, error) {
	resp, err := service.DoDownloadRequest(rawURL, "seedance2_billing_duration")
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("reference video download returned HTTP %d", resp.StatusCode)
	}

	tmp, err := os.CreateTemp("", "new-api-seedance2-*.mp4")
	if err != nil {
		return 0, fmt.Errorf("create temporary reference video: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	defer tmp.Close()

	maxBytes := int64(constant.MaxFileDownloadMB) * 1024 * 1024
	written, err := io.Copy(tmp, io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return 0, fmt.Errorf("download reference video: %w", err)
	}
	if written > maxBytes {
		return 0, fmt.Errorf("reference video exceeds maximum download size of %dMB", constant.MaxFileDownloadMB)
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return 0, fmt.Errorf("seek reference video: %w", err)
	}

	ctx := context.Background()
	if c != nil && c.Request != nil {
		ctx = c.Request.Context()
	}
	return common.GetAudioDuration(ctx, tmp, ".mp4")
}

func (a *TaskAdaptor) BuildRequestURL(info *relaycommon.RelayInfo) (string, error) {
	kind := model.GetModelKind(info.UpstreamModelName)
	path, ok := SubmitPath(info.UpstreamModelName, kind)
	if !ok {
		return "", fmt.Errorf("apimart: unknown model kind for %q (kind=%q); ensure the model is configured in new-api with a valid kind", info.UpstreamModelName, kind)
	}
	return a.baseURL + path, nil
}

func (a *TaskAdaptor) BuildRequestHeader(c *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
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

	// Upstream model string is the billable model (OriginModelName may be the
	// user-facing alias). Keep billing stable by passing the upstream name.
	req.Model = info.UpstreamModelName

	payload, err := BuildSubmitPayload(&req)
	if err != nil {
		return nil, errors.Wrap(err, "build payload failed")
	}

	if requiresAssetConversion(info.UpstreamModelName) {
		if err := resolvePayloadAssets(payload, a.baseURL, a.apiKey); err != nil {
			return nil, errors.Wrap(err, "resolve asset urls failed")
		}
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

	var sResp SubmitResponse
	if err := common.Unmarshal(responseBody, &sResp); err != nil {
		taskErr = service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody),
			"unmarshal_response_body_failed", http.StatusInternalServerError)
		return
	}
	upstreamTaskID := sResp.TaskID()
	if !sResp.Accepted() || upstreamTaskID == "" {
		msg := sResp.ErrorMessage()
		if msg == "" {
			msg = fmt.Sprintf("apimart submit non-200: %d", sResp.Code)
		}
		taskErr = service.TaskErrorWrapper(fmt.Errorf("%s", msg), fmt.Sprintf("%d", sResp.Code), http.StatusInternalServerError)
		return
	}

	ov := dto.NewOpenAIVideo()
	ov.ID = info.PublicTaskID
	ov.TaskID = info.PublicTaskID
	ov.CreatedAt = time.Now().Unix()
	ov.Model = info.OriginModelName
	c.JSON(http.StatusOK, ov)

	return upstreamTaskID, responseBody, nil
}

func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok || taskID == "" {
		return nil, fmt.Errorf("invalid task_id")
	}
	uri := baseUrl + PollPath(taskID)
	if strings.Contains(strings.ToLower(baseUrl), "toapis.com") {
		uri = baseUrl + FlatVideoPollPath(taskID)
	}
	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)

	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

func (a *TaskAdaptor) GetModelList() []string { return AllAsyncModels() }

func (a *TaskAdaptor) GetChannelName() string { return ChannelName }

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var dResp DetailResponse
	if err := common.Unmarshal(respBody, &dResp); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}

	info := &relaycommon.TaskInfo{Code: dResp.Code}
	if !dResp.Ready() {
		info.Status = model.TaskStatusFailure
		info.Reason = dResp.FailureReason()
		info.Progress = taskcommon.ProgressComplete
		return info, nil
	}

	info.Progress = clampProgress(dResp.EffectiveProgress())
	switch dResp.EffectiveStatus() {
	case StatusPending, StatusQueued:
		info.Status = model.TaskStatusQueued
	case StatusProcessing, StatusInProgress:
		info.Status = model.TaskStatusInProgress
	case StatusCompleted:
		info.Status = model.TaskStatusSuccess
		info.Progress = taskcommon.ProgressComplete
		info.Url = dResp.FirstURL()
	case StatusFailed:
		info.Status = model.TaskStatusFailure
		info.Progress = taskcommon.ProgressComplete
		info.Reason = dResp.FailureReason()
	case StatusCancelled:
		info.Status = model.TaskStatusFailure
		info.Progress = taskcommon.ProgressComplete
		info.Reason = "cancelled"
	default:
		info.Status = model.TaskStatusInProgress
	}
	return info, nil
}

// ConvertToOpenAIVideo implements channel.OpenAIVideoConverter so new-api's
// GET /v1/videos/{task_id} endpoint (OpenAI Sora-style) can surface APIMart
// task state to SDK clients. The stored task.Data is the most recent poll
// body from GET /v1/tasks/{task_id}; we unpack it into dto.OpenAIVideo.
func (a *TaskAdaptor) ConvertToOpenAIVideo(originTask *model.Task) ([]byte, error) {
	openAIVideo := dto.NewOpenAIVideo()
	openAIVideo.ID = originTask.TaskID
	openAIVideo.TaskID = originTask.TaskID
	openAIVideo.Status = originTask.Status.ToVideoStatus()
	openAIVideo.SetProgressStr(originTask.Progress)
	openAIVideo.CreatedAt = originTask.CreatedAt
	openAIVideo.CompletedAt = originTask.UpdatedAt
	openAIVideo.Model = originTask.Properties.OriginModelName

	if len(originTask.Data) > 0 {
		var dResp DetailResponse
		if err := common.Unmarshal(originTask.Data, &dResp); err == nil {
			if url := dResp.FirstURL(); url != "" {
				openAIVideo.SetMetadata("url", url)
			}
			if dResp.Data != nil && dResp.Data.Result != nil && dResp.Data.Result.ThumbnailURL != "" {
				openAIVideo.SetMetadata("thumbnail_url", dResp.Data.Result.ThumbnailURL)
			}
			if reason := dResp.FailureReason(); reason != "" &&
				(originTask.Status == model.TaskStatusFailure || originTask.Status == model.TaskStatusUnknown) {
				openAIVideo.Error = &dto.OpenAIVideoError{Message: reason}
			}
		}
	}

	return common.Marshal(openAIVideo)
}

// clampProgress maps APIMart's 0..100 integer progress to new-api's
// string progress representation expected by taskcommon helpers.
func clampProgress(pct int) string {
	if pct <= 0 {
		return taskcommon.ProgressQueued
	}
	if pct >= 100 {
		return taskcommon.ProgressComplete
	}
	return fmt.Sprintf("%d%%", pct)
}
