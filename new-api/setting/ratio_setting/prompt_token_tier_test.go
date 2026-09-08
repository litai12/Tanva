package ratio_setting

import (
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestResolveDoubaoSeed20ModelRatioForOfficialPromptTokenTiers(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		model        string
		promptTokens int
		wantRatio    float64
	}{
		{name: "pro 32K inclusive", model: "doubao-seed-2-0-pro-260215", promptTokens: 32_000, wantRatio: 1},
		{name: "pro middle tier", model: "doubao-seed-2-0-pro-260215", promptTokens: 32_001, wantRatio: 1.5},
		{name: "pro 128K inclusive", model: "doubao-seed-2-0-pro-260215", promptTokens: 128_000, wantRatio: 1.5},
		{name: "pro upper tier", model: "doubao-seed-2-0-pro-260215", promptTokens: 128_001, wantRatio: 3},
		{name: "lite upper tier", model: "doubao-seed-2-0-lite-260428", promptTokens: 200_000, wantRatio: 3},
		{name: "mini middle tier", model: "doubao-seed-2-0-mini-260428", promptTokens: 64_000, wantRatio: 2},
		{name: "mini upper tier", model: "doubao-seed-2.0-mini", promptTokens: 200_000, wantRatio: 4},
		{name: "code follows lite middle tier", model: "doubao-seed-2-0-code-preview-260215", promptTokens: 64_000, wantRatio: 1.5},
		{name: "code follows lite upper tier", model: "doubao-seed-2.0-code", promptTokens: 200_000, wantRatio: 3},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			ratio, tiered := ResolveModelRatioForPromptTokens(test.model, 1, test.promptTokens)
			require.True(t, tiered)
			assert.InDelta(t, test.wantRatio, ratio, 1e-15)
		})
	}
}

func TestResolveModelRatioForPromptTokensLeavesUntieredModelsUnchanged(t *testing.T) {
	t.Parallel()

	ratio, tiered := ResolveModelRatioForPromptTokens("gpt-4.1", 0.5, 200_000)
	assert.False(t, tiered)
	assert.Equal(t, 0.5, ratio)
}
