package deepseek

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
)

func TestOfficialResponsesRoutesAndPassesThrough(t *testing.T) {
	adaptor := Adaptor{}
	for _, test := range []struct {
		name string
		mode int
		want string
	}{
		{name: "responses", mode: relayconstant.RelayModeResponses, want: "https://api.deepseek.com/v1/responses"},
		{name: "compact", mode: relayconstant.RelayModeResponsesCompact, want: "https://api.deepseek.com/v1/responses/compact"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := adaptor.GetRequestURL(&relaycommon.RelayInfo{
				RelayMode: test.mode,
				ChannelMeta: &relaycommon.ChannelMeta{
					ChannelBaseUrl: "https://api.deepseek.com",
				},
			})
			if err != nil {
				t.Fatalf("GetRequestURL() error = %v", err)
			}
			if got != test.want {
				t.Fatalf("GetRequestURL() = %q, want %q", got, test.want)
			}
		})
	}

	request := dto.OpenAIResponsesRequest{Model: "deepseek-flash"}
	converted, err := adaptor.ConvertOpenAIResponsesRequest(nil, nil, request)
	if err != nil {
		t.Fatalf("ConvertOpenAIResponsesRequest() error = %v", err)
	}
	got, ok := converted.(dto.OpenAIResponsesRequest)
	if !ok {
		t.Fatalf("converted request type = %T, want dto.OpenAIResponsesRequest", converted)
	}
	if got.Model != request.Model {
		t.Fatalf("converted model = %q, want %q", got.Model, request.Model)
	}
}
