package openai

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"
)

// AggregateResponsesStream changes transport only. It never reserializes output
// through ResponsesOutput (which cannot represent encrypted reasoning, custom
// tools, namespaces, compaction, phase, image results or future protocol fields).
func AggregateResponsesStream(resp *http.Response) (*http.Response, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, aggregateError("invalid upstream response")
	}
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		return resp, nil
	}
	defer service.CloseResponseBodyGracefully(resp)
	var final map[string]json.RawMessage
	items := make(map[int]json.RawMessage)
	var terminalErr *types.NewAPIError
	var text strings.Builder
	consume := func(data string) error {
		if data == "[DONE]" {
			return nil
		}
		var event struct {
			Type     string          `json:"type"`
			Response json.RawMessage `json:"response"`
			Item     json.RawMessage `json:"item"`
			Index    *int            `json:"output_index"`
			Delta    string          `json:"delta"`
		}
		if err := common.UnmarshalJsonStr(data, &event); err != nil {
			return fmt.Errorf("invalid Responses SSE event: %w", err)
		}
		switch event.Type {
		case "response.output_item.done":
			if event.Index == nil || *event.Index < 0 || len(event.Item) == 0 || string(event.Item) == "null" {
				return fmt.Errorf("output_item.done requires output_index and item")
			}
			items[*event.Index] = event.Item
		case "response.output_text.delta":
			text.WriteString(event.Delta)
		case "response.completed", "response.incomplete":
			if err := common.Unmarshal(event.Response, &final); err != nil || final == nil {
				return fmt.Errorf("%s has no valid response object", event.Type)
			}
		case "error", "response.error", "response.failed", "response.cancelled", "response.canceled":
			var failure dto.ResponsesStreamResponse
			if err := common.UnmarshalJsonStr(data, &failure); err != nil {
				return err
			}
			terminalErr = newResponsesStreamTerminalError(failure)
		}
		return nil
	}
	if err := readResponsesSSE(resp.Body, consume); err != nil {
		return nil, aggregateError(err.Error())
	}
	if terminalErr != nil {
		return nil, terminalErr
	}
	if final == nil {
		return nil, aggregateError("responses stream ended without response.completed or response.incomplete")
	}
	var output []json.RawMessage
	if raw := final["output"]; len(raw) > 0 {
		if err := common.Unmarshal(raw, &output); err != nil {
			return nil, aggregateError("invalid terminal output array")
		}
	}
	// Merge only real completed items by protocol identity/index. A terminal
	// snapshot may omit items already emitted; retain those for the next turn.
	indices := make([]int, 0, len(items))
	for index := range items {
		indices = append(indices, index)
	}
	sort.Ints(indices)
	for _, index := range indices {
		item := items[index]
		id := responsesRawItemID(item)
		found := false
		for position, existing := range output {
			if (id != "" && responsesRawItemID(existing) == id) || bytes.Equal(existing, item) ||
				(id == "" && position == index && sameAnonymousItemType(existing, item)) {
				merged, err := mergeCompletedItem(existing, item)
				if err != nil {
					return nil, aggregateError(err.Error())
				}
				output[position] = merged
				found = true
				break
			}
		}
		if !found {
			position := min(index, len(output))
			output = append(output, nil)
			copy(output[position+1:], output[position:])
			output[position] = item
		}
	}
	// Preserve the existing text-only relay repair using actual streamed text.
	// Never invent reasoning, tools, IDs or completion evidence.
	if text.Len() > 0 && !rawOutputHasText(output) {
		message := struct {
			Type    string              `json:"type"`
			Role    string              `json:"role"`
			Content []map[string]string `json:"content"`
		}{"message", "assistant", []map[string]string{{"type": "output_text", "text": text.String()}}}
		raw, err := common.Marshal(message)
		if err != nil {
			return nil, aggregateError(err.Error())
		}
		output = append(output, raw)
	}
	if output == nil {
		output = []json.RawMessage{}
	}
	rawOutput, err := common.Marshal(output)
	if err != nil {
		return nil, aggregateError(err.Error())
	}
	final["output"] = rawOutput
	body, err := common.Marshal(final)
	if err != nil {
		return nil, aggregateError(err.Error())
	}
	result := *resp
	result.Header = resp.Header.Clone()
	result.Header.Set("Content-Type", "application/json")
	result.Header.Del("Content-Length")
	result.Header.Del("Content-Encoding")
	result.Header.Del("Transfer-Encoding")
	result.Body = io.NopCloser(bytes.NewReader(body))
	result.ContentLength = int64(len(body))
	return &result, nil
}

func aggregateError(message string) *types.NewAPIError {
	return types.NewOpenAIError(fmt.Errorf("%s", message), types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
}

func responsesRawItemID(raw json.RawMessage) string {
	var item struct {
		ID string `json:"id"`
	}
	if common.Unmarshal(raw, &item) != nil {
		return ""
	}
	return item.ID
}

func rawOutputHasText(output []json.RawMessage) bool {
	for _, raw := range output {
		var item struct {
			Type    string `json:"type"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		}
		if common.Unmarshal(raw, &item) != nil || item.Type != "message" {
			continue
		}
		for _, part := range item.Content {
			if part.Type == "output_text" && part.Text != "" {
				return true
			}
		}
	}
	return false
}

// SSE data may span multiple lines; comments/event/id fields are framing, not
// JSON. Malformed events and read failures must not become successful output.
func readResponsesSSE(reader io.Reader, consume func(string) error) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 32*1024*1024)
	var data []string
	flush := func() error {
		if len(data) == 0 {
			return nil
		}
		value := strings.Join(data, "\n")
		data = nil
		return consume(value)
	}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if err := flush(); err != nil {
				return err
			}
			continue
		}
		if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimPrefix(line[5:], " "))
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return flush()
}

func sameAnonymousItemType(left, right json.RawMessage) bool {
	var a, b struct {
		Type string `json:"type"`
		ID   string `json:"id"`
	}
	if common.Unmarshal(left, &a) != nil || common.Unmarshal(right, &b) != nil {
		return false
	}
	return a.ID == "" && b.ID == "" && a.Type != "" && a.Type == b.Type
}

func mergeCompletedItem(terminal, completed json.RawMessage) (json.RawMessage, error) {
	var current, earlier map[string]json.RawMessage
	if err := common.Unmarshal(terminal, &current); err != nil {
		return nil, err
	}
	if err := common.Unmarshal(completed, &earlier); err != nil {
		return nil, err
	}
	if current == nil || earlier == nil {
		return nil, fmt.Errorf("output item must be an object")
	}
	for key, value := range earlier {
		if _, present := current[key]; !present {
			current[key] = value
		}
	}
	return common.Marshal(current)
}
