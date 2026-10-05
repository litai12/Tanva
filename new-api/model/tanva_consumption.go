package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// TanvaConsumption is the financial source of truth. It deliberately lives in
// DB (not LOG_DB) and bypasses the lossy in-memory batch quota updater.
type TanvaConsumption struct {
	ID             int64  `gorm:"primaryKey"`
	UserID         int    `gorm:"uniqueIndex:idx_tanva_order,priority:1"`
	TokenID        int    `gorm:"uniqueIndex:idx_tanva_order,priority:2"`
	OrderID        string `gorm:"type:varchar(128);uniqueIndex:idx_tanva_order,priority:3"`
	OrderHash      string `gorm:"type:varchar(128)"`
	BodyHash       string `gorm:"type:varchar(64)"`
	InstanceID     string `gorm:"type:varchar(128)"`
	RequestID      string `gorm:"type:varchar(64);uniqueIndex"`
	Model          string `gorm:"type:varchar(128)"`
	Status         string `gorm:"type:varchar(32);index"`
	Phase          string `gorm:"type:varchar(32);index"`
	Revision       int
	StartedAt      int64
	SettledAt      int64
	LeaseUntil     int64 `gorm:"index"`
	PreQuota       int64
	ActualQuota    int64
	QuotaPerUnit   string `gorm:"type:varchar(64)"`
	Funding        string `gorm:"type:varchar(32)"`
	SubscriptionID int
	ChannelID      int
	UsageEvidence  string `gorm:"type:varchar(32)"`
	UsageJSON      string `gorm:"type:text"`
	PriceJSON      string `gorm:"type:text"`
	ErrorCode      string `gorm:"type:varchar(64)"`
}

type TanvaConsumptionOutbox struct {
	ID            int64  `gorm:"primaryKey"`
	ConsumptionID int64  `gorm:"index"`
	EventID       string `gorm:"type:varchar(64);uniqueIndex:idx_tanva_outbox_event,priority:1"`
	Revision      int    `gorm:"uniqueIndex:idx_tanva_outbox_event,priority:2"`
	Payload       string `gorm:"type:text"`
	Attempts      int
	NextAttemptAt int64 `gorm:"index"`
	LeaseUntil    int64 `gorm:"index"`
	DeliveredAt   int64
}

type TanvaConsumptionReceipt struct {
	Version           int         `json:"version"`
	EventID           string      `json:"eventId"`
	Revision          int         `json:"revision"`
	OrderID           string      `json:"orderId"`
	OrderHash         string      `json:"orderHash"`
	GatewayInstanceID string      `json:"gatewayInstanceId"`
	GatewayRequestID  string      `json:"gatewayRequestId"`
	Model             string      `json:"model"`
	Status            string      `json:"status"`
	PriceCurrency     string      `json:"priceCurrency"`
	CostCny           string      `json:"costCny,omitempty"`
	Quota             string      `json:"quota,omitempty"`
	QuotaPerUnit      string      `json:"quotaPerUnit"`
	StartedAt         string      `json:"startedAt"`
	SettledAt         string      `json:"settledAt,omitempty"`
	UsageEvidence     string      `json:"usageEvidence"`
	Usage             interface{} `json:"usage,omitempty"`
	ErrorCode         string      `json:"errorCode,omitempty"`
}

func (o *TanvaConsumption) Receipt() TanvaConsumptionReceipt {
	hash := sha256.Sum256([]byte(o.InstanceID + "\n" + o.RequestID))
	r := TanvaConsumptionReceipt{Version: 1, EventID: hex.EncodeToString(hash[:]), Revision: o.Revision,
		OrderID: o.OrderID, OrderHash: o.OrderHash, GatewayInstanceID: o.InstanceID, GatewayRequestID: o.RequestID,
		Model: o.Model, Status: o.Status, PriceCurrency: "CNY", QuotaPerUnit: o.QuotaPerUnit,
		StartedAt: time.Unix(o.StartedAt, 0).UTC().Format(time.RFC3339), UsageEvidence: o.UsageEvidence, ErrorCode: o.ErrorCode}
	if o.Status == "consumed" {
		r.Quota = strconv.FormatInt(o.ActualQuota, 10)
		unit, err := decimal.NewFromString(o.QuotaPerUnit)
		if err == nil && unit.IsPositive() {
			r.CostCny = decimal.NewFromInt(o.ActualQuota).Div(unit).String()
		}
	}
	if o.Status == "rejected" {
		r.Quota, r.CostCny = "0", "0"
	}
	if o.SettledAt > 0 {
		r.SettledAt = time.Unix(o.SettledAt, 0).UTC().Format(time.RFC3339)
	}
	if o.UsageJSON != "" && o.UsageEvidence == "upstream_tokens" {
		var usage interface{}
		if common.UnmarshalJsonStr(o.UsageJSON, &usage) == nil {
			r.Usage = usage
		}
	}
	return r
}

