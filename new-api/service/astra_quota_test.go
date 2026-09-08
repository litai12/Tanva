package service

import (
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAstraSettlementUsesActualContextInsteadOfEstimate(t *testing.T) {
	original := ratio_setting.CompletionRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(`{"gpt-6-astra":5}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(original)) })
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	// The estimate selected the short tier; actual usage crossed the threshold.
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-6-astra", RelayFormat: types.RelayFormatOpenAI, StartTime: time.Now(),
		PriceData: types.PriceData{BaseModelRatio: 3, ModelRatio: 3, CompletionRatio: 5, CacheRatio: 0.1, CacheCreationRatio: 1.25, GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1}},
	}
	summary := calculateTextQuotaSummary(ctx, info, &dto.Usage{PromptTokens: 272_001, CompletionTokens: 1_000})
	require.Equal(t, 6.0, summary.ModelRatio)
	require.Equal(t, 3.75, summary.CompletionRatio)
	require.Equal(t, 45.0, summary.ModelRatio*2*summary.CompletionRatio)
	require.InDelta(t, 1.2, summary.ModelRatio*2*summary.CacheRatio, 1e-9)
	require.Equal(t, 15.0, summary.ModelRatio*2*summary.CacheCreationRatio)
}
