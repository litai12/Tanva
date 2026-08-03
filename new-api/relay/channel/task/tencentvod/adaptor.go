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
// Scope: Vidu, Kling and Hailuo H3. Seedance uses asset:// (VolcEngine-native)
// image references that Tencent VOD cannot consume, so Seedance stays on the
// ark-doubao-video channel.
package tencentvod

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

const ChannelName = "tencent-vod"

// createPayload is the body sent to the backend create endpoint. It is the
// channel-agnostic subset of the unified /v1/videos request the backend needs
// to rebuild a VideoProviderRequestDto and drive the Tencent VOD path.
type createPayload struct {
	Model           string                 `json:"model"`
	Prompt          string                 `json:"prompt,omitempty"`
	Images          []string               `json:"images,omitempty"`
	ReferenceVideos []string               `json:"reference_videos,omitempty"`
	ReferenceAudios []string               `json:"audio_urls,omitempty"`
	LastFrame       string                 `json:"lastFrame,omitempty"`
	Duration        int                    `json:"duration,omitempty"`
	Size            string                 `json:"size,omitempty"`
	Resolution      string                 `json:"resolution,omitempty"`
	AspectRatio     string                 `json:"aspect_ratio,omitempty"`
	Mode            string                 `json:"mode,omitempty"`
	Metadata        map[string]interface{} `json:"metadata,omitempty"`
}

const hailuoH3DurationCacheKey = "tencent_vod_hailuo_h3_duration_cache"

func isHailuoH3(modelName string) bool {
	return strings.EqualFold(strings.TrimSpace(modelName), "hailuo-h3")
}

// EstimateBillingChecked makes new-api the sole Hailuo H3 pricing source.
// Base ModelRatio 45 represents 2K at RMB 1.20/s. 4K is 1.25x. Every unique
// reference-video second is billable, and images beyond the first five cost
// RMB 0.30 each (represented as 0.25 equivalent 2K seconds / 0.20 4K seconds).
func (a *TaskAdaptor) EstimateBillingChecked(c *gin.Context, info *relaycommon.RelayInfo) (map[string]float64, *dto.TaskError) {
	modelName := info.OriginModelName
	if !isHailuoH3(modelName) && !isHailuoH3(info.UpstreamModelName) {
		return nil, nil
	}
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	if req.Duration < 4 || req.Duration > 15 {
		return nil, service.TaskErrorWrapperLocal(fmt.Errorf("Hailuo H3 duration must be between 4 and 15 seconds"), "invalid_duration", http.StatusBadRequest)
	}
	resolution := strings.ToUpper(strings.TrimSpace(req.Resolution))
	if resolution != "2K" && resolution != "4K" {
		return nil, service.TaskErrorWrapperLocal(fmt.Errorf("Hailuo H3 resolution must be 2K or 4K"), "invalid_resolution", http.StatusBadRequest)
	}

	videoURLs := uniqueNonEmpty(req.ReferenceVideos)
	if len(videoURLs) > 3 {
		return nil, service.TaskErrorWrapperLocal(fmt.Errorf("Hailuo H3 accepts at most 3 reference videos"), "invalid_reference_video_count", http.StatusBadRequest)
	}
	cache, _ := c.Get(hailuoH3DurationCacheKey)
	durations, _ := cache.(map[string]float64)
	if durations == nil {
		durations = map[string]float64{}
	}
	inputSeconds := 0.0
	for i, rawURL := range videoURLs {
		duration, ok := durations[rawURL]
		var probeErr error
		if !ok {
			duration, probeErr = probeHailuoReferenceVideo(c, rawURL)
			if probeErr == nil && duration > 0 && !math.IsNaN(duration) && !math.IsInf(duration, 0) {
				durations[rawURL] = duration
			}
		}
		if probeErr != nil || duration < 2 || duration > 15 || math.IsNaN(duration) || math.IsInf(duration, 0) {
			return nil, service.TaskErrorWrapperLocal(fmt.Errorf("Hailuo H3 reference video %d must be readable and 2-15 seconds", i+1), "invalid_reference_video_duration", http.StatusBadRequest)
		}
		inputSeconds += duration
	}
	if inputSeconds > 15.0001 {
		return nil, service.TaskErrorWrapperLocal(fmt.Errorf("Hailuo H3 reference videos total duration must not exceed 15 seconds"), "invalid_reference_video_duration", http.StatusBadRequest)
	}
	c.Set(hailuoH3DurationCacheKey, durations)

	images := append(append([]string{}, req.Images...), req.ReferenceImages...)
	if strings.TrimSpace(req.LastFrame) != "" {
		images = append(images, req.LastFrame)
	}
	imageCount := len(uniqueNonEmpty(images))
	if imageCount > 9 {
		return nil, service.TaskErrorWrapperLocal(fmt.Errorf("Hailuo H3 accepts at most 9 images"), "invalid_reference_image_count", http.StatusBadRequest)
	}
	audioURLs := uniqueNonEmpty(req.ReferenceAudios)
	if len(audioURLs) > 3 {
		return nil, service.TaskErrorWrapperLocal(fmt.Errorf("Hailuo H3 accepts at most 3 reference audios"), "invalid_reference_audio_count", http.StatusBadRequest)
	}
	if len(audioURLs) > 0 && imageCount == 0 && len(videoURLs) == 0 {
		return nil, service.TaskErrorWrapperLocal(fmt.Errorf("Hailuo H3 audio references require an image or video reference"), "invalid_reference_audio", http.StatusBadRequest)
	}
	if imageCount+len(videoURLs)+len(audioURLs) > 12 {
		return nil, service.TaskErrorWrapperLocal(fmt.Errorf("Hailuo H3 accepts at most 12 mixed reference files"), "invalid_reference_count", http.StatusBadRequest)
	}

	extraImages := imageCount - 5
	if extraImages < 0 {
		extraImages = 0
	}
	equivalentImageSeconds := float64(extraImages) * 0.25
	ratios := map[string]float64{"seconds": float64(req.Duration) + inputSeconds + equivalentImageSeconds}
	if resolution == "4K" {
		// 4K base/video price is 1.25x, while each excess image remains RMB 0.30.
		ratios["seconds"] = float64(req.Duration) + inputSeconds + float64(extraImages)*0.20
		ratios["resolution"] = 1.25
	}
	creditsPerSecond := 120.0
	if resolution == "4K" {
		creditsPerSecond = 150.0
	}
	consumedCredits := int(math.Ceil((float64(req.Duration)+inputSeconds)*creditsPerSecond + float64(extraImages)*30.0))
	c.Header("X-NewApi-Consumed-Credits", fmt.Sprintf("%d", consumedCredits))
	return ratios, nil
}