func tanvaEnqueueTx(tx *gorm.DB, o *TanvaConsumption) error {
	r := o.Receipt()
	data, err := common.Marshal(r)
	if err != nil {
		return err
	}
	return tx.Create(&TanvaConsumptionOutbox{ConsumptionID: o.ID, EventID: r.EventID, Revision: r.Revision, Payload: string(data), NextAttemptAt: common.GetTimestamp()}).Error
}

func ClaimTanvaConsumption(o *TanvaConsumption) (*TanvaConsumption, bool, error) {
	now := common.GetTimestamp()
	o.Status, o.Phase, o.Revision, o.StartedAt, o.LeaseUntil, o.UsageEvidence = "pending", "accepted", 1, now, now+180, "unknown"
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(o).Error; err != nil {
			return err
		}
		return tanvaEnqueueTx(tx, o)
	})
	if err == nil {
		return o, true, nil
	}
	existing, findErr := GetTanvaConsumption(o.UserID, o.TokenID, o.OrderID)
	if findErr != nil {
		return nil, false, err
	}
	if existing.OrderHash != o.OrderHash || existing.BodyHash != o.BodyHash || existing.Model != o.Model {
		return nil, false, errors.New("tanva_order_identity_conflict")
	}
	return existing, false, nil
}

func GetTanvaConsumption(userID, tokenID int, orderID string) (*TanvaConsumption, error) {
	var o TanvaConsumption
	err := DB.Where("user_id = ? AND token_id = ? AND order_id = ?", userID, tokenID, orderID).First(&o).Error
	return &o, err
}

func tanvaLockTx(tx *gorm.DB, id int64) (*TanvaConsumption, error) {
	var o TanvaConsumption
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&o, id).Error
	return &o, err
}

// The order CAS protects SQLite as well as row-locking databases. All monetary
// writes roll back together when any condition or receipt/outbox insert fails.
func tanvaSaveTx(tx *gorm.DB, o *TanvaConsumption, revision int) error {
	q := tx.Model(&TanvaConsumption{}).Where("id = ? AND revision = ?", o.ID, revision).Select("*").Updates(o)
	if q.Error != nil {
		return q.Error
	}
	if q.RowsAffected != 1 {
		return errors.New("tanva_order_concurrent_change")
	}
	return nil
}

func ReserveTanvaConsumption(id int64, quota int64, preference, priceJSON string) (*TanvaConsumption, error) {
	if quota < 0 {
		return nil, errors.New("negative quota")
	}
	var result *TanvaConsumption
	dbNow := GetDBTimestamp()
	err := DB.Transaction(func(tx *gorm.DB) error {
		o, err := tanvaLockTx(tx, id)
		if err != nil {
			return err
		}
		result = o
		if o.Phase != "accepted" || o.Status != "pending" {
			return errors.New("tanva_order_not_accepted")
		}
		var user User
		var token Token
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, o.UserID).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", o.TokenID, o.UserID).First(&token).Error; err != nil {
			return err
		}
		if !token.UnlimitedQuota && int64(token.RemainQuota) < quota {
			return errors.New("insufficient_token_quota")
		}
		pref := common.NormalizeBillingPreference(preference)
		wallet := func() bool {
			if int64(user.Quota) < quota || (quota > 0 && user.Quota <= 0) {
				return false
			}
			o.Funding = "wallet"
			return true
		}
		subscription := func() (bool, error) {
			var subs []UserSubscription
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND status = ? AND end_time > ?", o.UserID, "active", dbNow).Order("end_time asc, id asc").Find(&subs).Error; err != nil {
				return false, err
			}
			for _, sub := range subs {
				plan, err := getSubscriptionPlanByIdTx(tx, sub.PlanId)
				if err != nil {
					return false, err
				}
				if err := maybeResetUserSubscriptionWithPlanTx(tx, &sub, plan, dbNow); err != nil {
					return false, err
				}
				if sub.AmountTotal > 0 && sub.AmountTotal-sub.AmountUsed < quota {
					continue
				}
				o.Funding, o.SubscriptionID = "subscription", sub.Id
				return true, nil
			}
			return false, nil
		}
		var funded bool
		if pref == "wallet_only" {
			funded = wallet()
		} else if pref == "wallet_first" && wallet() {
			funded = true
		} else {
			funded, err = subscription()
			if err != nil {
				return err
			}
			if !funded && pref != "subscription_only" {
				funded = wallet()
			}
		}
		if !funded {
			return errors.New("insufficient_funding_quota")
		}
		if quota > 0 {
			if err := tanvaFundingDeltaTx(tx, o, quota); err != nil {
				return err
			}
			if err := tanvaTokenDeltaTx(tx, o, quota); err != nil {
				return err
			}
		}
		rev := o.Revision
		o.PreQuota, o.PriceJSON, o.Phase, o.LeaseUntil = quota, priceJSON, "reserved", common.GetTimestamp()+180
		o.Revision++
		if err := tanvaSaveTx(tx, o, rev); err != nil {
			return err
		}
		return tanvaEnqueueTx(tx, o)
	})
	if err == nil {
		invalidateTanvaCaches(result)
	}
	return result, err
}

