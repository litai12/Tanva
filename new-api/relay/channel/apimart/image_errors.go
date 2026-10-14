package apimart

import (
	"net/http"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	taskapimart "github.com/QuantumNous/new-api/relay/channel/task/apimart"
	"github.com/QuantumNous/new-api/types"
)

const imageTaskIDHeader = "X-New-API-Upstream-Image-Task-ID"
const imageRequestIDHeader = "X-New-API-Upstream-Image-Request-ID"
const imageProviderHeader = "X-New-API-Upstream-Image-Provider"

var imageErrorSensitivePattern = regexp.MustCompile(`(?i)data:[^\s]+|bearer\s+[^\s]+|sk-[a-z0-9_-]+|[a-z0-9+/=_-]{128,}`)

func safeImageErrorMessage(message, fallback string) string {
	message = strings.TrimSpace(message)
	if message == "" || len(message) > 2048 {
		return fallback
	}
	message = common.MaskSensitiveInfo(imageErrorSensitivePattern.ReplaceAllString(message, "[redacted]"))
	runes := []rune(message)
	if len(runes) > 512 {
		message = string(runes[:512]) + "…"
	}
	return message
}

// imageTaskError keeps provider evidence separate from the human message and
// disables relay retries: a submitted image must never create another paid task.
func imageTaskError(message, code string, statusCode int, evidence types.UpstreamImageTaskEvidence) *types.NewAPIError {
	if code == "" {
		code = "upstream_image_task_unknown"
		if evidence.Terminal && (evidence.Status == taskapimart.StatusFailed || evidence.Status == taskapimart.StatusCancelled) {
			code = "upstream_image_task_" + evidence.Status
		}
	}
	if evidence.Status == "" {
		evidence.Status = "unknown"
	}
	return types.WithOpenAIError(types.OpenAIError{
		Message: safeImageErrorMessage(message, "Upstream image task outcome is unknown"),
		Type:    "upstream_error", Code: code, UpstreamImageTask: &evidence,
	}, statusCode, types.ErrOptionWithSkipRetry())
}

func imageTaskProvider(flat bool) string {
	if flat {
		return "toapis"
	}
	return "apimart"
}

func upstreamRequestID(header http.Header) string {
	for _, name := range []string{"X-Request-ID", "Request-ID", "X-Apimart-Request-ID"} {
		if value := strings.TrimSpace(header.Get(name)); value != "" {
			return value
		}
	}
	return ""
}

// Only parse the allowlisted evidence fields; raw request/prompt/billing bodies
// are never included in the public error envelope.
func imageTaskDetailEvidence(body []byte, detail *taskapimart.DetailResponse, taskID, requestID, provider string) types.UpstreamImageTaskEvidence {
	type failureDetails struct {
		Reason       string `json:"reason"`
		UpstreamCode string `json:"upstream_code"`
	}
	var extra struct {
		RequestID string          `json:"request_id"`
		ErrorCode string          `json:"error_code"`
		Error     *failureDetails `json:"error"`
		Billing   struct {
			Status string `json:"status"`
		} `json:"billing"`
		Data *struct {
			RequestID string          `json:"request_id"`
			ErrorCode string          `json:"error_code"`
			Error     *failureDetails `json:"error"`
			Billing   struct {
				Status string `json:"status"`
			} `json:"billing"`
		} `json:"data"`
	}
	_ = common.Unmarshal(body, &extra)
	evidence := types.UpstreamImageTaskEvidence{Provider: provider, TaskID: taskID, RequestID: requestID, Status: "unknown", Accepted: taskID != ""}
	if detail != nil {
		if evidence.TaskID == "" {
			evidence.TaskID = detail.ID
			if detail.Data != nil {
				evidence.TaskID = detail.Data.ID
			}
			evidence.Accepted = evidence.TaskID != ""
		}
		if detail.Ready() {
			evidence.Status = detail.EffectiveStatus()
			evidence.Terminal = taskapimart.IsTerminal(evidence.Status)
		}
		if detail.Error != nil {
			evidence.ErrorCode = detail.Error.Code
		}
		if detail.Data != nil && detail.Data.Error != nil {
			evidence.ErrorCode = detail.Data.Error.Code
		}
	}
	if extra.RequestID != "" {
		evidence.RequestID = extra.RequestID
	}
	evidence.BillingStatus = extra.Billing.Status
	if evidence.ErrorCode == "" {
		evidence.ErrorCode = extra.ErrorCode
	}
	if extra.Error != nil {
		evidence.Reason = extra.Error.Reason
		evidence.UpstreamCode = extra.Error.UpstreamCode
	}
	if extra.Data != nil {
		if extra.Data.RequestID != "" {
			evidence.RequestID = extra.Data.RequestID
		}
		if extra.Data.Billing.Status != "" {
			evidence.BillingStatus = extra.Data.Billing.Status
		}
		if evidence.ErrorCode == "" {
			evidence.ErrorCode = extra.Data.ErrorCode
		}
		if extra.Data.Error != nil {
			evidence.Reason = extra.Data.Error.Reason
			evidence.UpstreamCode = extra.Data.Error.UpstreamCode
		}
	}
	return evidence
}

func imageTaskFailureHTTPStatus(evidence types.UpstreamImageTaskEvidence) int {
	// 422 also supports older consumers which only recognize HTTP rejection.
	// Never return it when the provider's charge/refund outcome is unknown.
	if evidence.Accepted && evidence.TaskID != "" && evidence.Terminal &&
		(evidence.Status == taskapimart.StatusFailed || evidence.Status == taskapimart.StatusCancelled) && evidence.BillingStatus == "refunded" {
		return http.StatusUnprocessableEntity
	}
	return http.StatusBadGateway
}
