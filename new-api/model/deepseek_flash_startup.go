package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errDeepSeekPriceConcurrentChange = errors.New("DeepSeek startup price configuration changed concurrently")

var deepSeekFlashContractAliases = []string{"deepseek-v4.1-flash", "deepseek-flash", "deepseek-v4-flash"}

// EnsureDeepSeekFlashCNYStartupPrices runs before InitOptionMap: the dynamic CNY
// pricing code requires peak ModelRatio=1 at the very first accepted request.
// Only its three contract aliases are changed. No channel, group or wallet is
// touched, and malformed existing price maps fail startup without replacement.
func EnsureDeepSeekFlashCNYStartupPrices(db *gorm.DB) error {
	for attempt := 0; attempt < 8; attempt++ {
		err := ensureDeepSeekFlashCNYStartupPricesOnce(db)
		if err == nil || !retryDeepSeekPriceMigration(err) {
			return err
		}
		if attempt == 7 {
			return err
		}
		time.Sleep(time.Duration(10*(1<<attempt)) * time.Millisecond)
	}
	return nil
}

func retryDeepSeekPriceMigration(err error) bool {
	if errors.Is(err, errDeepSeekPriceConcurrentChange) {
		return true
	}
	message := strings.ToLower(err.Error())
	for _, marker := range []string{"database is locked", "database table is locked", "sqlite_busy", "sqlite_locked", "deadlock", "could not serialize access", "sqlstate 40001", "sqlstate 40p01"} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

func ensureDeepSeekFlashCNYStartupPricesOnce(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		// Insert missing ratio rows in a stable order before locking. Concurrent
		// startups share the unique option key; they never overwrite an existing
		// JSON value during admission. ModelPrice is optional and is not created.
		for _, key := range []string{"CacheRatio", "CompletionRatio", "ModelRatio"} {
			if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoNothing: true}).Create(&Option{Key: key, Value: "{}"}).Error; err != nil {
				return err
			}
		}
		var rows []Option
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(clause.IN{Column: clause.Column{Name: "key"}, Values: []interface{}{"CacheRatio", "CompletionRatio", "ModelPrice", "ModelRatio"}}).Order(clause.OrderByColumn{Column: clause.Column{Name: "key"}}).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			values := make(map[string]json.RawMessage)
			if strings.TrimSpace(row.Value) != "" {
				if common.GetJsonType(json.RawMessage(row.Value)) != "object" || common.UnmarshalJsonStr(row.Value, &values) != nil {
					return fmt.Errorf("DeepSeek CNY startup: %s must be a valid JSON number map", row.Key)
				}
			}
			for _, raw := range values {
				var number float64
				if common.GetJsonType(raw) != "number" || common.Unmarshal(raw, &number) != nil {
					return fmt.Errorf("DeepSeek CNY startup: %s must contain numeric prices", row.Key)
				}
			}
			changed := false
			for _, alias := range deepSeekFlashContractAliases {
				if row.Key == "ModelPrice" {
					if _, exists := values[alias]; exists {
						delete(values, alias)
						changed = true
					}
					continue
				}
				want := map[string]float64{"ModelRatio": 1, "CompletionRatio": 4, "CacheRatio": 0.02}[row.Key]
				var current float64
				raw, exists := values[alias]
				if exists && common.Unmarshal(raw, &current) == nil && current == want {
					continue
				}
				encoded, err := common.Marshal(want)
				if err != nil {
					return err
				}
				values[alias] = encoded
				changed = true
			}
			if !changed {
				continue
			}
			encoded, err := common.Marshal(values)
			if err != nil {
				return err
			}
			// PostgreSQL/MySQL row locks serialize readers; compare-and-swap also
			// protects SQLite and any concurrent writer. Retry the whole transaction
			// rather than merging against a stale snapshot or partially updating.
			updated := tx.Model(&Option{}).Where(clause.Eq{Column: clause.Column{Name: "key"}, Value: row.Key}).Where(clause.Eq{Column: clause.Column{Name: "value"}, Value: row.Value}).Update("value", string(encoded))
			if updated.Error != nil {
				return updated.Error
			}
			if updated.RowsAffected != 1 {
				return errDeepSeekPriceConcurrentChange
			}
		}
		return nil
	})
}