func tanvaFundingDeltaTx(tx *gorm.DB, o *TanvaConsumption, delta int64) error {
	if delta == 0 {
		return nil
	}
	var q *gorm.DB
	if o.Funding == "subscription" {
		q = tx.Model(&UserSubscription{}).Where("id = ? AND user_id = ?", o.SubscriptionID, o.UserID).Update("amount_used", gorm.Expr("amount_used + ?", delta))
	} else {
		q = tx.Model(&User{}).Where("id = ?", o.UserID).Update("quota", gorm.Expr("quota - ?", delta))
	}
	if q.Error != nil {
		return q.Error
	}
	if q.RowsAffected != 1 {
		return errors.New("funding_account_missing")
	}
	return nil
}
func tanvaTokenDeltaTx(tx *gorm.DB, o *TanvaConsumption, delta int64) error {
	if delta == 0 {
		return nil
	}
	q := tx.Model(&Token{}).Where("id = ? AND user_id = ?", o.TokenID, o.UserID).Updates(map[string]interface{}{
		"remain_quota": gorm.Expr("remain_quota - ?", delta), "used_quota": gorm.Expr("used_quota + ?", delta), "accessed_time": common.GetTimestamp()})
	if q.Error != nil {
		return q.Error
	}
	if q.RowsAffected != 1 {
		return errors.New("token_account_missing")
	}
	return nil
}
func invalidateTanvaCaches(o *TanvaConsumption) {
	if o == nil || !common.RedisEnabled {
		return
	}
	if err := InvalidateUserCache(o.UserID); err != nil {
		common.SysLog("tanva user cache invalidation failed")
	}
	var token Token
	if DB.First(&token, o.TokenID).Error == nil {
		if err := cacheDeleteToken(token.Key); err != nil {
			common.SysLog("tanva token cache invalidation failed")
		}
	}
}

func DispatchTanvaConsumption(id int64, channelID int) error {
	q := DB.Model(&TanvaConsumption{}).Where("id = ? AND phase = ? AND status = ?", id, "reserved", "pending").Updates(map[string]interface{}{"phase": "dispatching", "channel_id": channelID, "lease_until": common.GetTimestamp() + 180})
	if q.Error != nil {
		return q.Error
	}
	if q.RowsAffected != 1 {
		return errors.New("tanva_supplier_dispatch_already_started")
	}
	return nil
}
func HeartbeatTanvaConsumption(id int64) {
	DB.Model(&TanvaConsumption{}).Where("id = ? AND phase IN ?", id, []string{"accepted", "reserved", "dispatching"}).Update("lease_until", common.GetTimestamp()+180)
}

// Received usage and quota are persisted before final settlement. A DB failure
// during settlement can therefore be retried without another supplier call.
func ReceiveTanvaConsumption(id int64, quota int64, evidence, usageJSON string) error {
	if quota < 0 {
		return errors.New("negative quota")
	}
	q := DB.Model(&TanvaConsumption{}).Where("id = ? AND phase = ? AND status IN ?", id, "dispatching", []string{"pending", "reconciliation_required"}).Updates(map[string]interface{}{"phase": "received", "actual_quota": quota, "usage_evidence": evidence, "usage_json": usageJSON, "lease_until": 0})
	if q.Error != nil {
		return q.Error
	}
	if q.RowsAffected != 1 {
		return errors.New("tanva_usage_not_dispatching")
	}
	return nil
}