func uniqueNonEmpty(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func probeHailuoReferenceVideo(c *gin.Context, rawURL string) (float64, error) {
	resp, err := service.DoDownloadRequest(rawURL, "hailuo_h3_billing_duration")
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("reference video download returned HTTP %d", resp.StatusCode)
	}
	tmp, err := os.CreateTemp("", "new-api-hailuo-h3-*.mp4")
	if err != nil {
		return 0, err
	}
	path := tmp.Name()
	defer os.Remove(path)
	defer tmp.Close()
	maxBytes := int64(constant.MaxFileDownloadMB) * 1024 * 1024
	written, err := io.Copy(tmp, io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return 0, err
	}
	if written > maxBytes {
		return 0, fmt.Errorf("reference video exceeds %dMB", constant.MaxFileDownloadMB)
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return 0, err
	}
	ctx := context.Background()
	if c != nil && c.Request != nil {
		ctx = c.Request.Context()
	}
	return common.GetAudioDuration(ctx, tmp, ".mp4")
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
		Model:           modelName,
		Prompt:          req.Prompt,
		Images:          uniqueNonEmpty(append(append([]string{}, req.Images...), req.ReferenceImages...)),
		ReferenceVideos: uniqueNonEmpty(req.ReferenceVideos),
		ReferenceAudios: uniqueNonEmpty(req.ReferenceAudios),
		LastFrame:       req.LastFrame,
		Duration:        req.Duration,
		Size:            req.Size,
		Resolution:      req.Resolution,
		AspectRatio:     req.AspectRatio,
		Mode:            req.Mode,
		Metadata:        req.Metadata,
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
	return []string{"vidu-q2", "vidu-q3", "kling-v2-6", "kling-v3", "kling-v3-omni", "hailuo-h3"}
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
