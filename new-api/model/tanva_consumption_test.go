package model

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func tanvaModelSetup(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&TanvaConsumption{}, &TanvaConsumptionOutbox{}, &UserSubscription{}, &SubscriptionPlan{}))
	t.Cleanup(func() {
		DB.Exec("DELETE FROM tanva_consumption_outboxes")
		DB.Exec("DELETE FROM tanva_consumptions")
		DB.Exec("DELETE FROM user_subscriptions")
		DB.Exec("DELETE FROM subscription_plans")
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM tokens")
		DB.Exec("DELETE FROM channels")
	})
	require.NoError(t, DB.Create(&User{Id: 710, Username: "tanva_ledger", Quota: 100000}).Error)
	require.NoError(t, DB.Create(&Token{Id: 710, UserId: 710, Key: "ledger710", RemainQuota: 100000}).Error)
	require.NoError(t, DB.Create(&Channel{Id: 710, Name: "tanva_ledger"}).Error)
}

func claimTanvaTest(t *testing.T, id string) *TanvaConsumption {
	t.Helper()
	o, fresh, err := ClaimTanvaConsumption(&TanvaConsumption{UserID: 710, TokenID: 710, OrderID: id, OrderHash: "serverhash", BodyHash: "bodyhash", InstanceID: "test", RequestID: "request-" + id, Model: "deepseek-flash", QuotaPerUnit: "500000"})
	require.NoError(t, err)
	require.True(t, fresh)
	return o
}

func tanvaQuotas(t *testing.T) (User, Token) {
	t.Helper()
	var user User
	var token Token
	require.NoError(t, DB.First(&user, 710).Error)
	require.NoError(t, DB.First(&token, 710).Error)
	return user, token
}

func TestTanvaConsumptionPersistentAtomicSettlement(t *testing.T) {
	tanvaModelSetup(t)
	beforeBatch, beforeLog := common.BatchUpdateEnabled, common.LogConsumeEnabled
	common.BatchUpdateEnabled, common.LogConsumeEnabled = true, false
	t.Cleanup(func() { common.BatchUpdateEnabled, common.LogConsumeEnabled = beforeBatch, beforeLog })
	o := claimTanvaTest(t, "atomic")
	_, err := ReserveTanvaConsumption(o.ID, 10000, "wallet_only", "{}")
	require.NoError(t, err)
	require.NoError(t, DispatchTanvaConsumption(o.ID, 710))
	require.Error(t, DispatchTanvaConsumption(o.ID, 710))
	require.NoError(t, ReceiveTanvaConsumption(o.ID, 9656, "upstream_tokens", `{"prompt_tokens":18171,"completion_tokens":285}`))
	require.NoError(t, SettleTanvaConsumption(o.ID))
	require.NoError(t, SettleTanvaConsumption(o.ID))
	user, token := tanvaQuotas(t)
	require.Equal(t, 90344, user.Quota)
	require.Equal(t, 9656, user.UsedQuota)
	require.Equal(t, 1, user.RequestCount)
	require.Equal(t, 90344, token.RemainQuota)
	require.Equal(t, 9656, token.UsedQuota)
	final, err := GetTanvaConsumption(710, 710, "atomic")
	require.NoError(t, err)
	receipt := final.Receipt()
	require.Equal(t, "0.019312", receipt.CostCny)
	require.Equal(t, "9656", receipt.Quota)
	require.Equal(t, o.Receipt().EventID, receipt.EventID)
	require.Equal(t, 3, receipt.Revision)
	require.NoError(t, FailTanvaConsumption(o.ID, "late_error"))
	again, _ := GetTanvaConsumption(710, 710, "atomic")
	require.Equal(t, receipt, again.Receipt())
	var count int64
	require.NoError(t, DB.Model(&TanvaConsumptionOutbox{}).Where("consumption_id = ?", o.ID).Count(&count).Error)
	require.EqualValues(t, 3, count)
}