func SettleTanvaConsumption(id int64) error {
	var result *TanvaConsumption
	err := DB.Transaction(func(tx *gorm.DB) error {
		o, err := tanvaLockTx(tx, id)
		if err != nil {
			return err
		}
		result = o
		if o.Status == "consumed" {
			return nil
		}
		if o.Phase != "received" {
			return errors.New("tanva_usage_not_received")
		}
		if err := tanvaFundingDeltaTx(tx, o, o.ActualQuota-o.PreQuota); err != nil {
			return err
		}
		if err := tanvaTokenDeltaTx(tx, o, o.ActualQuota-o.PreQuota); err != nil {
			return err
		}
		if err := tx.Model(&User{}).Where("id = ?", o.UserID).Updates(map[string]interface{}{"used_quota": gorm.Expr("used_quota + ?", o.ActualQuota), "request_count": gorm.Expr("request_count + 1")}).Error; err != nil {
			return err
		}
		if o.ChannelID > 0 {
			if err := tx.Model(&Channel{}).Where("id = ?", o.ChannelID).Update("used_quota", gorm.Expr("used_quota + ?", o.ActualQuota)).Error; err != nil {
				return err
			}
		}
		rev := o.Revision
		o.Revision++
		o.Status, o.Phase, o.SettledAt, o.ErrorCode = "consumed", "settled", common.GetTimestamp(), ""
		if err := tanvaSaveTx(tx, o, rev); err != nil {
			return err
		}
		return tanvaEnqueueTx(tx, o)
	})
	if err == nil {
		invalidateTanvaCaches(result)
	}
	return err
}

// Fail is safe to refund only before dispatch. Once sent, missing evidence is
// reconciliation_required, never an invented zero-cost rejection/refund.
func FailTanvaConsumption(id int64, code string) error {
	return failTanvaConsumption(id, code, 0)
}

func failTanvaConsumption(id int64, code string, expiredBefore int64) error {
	var result *TanvaConsumption
	err := DB.Transaction(func(tx *gorm.DB) error {
		o, err := tanvaLockTx(tx, id)
		if err != nil {
			return err
		}
		result = o
		if expiredBefore > 0 && (o.Status != "pending" || o.LeaseUntil >= expiredBefore || o.Phase == "received") {
			return nil
		}
		if o.Status == "consumed" || o.Status == "rejected" || o.Status == "reconciliation_required" {
			return nil
		}
		rev := o.Revision
		o.Revision++
		o.ErrorCode = code
		if o.Phase == "accepted" || o.Phase == "reserved" {
			if o.PreQuota > 0 {
				if err := tanvaFundingDeltaTx(tx, o, -o.PreQuota); err != nil {
					return err
				}
				if err := tanvaTokenDeltaTx(tx, o, -o.PreQuota); err != nil {
					return err
				}
			}
			o.Status, o.Phase, o.SettledAt = "rejected", "rejected", common.GetTimestamp()
		} else {
			o.Status = "reconciliation_required"
		}
		if err := tanvaSaveTx(tx, o, rev); err != nil {
			return err
		}
		return tanvaEnqueueTx(tx, o)
	})
	if err == nil {
		invalidateTanvaCaches(result)
	}
	return err
}

func RecoverTanvaConsumptions(now int64) error {
	var rows []TanvaConsumption
	if err := DB.Where("phase = ? OR (status = ? AND lease_until < ?)", "received", "pending", now).Limit(100).Find(&rows).Error; err != nil {
		return err
	}
	for _, o := range rows {
		if o.Phase == "received" {
			if err := SettleTanvaConsumption(o.ID); err != nil {
				_ = FailTanvaConsumption(o.ID, "settlement_retry_required")
			}
		} else {
			_ = failTanvaConsumption(o.ID, "gateway_execution_interrupted", now)
		}
	}
	return nil
}

func LeaseTanvaOutbox(now int64) (*TanvaConsumptionOutbox, error) {
	var rows []TanvaConsumptionOutbox
	if err := DB.Where("delivered_at = 0 AND next_attempt_at <= ? AND lease_until <= ?", now, now).Order("id asc").Limit(10).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, o := range rows {
		q := DB.Model(&TanvaConsumptionOutbox{}).Where("id = ? AND delivered_at = 0 AND lease_until <= ?", o.ID, now).Updates(map[string]interface{}{"lease_until": now + 30, "attempts": gorm.Expr("attempts + 1")})
		if q.Error != nil {
			return nil, q.Error
		}
		if q.RowsAffected == 1 {
			o.LeaseUntil = now + 30
			o.Attempts++
			return &o, nil
		}
	}
	return nil, nil
}
func FinishTanvaOutbox(o *TanvaConsumptionOutbox, delivered bool, now int64) error {
	delay := int64(1) << min(o.Attempts, 10)
	if delay > 3600 {
		delay = 3600
	}
	values := map[string]interface{}{"lease_until": 0, "next_attempt_at": now + delay}
	if delivered {
		values["delivered_at"] = now
	}
	q := DB.Model(&TanvaConsumptionOutbox{}).Where("id = ? AND lease_until = ? AND delivered_at = 0", o.ID, o.LeaseUntil).Updates(values)
	if q.Error != nil {
		return q.Error
	}
	if q.RowsAffected != 1 {
		return fmt.Errorf("outbox lease lost: %d", o.ID)
	}
	return nil
}
