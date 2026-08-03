package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// extractTencentVodResponseTaskId 从创建响应里取 TaskId（兼容 Response.TaskId / 顶层 TaskId）。
func extractTencentVodResponseTaskId(respBytes []byte) string {
	return findFirstByKeys(respBytes, []string{"TaskId"})
}

// extractTencentVodReqTaskId 从轮询请求体里取 TaskId。
func extractTencentVodReqTaskId(reqBytes []byte) string {
	return findFirstByKeys(reqBytes, []string{"TaskId"})
}

// extractTencentVodStatus 从轮询响应里取状态（递归找首个 Status/TaskStatus/State）。
func extractTencentVodStatus(respBytes []byte) string {
	if extractTencentVodTaskError(respBytes) != "" {
		return "FAILED"
	}
	return findFirstByKeys(respBytes, []string{"Status", "TaskStatus", "State"})
}

// extractTencentVodTaskError handles Tencent's H3 response shape where the
// outer Response.Status can be FINISH even though AigcVideoTask failed. A
// non-zero ErrCode or an explicit failure message is terminal failure.
func extractTencentVodTaskError(respBytes []byte) string {
	var root any
	if err := common.Unmarshal(respBytes, &root); err != nil {
		return ""
	}

	var walk func(any) string
	walk = func(value any) string {
		switch item := value.(type) {
		case map[string]any:
			for _, key := range []string{
				"AigcVideoTask",
				"AIGCVideoTask",
				"AigcImageTask",
				"AIGCImageTask",
				"TaskDetail",
			} {
				candidate, ok := item[key].(map[string]any)
				if !ok {
					continue
				}
				if message := extractTencentVodCandidateError(candidate); message != "" {
					return message
				}
			}
			for _, child := range item {
				if message := walk(child); message != "" {
					return message
				}
			}
		case []any:
			for _, child := range item {
				if message := walk(child); message != "" {
					return message
				}
			}
		}
		return ""
	}

	return walk(root)
}

func extractTencentVodCandidateError(candidate map[string]any) string {
	rawCode := candidate["ErrCode"]
	if rawCode == nil {
		rawCode = candidate["errCode"]
	}
	if rawCode == nil {
		rawCode = candidate["ErrorCode"]
	}
	if rawCode == nil {
		rawCode = candidate["errorCode"]
	}
	code, nonZero := normalizeTencentVodErrorCode(rawCode)
	extCode := firstTencentVodString(candidate, "ErrCodeExt", "errCodeExt", "ErrorCodeExt")
	message := firstTencentVodString(candidate, "Message", "message", "ErrMsg", "errMsg", "ErrorMessage", "errorMessage")
	lowerMessage := strings.ToLower(message)
	hasFailureMessage := strings.Contains(lowerMessage, "fail") ||
		strings.Contains(lowerMessage, "error") ||
		strings.Contains(lowerMessage, "exception") ||
		strings.Contains(lowerMessage, "system error")
	if !nonZero && !hasFailureMessage {
		return ""
	}
	parts := make([]string, 0, 3)
	if code != "" {
		parts = append(parts, code)
	}
	if extCode != "" {
		parts = append(parts, extCode)
	}
	if message != "" {
		parts = append(parts, message)
	}
	if len(parts) == 0 {
		return "Tencent VOD task failed"
	}
	return strings.Join(parts, ": ")
}

func normalizeTencentVodErrorCode(value any) (string, bool) {
	switch code := value.(type) {
	case float64:
		return strconv.FormatInt(int64(code), 10), code != 0
	case string:
		trimmed := strings.TrimSpace(code)
		if trimmed == "" {
			return "", false
		}
		if numeric, err := strconv.ParseFloat(trimmed, 64); err == nil {
			return trimmed, numeric != 0
		}
		return trimmed, true
	default:
		return "", false
	}
}

func firstTencentVodString(candidate map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := candidate[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// extractTencentVodVideoURL 尽力从响应里找一个视频结果 URL（腾讯临时地址即可）。
func extractTencentVodVideoURL(respBytes []byte) string {
	var root any
	if err := common.Unmarshal(respBytes, &root); err != nil {
		return ""
	}
	best := ""
	var walk func(v any)
	walk = func(v any) {
		switch t := v.(type) {
		case map[string]any:
			for _, val := range t {
				walk(val)
			}
		case []any:
			for _, val := range t {
				walk(val)
			}
		case string:
			low := strings.ToLower(t)
			if strings.HasPrefix(low, "http://") || strings.HasPrefix(low, "https://") {
				if strings.HasSuffix(low, ".mp4") {
					best = t // .mp4 优先，直接采用
				} else if best == "" {
					best = t
				}
			}
		}
	}
	walk(root)
	return best
}

// findFirstByKeys 递归在 JSON 里找首个命中 keys 的字符串值（数字会转成字符串）。
func findFirstByKeys(raw []byte, keys []string) string {
	var root any
	if err := common.Unmarshal(raw, &root); err != nil {
		return ""
	}
	found := ""
	var walk func(v any) bool
	walk = func(v any) bool {
		switch t := v.(type) {
		case map[string]any:
			for _, k := range keys {
				if val, ok := t[k]; ok {
					if s, ok := val.(string); ok && s != "" {
						found = s
						return true
					}
					if n, ok := val.(float64); ok {
						found = strconv.FormatInt(int64(n), 10)
						return true
					}
				}
			}
			for _, val := range t {
				if walk(val) {
					return true
				}
			}
		case []any:
			for _, val := range t {
				if walk(val) {
					return true
				}
			}
		}
		return false
	}
	walk(root)
	return found
}

// mapTencentVodStatus 把腾讯状态字符串归一映射到 new-api TaskStatus。
func mapTencentVodStatus(raw string) model.TaskStatus {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "finish", "finished", "success", "succeed", "succeeded", "completed", "complete", "done":
		return model.TaskStatusSuccess
	case "failed", "fail", "error", "cancel", "cancelled", "exception", "timeout":
		return model.TaskStatusFailure
	default:
		return model.TaskStatusInProgress
	}
}
