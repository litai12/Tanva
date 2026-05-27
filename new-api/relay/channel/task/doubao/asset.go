package doubao

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)


type volcRespEnvelope struct {
	ResponseMetadata struct {
		Error *struct {
			Code    string `json:"Code"`
			Message string `json:"Message"`
		} `json:"Error"`
	} `json:"ResponseMetadata"`
	Result json.RawMessage `json:"Result"`
}

// volcCall signs and executes a single Volcengine API call, returning the unwrapped Result.
func volcCall(accessKey, secretKey, action string, body map[string]any) (json.RawMessage, error) {
	bodyBytes, err := common.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}

	signed := volcSign(accessKey, secretKey, action, string(bodyBytes))

	req, err := http.NewRequest(http.MethodPost, signed.URL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	for k, v := range signed.Headers {
		req.Header.Set(k, v)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}

	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		return nil, fmt.Errorf("client error %d: %s", resp.StatusCode, truncate(string(respBytes), 200))
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server error %d: %s", resp.StatusCode, truncate(string(respBytes), 200))
	}

	var envelope volcRespEnvelope
	if err := common.Unmarshal(respBytes, &envelope); err != nil {
		return nil, fmt.Errorf("parse: %w", err)
	}
	if e := envelope.ResponseMetadata.Error; e != nil && e.Code != "" {
		return nil, fmt.Errorf("[%s] %s", e.Code, e.Message)
	}
	return envelope.Result, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// createAssetGroup creates a transient group for a single task's assets.
func createAssetGroup(accessKey, secretKey string) (string, error) {
	result, err := volcCall(accessKey, secretKey, "CreateAssetGroup", map[string]any{
		"Name":        fmt.Sprintf("review-%d", time.Now().UnixMilli()),
		"Description": "auto review",
		"GroupType":   "AIGC",
		"ProjectName": volcProject,
	})
	if err != nil {
		return "", fmt.Errorf("CreateAssetGroup: %w", err)
	}
	var r struct{ Id string }
	if err := common.Unmarshal(result, &r); err != nil || r.Id == "" {
		return "", fmt.Errorf("CreateAssetGroup: empty Id in response")
	}
	return r.Id, nil
}

// createAsset uploads a URL into the group and returns the asset ID.
func createAsset(accessKey, secretKey, groupID, sourceURL string) (string, error) {
	result, err := volcCall(accessKey, secretKey, "CreateAsset", map[string]any{
		"GroupId":     groupID,
		"URL":         sourceURL,
		"AssetType":   "Image",
		"ProjectName": volcProject,
	})
	if err != nil {
		return "", fmt.Errorf("CreateAsset: %w", err)
	}
	var r struct{ Id string }
	if err := common.Unmarshal(result, &r); err != nil || r.Id == "" {
		return "", fmt.Errorf("CreateAsset: empty Id in response")
	}
	return r.Id, nil
}

// pollAssetActive polls GetAsset until status is "active" or "failed".
// No timeout — polls indefinitely to maximise success rate. Retries on transient errors.
func pollAssetActive(accessKey, secretKey, assetID string) error {
	const pollInterval = 3 * time.Second
	for {
		result, err := volcCall(accessKey, secretKey, "GetAsset", map[string]any{
			"Id":          assetID,
			"ProjectName": volcProject,
		})
		if err != nil {
			// Transient (5xx / network) — retry; permanent (4xx) already returned above.
			time.Sleep(pollInterval)
			continue
		}

		var r struct{ Status string }
		if err := common.Unmarshal(result, &r); err != nil {
			time.Sleep(pollInterval)
			continue
		}

		switch strings.ToLower(r.Status) {
		case "active":
			return nil
		case "failed":
			return fmt.Errorf("asset %s review failed", assetID)
		}
		time.Sleep(pollInterval)
	}
}

