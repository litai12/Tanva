package relay

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

func AudioHelper(c *gin.Context, info *relaycommon.RelayInfo) (NewAPIError *types.NewAPIError) {
	info.InitChannelMeta(c)
	// 记录「请求链路」原始请求（后台日志详情可查；audio 路径此前缺失导致弹窗拉不出）
	upsertOriginalRequestTrace(c, info)

	audioReq, ok := info.Request.(*dto.AudioRequest)
	if !ok {
		return types.NewError(errors.New("invalid request type"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}

	request, err := common.DeepCopy(audioReq)
	if err != nil {
		return types.NewError(fmt.Errorf("failed to copy request to AudioRequest: %w", err), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}

	err = helper.ModelMappedHelper(c, info, request)
	if err != nil {
		return types.NewError(err, types.ErrorCodeChannelModelMappedError, types.ErrOptionWithSkipRetry())
	}

	adaptor := GetAdaptor(info.ApiType)
	if adaptor == nil {
		return types.NewError(fmt.Errorf("invalid api type: %d", info.ApiType), types.ErrorCodeInvalidApiType, types.ErrOptionWithSkipRetry())
	}
	adaptor.Init(info)

	ioReader, err := adaptor.ConvertAudioRequest(c, info, *request)
	if err != nil {
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
			ErrorMessage: err.Error(),
		})
		return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}

	// 缓冲上游请求体用于「请求链路」trace（不影响后续读取）。
	// seed-audio 等 HTTP 路径可借此看到实际发往上游的 body（含 speaker/text_prompt）。
	var upstreamReqBody string
	if ioReader != nil {
		if upstreamReqBytes, readErr := io.ReadAll(ioReader); readErr == nil {
			upstreamReqBody = string(upstreamReqBytes)
			ioReader = bytes.NewReader(upstreamReqBytes)
		}
	}
	upstreamURL, _ := adaptor.GetRequestURL(info)
	upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
		UpstreamURL:         upstreamURL,
		UpstreamRequestBody: upstreamReqBody,
	})

	resp, err := adaptor.DoRequest(c, info, ioReader)
	if err != nil {
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
			UpstreamURL:         upstreamURL,
			UpstreamRequestBody: upstreamReqBody,
			ErrorMessage:        err.Error(),
		})
		return types.NewError(err, types.ErrorCodeDoRequestFailed)
	}
	statusCodeMappingStr := c.GetString("status_code_mapping")

	var httpResp *http.Response
	var responseRecorder *responseTraceRecorder
	if resp != nil {
		httpResp = resp.(*http.Response)
		// tee 上游响应体到「请求链路」记录（base64 由 model 层 truncateTraceBase64 截断）
		httpResp, responseRecorder = attachResponseTraceRecorder(httpResp)
		if httpResp.StatusCode != http.StatusOK {
			NewAPIError = service.RelayErrorHandler(c.Request.Context(), httpResp, false)
			respBody := ""
			if responseRecorder != nil {
				respBody = string(responseRecorder.data)
			}
			upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
				UpstreamURL:          upstreamURL,
				UpstreamRequestBody:  upstreamReqBody,
				UpstreamResponseBody: respBody,
				ErrorMessage:         NewAPIError.Error(),
			})
			// reset status code 重置状态码
			service.ResetStatusCode(NewAPIError, statusCodeMappingStr)
			return NewAPIError
		}
	}

	usage, NewAPIError := adaptor.DoResponse(c, httpResp, info)
	if NewAPIError != nil {
		respBody := ""
		if responseRecorder != nil {
			respBody = string(responseRecorder.data)
		}
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
			UpstreamURL:          upstreamURL,
			UpstreamRequestBody:  upstreamReqBody,
			UpstreamResponseBody: respBody,
			ErrorMessage:         NewAPIError.Error(),
		})
		// reset status code 重置状态码
		service.ResetStatusCode(NewAPIError, statusCodeMappingStr)
		return NewAPIError
	}
	// 成功：记录上游响应体（seed-audio 为含 code/duration/url 的 JSON，base64 已截断）
	if responseRecorder != nil {
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
			UpstreamURL:          upstreamURL,
			UpstreamRequestBody:  upstreamReqBody,
			UpstreamResponseBody: string(responseRecorder.data),
		})
	}
	if usage.(*dto.Usage).CompletionTokenDetails.AudioTokens > 0 || usage.(*dto.Usage).PromptTokensDetails.AudioTokens > 0 {
		service.PostAudioConsumeQuota(c, info, usage.(*dto.Usage), "")
	} else {
		service.PostTextConsumeQuota(c, info, usage.(*dto.Usage), nil)
	}

	return nil
}
