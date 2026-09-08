package service

import (
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"testing"
	"time"
)

func TestBillingOverflowDoesNotProduceWrappedCharge(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{
		StartTime:   time.Now(),
		ChannelMeta: &relaycommon.ChannelMeta{},
		PriceData:   types.PriceData{UsePrice: true, ModelPrice: 0.5, GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1}, OtherRatios: map[string]float64{"n": 9223372036854775808.0}},
	}
	usage := &dto.Usage{PromptTokens: 1, TotalTokens: 1}
	summary := calculateTextQuotaSummary(ctx, info, usage)
	if summary.BillingError == nil || summary.Quota != 0 {
		t.Fatalf("overflow accepted: %+v", summary)
	}
	info.PriceData.OtherRatios["n"] = 1
	summary = calculateTextQuotaSummary(ctx, info, usage)
	if summary.BillingError != nil || summary.Quota != 250000 {
		t.Fatalf("single image: %+v", summary)
	}
	if err := SettleBilling(ctx, nil, -1); err == nil {
		t.Fatal("negative settlement accepted")
	}
	if _, err := NewBillingSession(ctx, info, -1); err == nil {
		t.Fatal("negative pre-charge accepted")
	}
}
