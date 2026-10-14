package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/require"
)

func TestRelayErrorHandlerPreservesProviderErrorCodes(t *testing.T) {
	t.Parallel()
	cases := []struct{ name, body, code string }{
		{"nested", `{"error":{"code":"generation_failed","message":"image generation failed"}}`, "generation_failed"},
		{"flat", `{"code":"invalid_request","message":"Input image dimensions exceed the supported limit"}`, "invalid_request"},
		{"flat alternative", `{"error_code":"fail_to_fetch_task","msg":"Unable to fetch task"}`, "fail_to_fetch_task"},
		{"numeric envelope remains compatible", `{"code":400,"message":"invalid input"}`, "bad_response_status_code"},
		{"no provider code remains compatible", `{"message":"invalid input"}`, "bad_response_status_code"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := &http.Response{StatusCode: 400, Body: io.NopCloser(strings.NewReader(tc.body))}
			err := RelayErrorHandler(context.Background(), resp, false)
			require.Equal(t, types.ErrorCode(tc.code), err.GetErrorCode())
			require.Equal(t, 400, err.StatusCode)
			require.Nil(t, err.ToOpenAIError().UpstreamImageTask)
		})
	}
}

func TestRelayErrorHandlerPreservesImageTaskEvidence(t *testing.T) {
	t.Parallel()
	resp := &http.Response{StatusCode: 422, Body: io.NopCloser(strings.NewReader(`{"error":{"code":"generation_failed","message":"content policy rejection","upstream_image_task":{"provider":"toapis","task_id":"task-123","request_id":"provider-request","status":"failed","accepted":true,"terminal":true,"billing_status":"refunded","error_code":"generation_failed"}}}`))}
	err := RelayErrorHandler(context.Background(), resp, false)
	require.Equal(t, types.ErrorCode("generation_failed"), err.GetErrorCode())
	require.NotNil(t, err.ToOpenAIError().UpstreamImageTask)
	require.Equal(t, "task-123", err.ToOpenAIError().UpstreamImageTask.TaskID)
	require.Equal(t, "content policy rejection", err.Error())
}

func TestResetStatusCode(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name             string
		statusCode       int
		statusCodeConfig string
		expectedCode     int
	}{
		{
			name:             "map string value",
			statusCode:       429,
			statusCodeConfig: `{"429":"503"}`,
			expectedCode:     503,
		},
		{
			name:             "map int value",
			statusCode:       429,
			statusCodeConfig: `{"429":503}`,
			expectedCode:     503,
		},
		{
			name:             "skip invalid string value",
			statusCode:       429,
			statusCodeConfig: `{"429":"bad-code"}`,
			expectedCode:     429,
		},
		{
			name:             "skip status code 200",
			statusCode:       200,
			statusCodeConfig: `{"200":503}`,
			expectedCode:     200,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			NewAPIError := &types.NewAPIError{
				StatusCode: tc.statusCode,
			}
			ResetStatusCode(NewAPIError, tc.statusCodeConfig)
			require.Equal(t, tc.expectedCode, NewAPIError.StatusCode)
		})
	}
}
