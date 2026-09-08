package openai

import (
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"io"
	"strings"
	"testing"
)

func TestAggregateResponsesRetainsCompletedOpaqueItems(t *testing.T) {
	const body = "event: response.output_item.done\ndata: {\"type\":\"response.output_item.done\",\"output_index\":0,\n" +
		"data: \"item\":{\"type\":\"reasoning\",\"id\":\"rs\",\"encrypted_content\":\"cipher\",\"summary\":[]}}\n\n" +
		"data: {\"type\":\"response.output_item.done\",\"output_index\":1,\"item\":{\"type\":\"custom_tool_call\",\"id\":\"ct\",\"call_id\":\"call\",\"input\":\"actual input\"}}\n\n" +
		"data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp\",\"status\":\"completed\",\"output\":[],\"future\":{\"big\":9007199254740993}}}\n\n"
	response, err := AggregateResponsesStream(newResponsesStreamTestResponse(body))
	require.Nil(t, err)
	result, readErr := io.ReadAll(response.Body)
	require.NoError(t, readErr)
	require.NoError(t, response.Body.Close())
	require.Equal(t, "cipher", gjson.GetBytes(result, "output.0.encrypted_content").String())
	require.Equal(t, "actual input", gjson.GetBytes(result, "output.1.input").String())
	require.Equal(t, "9007199254740993", gjson.GetBytes(result, "future.big").Raw)
}

func TestAggregateResponsesRejectsMalformedOrUnfinishedStream(t *testing.T) {
	for _, body := range []string{
		"data: not-json\n\ndata: {\"type\":\"response.completed\",\"response\":{\"output\":[]}}\n\n",
		"data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n",
		"data: {\"type\":\"error\",\"error\":{\"type\":\"upstream_error\",\"message\":\"failure\"}}\n\n",
	} {
		response, err := AggregateResponsesStream(newResponsesStreamTestResponse(body))
		require.Nil(t, response)
		require.NotNil(t, err)
	}
}

func TestAggregateResponsesDoesNotDuplicateTerminalItems(t *testing.T) {
	const item = `{"type":"reasoning","id":"rs","encrypted_content":"cipher","summary":[]}`
	body := "data: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":" + item + "}\n\n" +
		"data: {\"type\":\"response.completed\",\"response\":{\"output\":[" + item + "]}}\n\n"
	response, err := AggregateResponsesStream(newResponsesStreamTestResponse(body))
	require.Nil(t, err)
	result, readErr := io.ReadAll(response.Body)
	require.NoError(t, readErr)
	require.NoError(t, response.Body.Close())
	require.Len(t, gjson.GetBytes(result, "output").Array(), 1)
	require.Equal(t, 1, strings.Count(string(result), "cipher"))
}

func TestResponsesAdaptorAggregatesSSEForJSONClient(t *testing.T) {
	ctx, recorder := newResponsesStreamTestContext(t)
	info := &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeResponses, IsStream: false}
	resp := newResponsesStreamTestResponse("data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_json\",\"output\":[],\"usage\":{\"input_tokens\":11,\"output_tokens\":7,\"total_tokens\":18},\"future\":true}}\n\n")
	usage, apiErr := (&Adaptor{}).DoResponse(ctx, resp, info)
	require.Nil(t, apiErr)
	require.Equal(t, 18, usage.(*dto.Usage).TotalTokens)
	require.Equal(t, "resp_json", gjson.Get(recorder.Body.String(), "id").String())
	require.True(t, gjson.Get(recorder.Body.String(), "future").Bool())
	require.Contains(t, recorder.Header().Get("Content-Type"), "application/json")
}
