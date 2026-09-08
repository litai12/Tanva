package openaicompat

import (
	"encoding/json"
	"fmt"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

func encodeResponsesTool(tool dto.ToolCallRequest) (json.RawMessage, error) {
	if tool.Type != "function" {
		return common.Marshal(tool)
	}
	encoded, err := common.Marshal(tool.Function)
	if err != nil {
		return nil, err
	}
	var fields map[string]json.RawMessage
	if err := common.Unmarshal(encoded, &fields); err != nil {
		return nil, err
	}
	fields["type"] = json.RawMessage(`"function"`)
	return common.Marshal(fields)
}

// Translate explicit controls without choosing a reasoning depth or service
// tier on the caller's behalf. This contract is shared by every Responses bridge.
func preserveChatResponsesControls(req *dto.GeneralOpenAIRequest, out *dto.OpenAIResponsesRequest) error {
	if len(req.ServiceTier) > 0 {
		if err := common.Unmarshal(req.ServiceTier, &out.ServiceTier); err != nil {
			return fmt.Errorf("service_tier must be a string: %w", err)
		}
	}
	if req.PromptCacheKey != "" {
		raw, err := common.Marshal(req.PromptCacheKey)
		if err != nil {
			return err
		}
		out.PromptCacheKey = raw
	}
	out.PromptCacheRetention = req.PromptCacheRetention
	if len(req.Reasoning) > 0 {
		if err := common.Unmarshal(req.Reasoning, &out.Reasoning); err != nil {
			return fmt.Errorf("invalid reasoning: %w", err)
		}
	}
	if req.ReasoningEffort != "" {
		if out.Reasoning == nil {
			out.Reasoning = &dto.Reasoning{}
		}
		if out.Reasoning.Effort != "" && out.Reasoning.Effort != req.ReasoningEffort {
			return fmt.Errorf("reasoning.effort and reasoning_effort disagree")
		}
		out.Reasoning.Effort = req.ReasoningEffort
	}
	if len(req.Verbosity) > 0 {
		text := make(map[string]json.RawMessage)
		if len(out.Text) > 0 {
			if err := common.Unmarshal(out.Text, &text); err != nil {
				return err
			}
		}
		text["verbosity"] = req.Verbosity
		raw, err := common.Marshal(text)
		if err != nil {
			return err
		}
		out.Text = raw
	}
	return nil
}