func TestTanvaConsumptionSettlementOutboxFailureRollsBackAllMoney(t *testing.T) {
	tanvaModelSetup(t)
	o := claimTanvaTest(t, "rollback")
	_, err := ReserveTanvaConsumption(o.ID, 100, "wallet_only", "{}")
	require.NoError(t, err)
	require.NoError(t, DispatchTanvaConsumption(o.ID, 710))
	require.NoError(t, ReceiveTanvaConsumption(o.ID, 150, "gateway_estimated_usage", "{}"))
	require.NoError(t, DB.Callback().Create().Before("gorm:create").Register("tanva_test_outbox_failure", func(tx *gorm.DB) {
		if tx.Statement.Table == "tanva_consumption_outboxes" {
			tx.AddError(errors.New("simulated durable outbox failure"))
		}
	}))
	t.Cleanup(func() { DB.Callback().Create().Remove("tanva_test_outbox_failure") })
	require.Error(t, SettleTanvaConsumption(o.ID))
	user, token := tanvaQuotas(t)
	require.Equal(t, 99900, user.Quota)
	require.Equal(t, 99900, token.RemainQuota)
	require.Equal(t, 0, user.UsedQuota)
	current, _ := GetTanvaConsumption(710, 710, "rollback")
	require.Equal(t, "received", current.Phase)
	require.Equal(t, "pending", current.Status)
	require.NoError(t, DB.Callback().Create().Remove("tanva_test_outbox_failure"))
	require.NoError(t, RecoverTanvaConsumptions(time.Now().Unix()))
	user, token = tanvaQuotas(t)
	require.Equal(t, 99850, user.Quota)
	require.Equal(t, 99850, token.RemainQuota)
	require.Equal(t, 150, user.UsedQuota)
}

