package tencent

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ─── DTOs ────────────────────────────────────────────────────────────────────

type vodImageFileInfo struct {
	Type   string `json:"Type"`
	FileId string `json:"FileId,omitempty"`
	Url    string `json:"Url,omitempty"`
}

type vodImageOutputConfig struct {
	StorageMode string `json:"StorageMode"`
	AspectRatio string `json:"AspectRatio,omitempty"`
	Resolution  string `json:"Resolution,omitempty"`
}

type vodCreateImageTaskReq struct {
	ModelName     string               `json:"ModelName"`
	ModelVersion  string               `json:"ModelVersion"`
	SubAppId      int64                `json:"SubAppId"`
	EnhancePrompt string               `json:"EnhancePrompt"`
	OutputConfig  vodImageOutputConfig `json:"OutputConfig"`
	Prompt        string               `json:"Prompt,omitempty"`
	FileInfos     []vodImageFileInfo   `json:"FileInfos,omitempty"`
	NegativePrompt string              `json:"NegativePrompt,omitempty"`
}

type vodTaskDetailReq struct {
	TaskId   string `json:"TaskId"`
	SubAppId int64  `json:"SubAppId"`
}

// ─── TC3 signing for vod.tencentcloudapi.com ─────────────────────────────────

func vodTC3Sign(secretId, secretKey, action string, body []byte, timestamp int64) string {
	const host = "vod.tencentcloudapi.com"
	const svc = "vod"

	date := time.Unix(timestamp, 0).UTC().Format("2006-01-02")

	canonicalHeaders := "content-type:application/json; charset=utf-8\n" +
		"host:" + host + "\n" +
		"x-tc-action:" + strings.ToLower(action) + "\n"
	signedHeaders := "content-type;host;x-tc-action"

	h := sha256.Sum256(body)
	hashedPayload := hex.EncodeToString(h[:])

	canonicalRequest := "POST\n/\n\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + hashedPayload

	h2 := sha256.Sum256([]byte(canonicalRequest))
	hashedCanonical := hex.EncodeToString(h2[:])

	credentialScope := date + "/" + svc + "/tc3_request"
	stringToSign := "TC3-HMAC-SHA256\n" +
		strconv.FormatInt(timestamp, 10) + "\n" +
		credentialScope + "\n" + hashedCanonical

	mac := func(key []byte, data string) []byte {
		h := hmac.New(sha256.New, key)
		h.Write([]byte(data))
		return h.Sum(nil)
	}
	kDate := mac([]byte("TC3"+secretKey), date)
	kService := mac(kDate, svc)
	kSigning := mac(kService, "tc3_request")
	sig := hex.EncodeToString(hmac.New(sha256.New, kSigning).Sum(nil))
	_ = sig
	sigFinal := hex.EncodeToString(func() []byte {
		h := hmac.New(sha256.New, kSigning)
		h.Write([]byte(stringToSign))
		return h.Sum(nil)
	}())

	return fmt.Sprintf(
		"TC3-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		secretId, credentialScope, signedHeaders, sigFinal,
	)
}

func vodCall(secretId, secretKey, action, version string, payload any) (map[string]any, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	timestamp := time.Now().Unix()
	auth := vodTC3Sign(secretId, secretKey, action, body, timestamp)

	req, err := http.NewRequest(http.MethodPost, "https://vod.tencentcloudapi.com/", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", auth)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Host", "vod.tencentcloudapi.com")
	req.Header.Set("X-TC-Action", action)
	req.Header.Set("X-TC-Version", version)
	req.Header.Set("X-TC-Timestamp", strconv.FormatInt(timestamp, 10))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	rawBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var outer struct {
		Response map[string]any `json:"Response"`
	}
	if err := json.Unmarshal(rawBody, &outer); err != nil {
		return nil, fmt.Errorf("vod response parse error: %s", string(rawBody))
	}
	if outer.Response == nil {
		return nil, fmt.Errorf("vod empty response: %s", string(rawBody))
	}

	// Check for API-level error
	if errObj, ok := outer.Response["Error"]; ok {
		if errMap, ok := errObj.(map[string]any); ok {
			code, _ := errMap["Code"].(string)
			msg, _ := errMap["Message"].(string)
			return nil, fmt.Errorf("vod API error %s: %s", code, msg)
		}
	}
	return outer.Response, nil
}

// ─── Tencent image version resolution ────────────────────────────────────────

func resolveTencentImageVersion(quality, resolution string) string {
	q := strings.ToLower(strings.TrimSpace(quality))
	r := strings.ToUpper(strings.TrimSpace(resolution))
	if q == "high" || r == "4K" {
		return "image2_high"
	}
	if q == "medium" || r == "2K" {
		return "image2_medium"
	}
	return "image2_low"
}

