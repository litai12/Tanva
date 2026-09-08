package openaicompat

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"testing"
)

func TestChatBridgeRetainsExplicitReasoningCacheTierAndVerbosity(t *testing.T) {
	var request dto.GeneralOpenAIRequest
	require.NoError(t, common.UnmarshalJsonStr(`{"model":"m","messages":[{"role":"system","content":"Writing assistant"},{"role":"user","content":"Continue"}],"reasoning_effort":"high","reasoning":{"context":"all_turns"},"service_tier":"priority","prompt_cache_key":"thread","verbosity":"high","parallel_tool_calls":false}`, &request))
	result, err := ChatCompletionsRequestToResponsesRequest(&request)
	require.NoError(t, err)
	body, err := common.Marshal(result)
	require.NoError(t, err)
	for path, want := range map[string]string{"reasoning.effort": "high", "reasoning.context": "all_turns", "service_tier": "priority", "prompt_cache_key": "thread", "text.verbosity": "high"} {
		require.Equal(t, want, gjson.GetBytes(body, path).String(), path)
	}
	require.False(t, gjson.GetBytes(body, "reasoning.summary").Exists())
	require.Equal(t, "false", gjson.GetBytes(body, "parallel_tool_calls").Raw)
}

func TestChatBridgeKeepsTextAndToolCallTogether(t *testing.T) {
	var response dto.OpenAIResponsesResponse
	require.NoError(t, common.UnmarshalJsonStr(`{"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"I will inspect the file."}]},{"type":"function_call","call_id":"call_1","name":"read_file","arguments":"{\"path\":\"a.txt\"}"}]}`, &response))
	result, _, err := ResponsesResponseToChatCompletionsResponse(&response, "chat_test")
	require.NoError(t, err)
	body, err := common.Marshal(result)
	require.NoError(t, err)
	require.Equal(t, "I will inspect the file.", gjson.GetBytes(body, "choices.0.message.content").String())
	require.Equal(t, "call_1", gjson.GetBytes(body, "choices.0.message.tool_calls.0.id").String())
	require.Equal(t, "tool_calls", gjson.GetBytes(body, "choices.0.finish_reason").String())
}

func TestChatBridgeRejectsUnidentifiedToolResult(t *testing.T) {
	var request dto.GeneralOpenAIRequest
	require.NoError(t, common.UnmarshalJsonStr(`{"model":"m","messages":[{"role":"tool","content":"result"}]}`, &request))
	_, err := ChatCompletionsRequestToResponsesRequest(&request)
	require.ErrorContains(t, err, "tool_call_id")
}

func TestChatBridgePreservesExplicitToolStrictness(t *testing.T) {
	for _, strict := range []string{"true", "false"} {
		var request dto.GeneralOpenAIRequest
		require.NoError(t, common.UnmarshalJsonStr(`{"model":"m","messages":[{"role":"user","content":"test"}],"tools":[{"type":"function","function":{"name":"read_file","strict":`+strict+`,"parameters":{"type":"object","properties":{}}}}]}`, &request))
		result, err := ChatCompletionsRequestToResponsesRequest(&request)
		require.NoError(t, err)
		require.Equal(t, strict, gjson.GetBytes(result.Tools, "0.strict").Raw)
	}
}
