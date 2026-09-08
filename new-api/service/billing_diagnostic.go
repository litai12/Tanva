package service

import (
	"fmt"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

// RecordUnsettledBilling preserves the delivered result and pre-consumption.
// Missing/invalid evidence must not become either a fabricated charge or refund.
func RecordUnsettledBilling(ctx *gin.Context, info *relaycommon.RelayInfo, err error) {
	content := fmt.Sprintf("billing_reconciliation_required: %s; pre_consumed_quota=%d; result_preserved=true", err, info.FinalPreConsumedQuota)
	logger.LogError(ctx, content)
	model.RecordErrorLog(ctx, info.UserId, info.ChannelId, info.OriginModelName,
		ctx.GetString("token_name"), content, info.TokenId, 0, info.IsStream, info.UsingGroup, nil)
}