// ─── File info conversion ─────────────────────────────────────────────────────

func toVodFileInfos(imageUrls []string) []vodImageFileInfo {
	out := make([]vodImageFileInfo, 0, len(imageUrls))
	for _, raw := range imageUrls {
		u := strings.TrimSpace(raw)
		if u == "" {
			continue
		}
		if strings.HasPrefix(u, "tencent-fileid:") {
			out = append(out, vodImageFileInfo{Type: "File", FileId: u[len("tencent-fileid:"):]})
		} else if isNumeric(u) {
			out = append(out, vodImageFileInfo{Type: "File", FileId: u})
		} else {
			out = append(out, vodImageFileInfo{Type: "Url", Url: u})
		}
	}
	return out
}

func isNumeric(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return s != ""
}

// ─── Create image task ────────────────────────────────────────────────────────

func createVodImageTask(secretId, secretKey string, subAppId int64, req vodCreateImageTaskReq) (string, error) {
	resp, err := vodCall(secretId, secretKey, "CreateAigcImageTask", "2018-07-17", req)
	if err != nil {
		return "", err
	}
	taskId, _ := resp["TaskId"].(string)
	if taskId == "" {
		return "", fmt.Errorf("CreateAigcImageTask succeeded but TaskId is missing: %v", resp)
	}
	return taskId, nil
}

// ─── Poll for image result ────────────────────────────────────────────────────

func pollVodImageTask(secretId, secretKey string, subAppId int64, taskId string, timeout time.Duration) (string, error) {
	const pollInterval = 3 * time.Second
	const maxAttempts = 200

	deadline := time.Now().Add(timeout)

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if time.Now().After(deadline) {
			return "", fmt.Errorf("Tencent VOD image task %s timeout after %v", taskId, timeout)
		}

		resp, err := vodCall(secretId, secretKey, "DescribeTaskDetail", "2018-07-17", vodTaskDetailReq{
			TaskId:   taskId,
			SubAppId: subAppId,
		})
		if err != nil {
			return "", fmt.Errorf("DescribeTaskDetail failed: %w", err)
		}

		status := normalizeVodTaskStatus(resp)
		switch status {
		case "success":
			if url := extractVodImageURL(resp); url != "" {
				return url, nil
			}
			// success without URL: retry a few times
			if attempt >= 8 {
				return "", fmt.Errorf("Tencent VOD image task %s completed but image URL is missing", taskId)
			}
		case "failed":
			return "", fmt.Errorf("Tencent VOD image task %s failed", taskId)
		}

		time.Sleep(pollInterval)
	}
	return "", fmt.Errorf("Tencent VOD image task %s polling timeout after %d attempts", taskId, maxAttempts)
}

func normalizeVodTaskStatus(resp map[string]any) string {
	status, _ := resp["Status"].(string)
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "finish", "finished", "success", "succeed", "succeeded", "completed":
		return "success"
	case "fail", "failed", "failure", "error":
		return "failed"
	default:
		return "processing"
	}
}

func extractVodImageURL(resp map[string]any) string {
	candidates := []string{"ImageUrl", "OutputImageUrl", "Url", "MediaUrl", "FileUrl"}
	for _, k := range candidates {
		if v, ok := resp[k].(string); ok && strings.HasPrefix(v, "http") {
			return v
		}
	}
	// Try nested AigcTaskDetail
	if detail, ok := resp["AigcTaskDetail"].(map[string]any); ok {
		for _, k := range candidates {
			if v, ok := detail[k].(string); ok && strings.HasPrefix(v, "http") {
				return v
			}
		}
		// Try OutputMediaSet
		if outSet, ok := detail["OutputMediaSet"].(map[string]any); ok {
			if mediaList, ok := outSet["MediaInfoSet"].([]any); ok && len(mediaList) > 0 {
				if item, ok := mediaList[0].(map[string]any); ok {
					if basic, ok := item["BasicInfo"].(map[string]any); ok {
						if v, ok := basic["CoverUrl"].(string); ok && strings.HasPrefix(v, "http") {
							return v
						}
					}
				}
			}
		}
	}
	return ""
}

// ─── Build synthetic OpenAI image response ────────────────────────────────────

func buildOpenAIImageResponseBody(imageURL string) string {
	type imageItem struct {
		URL string `json:"url"`
	}
	type response struct {
		Created int64       `json:"created"`
		Data    []imageItem `json:"data"`
	}
	r := response{
		Created: time.Now().Unix(),
		Data:    []imageItem{{URL: imageURL}},
	}
	b, _ := json.Marshal(r)
	return string(b)
}