// deleteAssetGroup deletes the group (best-effort, logs on error).
func deleteAssetGroup(accessKey, secretKey, groupID string) {
	if groupID == "" {
		return
	}
	if _, err := volcCall(accessKey, secretKey, "DeleteAssetGroup", map[string]any{
		"Id":          groupID,
		"ProjectName": volcProject,
	}); err != nil {
		common.SysLog(fmt.Sprintf("doubao deleteAssetGroup %s: %v", groupID, err))
	}
}

// ensureAssetGroup creates a group if any entry in images is a raw URL (not already asset://).
// Returns the group ID and a cleanup function (no-op if no group was created).
func ensureAssetGroup(accessKey, secretKey string, images []string) (groupID string, cleanup func(), err error) {
	for _, img := range images {
		if !strings.HasPrefix(img, "asset://") {
			groupID, err = createAssetGroup(accessKey, secretKey)
			if err != nil {
				return "", func() {}, err
			}
			return groupID, func() { go deleteAssetGroup(accessKey, secretKey, groupID) }, nil
		}
	}
	return "", func() {}, nil
}

// uploadImage uploads a single raw URL to the group and polls until active.
// imageIndex is the position in the caller's array, used only for error messages.
func uploadImage(accessKey, secretKey, groupID, imgURL string, imageIndex int) (assetURL string, err error) {
	assetID, err := createAsset(accessKey, secretKey, groupID, imgURL)
	if err != nil {
		return "", fmt.Errorf("参考图上传失败 image[%d]: %w", imageIndex, err)
	}
	if err := pollAssetActive(accessKey, secretKey, assetID); err != nil {
		return "", fmt.Errorf("参考图审核未通过 image[%d]", imageIndex)
	}
	return "asset://" + assetID, nil
}

// pollAssetActiveWithTimeout polls GetAsset until active/failed or the deadline is exceeded.
func pollAssetActiveWithTimeout(accessKey, secretKey, assetID string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	const pollInterval = 3 * time.Second
	for time.Now().Before(deadline) {
		result, err := volcCall(accessKey, secretKey, "GetAsset", map[string]any{
			"Id":          assetID,
			"ProjectName": volcProject,
		})
		if err != nil {
			time.Sleep(pollInterval)
			continue
		}
		var r struct{ Status string }
		if err := common.Unmarshal(result, &r); err != nil {
			time.Sleep(pollInterval)
			continue
		}
		switch strings.ToLower(r.Status) {
		case "active":
			return nil
		case "failed":
			return fmt.Errorf("asset %s failed content review", assetID)
		}
		time.Sleep(pollInterval)
	}
	return fmt.Errorf("asset %s upload timed out", assetID)
}

// UploadAsset creates an ephemeral review group, uploads sourceURL, waits up to 2 min
// until the asset passes review, then deletes the group and returns the assetID.
// Callers use the returned assetID as "asset://<assetID>" in generation requests.
func UploadAsset(accessKey, secretKey, sourceURL string) (string, error) {
	groupID, err := createAssetGroup(accessKey, secretKey)
	if err != nil {
		return "", fmt.Errorf("create review group: %w", err)
	}
	defer func() { go deleteAssetGroup(accessKey, secretKey, groupID) }()

	assetID, err := createAsset(accessKey, secretKey, groupID, sourceURL)
	if err != nil {
		return "", fmt.Errorf("create asset: %w", err)
	}
	if err := pollAssetActiveWithTimeout(accessKey, secretKey, assetID, 2*time.Minute); err != nil {
		return "", err
	}
	return assetID, nil
}

// QueryAssetStatus returns the normalized ARK asset status: "active", "failed", or "processing".
func QueryAssetStatus(accessKey, secretKey, assetID string) (string, error) {
	result, err := volcCall(accessKey, secretKey, "GetAsset", map[string]any{
		"Id":          assetID,
		"ProjectName": volcProject,
	})
	if err != nil {
		return "", err
	}
	var r struct{ Status string }
	if err := common.Unmarshal(result, &r); err != nil {
		return "", err
	}
	s := strings.ToLower(r.Status)
	if s == "" {
		return "processing", nil
	}
	return s, nil
}