func TestTanvaConsumptionDedupAndOwnership(t *testing.T) {
	tanvaModelSetup(t)
	o := claimTanvaTest(t, "dedup")
	duplicate := *o
	duplicate.ID = 0
	duplicate.RequestID = "retry-request"
	same, fresh, err := ClaimTanvaConsumption(&duplicate)
	require.NoError(t, err)
	require.False(t, fresh)
	require.Equal(t, o.RequestID, same.RequestID)
	duplicate.BodyHash = "mutated"
	_, _, err = ClaimTanvaConsumption(&duplicate)
	require.Error(t, err)
	_, err = GetTanvaConsumption(711, 710, "dedup")
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	_, err = GetTanvaConsumption(710, 711, "dedup")
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	// Concurrent HTTP submissions share one claim and never get two dispatches.
	var wg sync.WaitGroup
	var mu sync.Mutex
	successes := 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, fresh, err := ClaimTanvaConsumption(&TanvaConsumption{UserID: 710, TokenID: 710, OrderID: "parallel", OrderHash: "same", BodyHash: "same", InstanceID: "test", RequestID: fmt.Sprintf("parallel-%d", i), Model: "deepseek-flash", QuotaPerUnit: "500000"})
			if err == nil && fresh {
				mu.Lock()
				successes++
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()
	require.Equal(t, 1, successes)
}

func TestTanvaConsumptionRecoveryUnknownThenEvidence(t *testing.T) {
	tanvaModelSetup(t)
	reserved := claimTanvaTest(t, "safe_refund")
	_, err := ReserveTanvaConsumption(reserved.ID, 100, "wallet_only", "{}")
	require.NoError(t, err)
	dispatched := claimTanvaTest(t, "unknown")
	_, err = ReserveTanvaConsumption(dispatched.ID, 200, "wallet_only", "{}")
	require.NoError(t, err)
	require.NoError(t, DispatchTanvaConsumption(dispatched.ID, 710))
	require.NoError(t, DB.Model(&TanvaConsumption{}).Where("id IN ?", []int64{reserved.ID, dispatched.ID}).Update("lease_until", 1).Error)
	require.NoError(t, RecoverTanvaConsumptions(time.Now().Unix()))
	require.NoError(t, RecoverTanvaConsumptions(time.Now().Unix()))
	user, token := tanvaQuotas(t)
	require.Equal(t, 99800, user.Quota)
	require.Equal(t, 99800, token.RemainQuota)
	r, _ := GetTanvaConsumption(710, 710, "safe_refund")
	require.Equal(t, "rejected", r.Status)
	require.Equal(t, "0", r.Receipt().CostCny)
	require.Equal(t, "0", r.Receipt().Quota)
	u, _ := GetTanvaConsumption(710, 710, "unknown")
	require.Equal(t, "reconciliation_required", u.Status)
	require.Empty(t, u.Receipt().CostCny)
	unknownReceipt := u.Receipt()
	require.NoError(t, ReceiveTanvaConsumption(u.ID, 250, "gateway_fixed_price", ""))
	require.NoError(t, SettleTanvaConsumption(u.ID))
	u, _ = GetTanvaConsumption(710, 710, "unknown")
	require.Equal(t, "consumed", u.Status)
	require.Equal(t, unknownReceipt.EventID, u.Receipt().EventID)
	require.Greater(t, u.Revision, unknownReceipt.Revision)
	user, token = tanvaQuotas(t)
	require.Equal(t, 99750, user.Quota)
	require.Equal(t, 99750, token.RemainQuota)
	require.Error(t, ReceiveTanvaConsumption(u.ID, 999, "gateway_fixed_price", ""))
	require.NoError(t, SettleTanvaConsumption(u.ID))
}

func TestTanvaOutboxLeaseFailureRestartAndAcknowledgement(t *testing.T) {
	tanvaModelSetup(t)
	o := claimTanvaTest(t, "outbox")
	first, err := LeaseTanvaOutbox(time.Now().Unix())
	require.NoError(t, err)
	require.NotNil(t, first)
	other, err := LeaseTanvaOutbox(time.Now().Unix())
	require.NoError(t, err)
	require.Nil(t, other)
	require.NoError(t, FinishTanvaOutbox(first, false, time.Now().Unix()))
	retry, err := LeaseTanvaOutbox(time.Now().Unix() + 10)
	require.NoError(t, err)
	require.NotNil(t, retry)
	require.Equal(t, first.Payload, retry.Payload)
	require.Equal(t, first.EventID, retry.EventID)
	// Losing a worker lease after process exit leaves the same event recoverable.
	restarted, err := LeaseTanvaOutbox(time.Now().Unix() + 50)
	require.NoError(t, err)
	require.NotNil(t, restarted)
	require.Equal(t, o.Receipt().EventID, restarted.EventID)
	require.Error(t, FinishTanvaOutbox(retry, true, time.Now().Unix()+50))
	require.NoError(t, FinishTanvaOutbox(restarted, true, time.Now().Unix()+50))
	last, err := LeaseTanvaOutbox(time.Now().Unix() + 100)
	require.NoError(t, err)
	require.Nil(t, last)
}

func TestTanvaConsumptionSubscriptionTransaction(t *testing.T) {
	tanvaModelSetup(t)
	plan := SubscriptionPlan{Id: 710, Title: "tanva_test", QuotaResetPeriod: SubscriptionResetNever}
	require.NoError(t, DB.Create(&plan).Error)
	sub := UserSubscription{Id: 710, UserId: 710, PlanId: 710, Status: "active", EndTime: time.Now().Unix() + 3600, AmountTotal: 1000}
	require.NoError(t, DB.Create(&sub).Error)
	o := claimTanvaTest(t, "subscription")
	_, err := ReserveTanvaConsumption(o.ID, 100, "subscription_only", "{}")
	require.NoError(t, err)
	require.NoError(t, DispatchTanvaConsumption(o.ID, 710))
	require.NoError(t, ReceiveTanvaConsumption(o.ID, 150, "upstream_tokens", "{}"))
	require.NoError(t, SettleTanvaConsumption(o.ID))
	require.NoError(t, DB.First(&sub, 710).Error)
	require.EqualValues(t, 150, sub.AmountUsed)
	user, token := tanvaQuotas(t)
	require.Equal(t, 100000, user.Quota)
	require.Equal(t, 99850, token.RemainQuota)
}
