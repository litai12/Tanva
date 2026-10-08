package model

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/official_pricing"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ChannelOfficialSyncOptions struct {
	BaselineUSDToCNY      *float64          `json:"baseline_usd_to_cny"`
	OfficialModelBindings map[string]string `json:"official_model_bindings"`
}

type ChannelOfficialSyncResult struct {
	SyncedModels  []string                   `json:"synced_models"`
	SkippedModels []string                   `json:"skipped_models"`
	Setting       map[string]json.RawMessage `json:"setting"`
}

// SyncChannelOfficialPricing uses the checked-in verified registry. It does
// not fetch live prices, change global ratios, touch media prices, or apply FX
// again during settlement. The saved single multiplier is never overwritten.
func SyncChannelOfficialPricing(channelID int, options ChannelOfficialSyncOptions) (*ChannelOfficialSyncResult, error) {
	if channelID <= 0 {
		return nil, fmt.Errorf("invalid channel ID")
	}
	result := &ChannelOfficialSyncResult{SyncedModels: []string{}, SkippedModels: []string{}}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var channel Channel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&channel, channelID).Error; err != nil {
			return err
		}
		if channel.Status != common.ChannelStatusEnabled {
			return fmt.Errorf("official chat synchronization requires an enabled channel")
		}
		var settings dto.ChannelSettings
		raw := make(map[string]json.RawMessage)
		if channel.Setting != nil && *channel.Setting != "" {
			if err := common.UnmarshalJsonStr(*channel.Setting, &settings); err != nil {
				return err
			}
			if err := common.UnmarshalJsonStr(*channel.Setting, &raw); err != nil {
				return err
			}
		}
		if len(settings.TextBasePerMillionCNY) == 0 {
			return fmt.Errorf("channel has no single-multiplier CNY base contract")
		}
		fx := settings.TextOfficialUSDToCNY
		if fx == 0 {
			fx = ratio_setting.USD2RMB
		}
		if options.BaselineUSDToCNY != nil {
			fx = *options.BaselineUSDToCNY
		}
		if fx <= 0 || math.IsNaN(fx) || math.IsInf(fx, 0) {
			return fmt.Errorf("official FX must be finite and positive")
		}
		var abilityNames []string
		if err := tx.Model(&Ability{}).Where("channel_id = ? AND enabled = ?", channelID, true).Distinct("model").Pluck("model", &abilityNames).Error; err != nil {
			return err
		}
		declared := make(map[string]bool)
		for _, name := range channel.GetModels() {
			declared[strings.TrimSpace(name)] = true
		}
		var metas []Model
		if err := tx.Where("model_name IN ? AND kind = ?", abilityNames, "chat").Find(&metas).Error; err != nil {
			return err
		}
		selected := make(map[string]bool)
		for _, meta := range metas {
			if declared[meta.ModelName] {
				selected[meta.ModelName] = true
			}
		}
		if len(selected) == 0 {
			return fmt.Errorf("channel has no enabled chat models to synchronize")
		}
		for name := range options.OfficialModelBindings {
			if !selected[name] {
				return fmt.Errorf("official binding %s is outside this channel's enabled chat models", name)
			}
		}
		if settings.TextOfficialPricing == nil {
			settings.TextOfficialPricing = make(map[string]official_pricing.ModelPrice)
		}
		for name := range selected {
			var price official_pricing.ModelPrice
			var found bool
			if id, explicit := options.OfficialModelBindings[name]; explicit {
				price, found = official_pricing.LookupID(id)
				if !found {
					return fmt.Errorf("official model %q is outside the verified registry", id)
				}
			} else if existing, bound := settings.TextOfficialPricing[name]; bound {
				price, found = official_pricing.LookupID(existing.OfficialModelID)
			} else {
				price, found = official_pricing.Lookup(name)
			}
			if !found {
				result.SkippedModels = append(result.SkippedModels, name)
				continue // An unverified base remains unchanged and is never called official.
			}
			base, err := dto.ChannelBaseFromOfficial(price, fx)
			if err != nil {
				return fmt.Errorf("model %s official price: %w", name, err)
			}
			settings.TextBasePerMillionCNY[name] = base
			settings.TextOfficialPricing[name] = price
			result.SyncedModels = append(result.SyncedModels, name)
		}
		settings.TextOfficialUSDToCNY = fx
		settingsJSON, err := common.Marshal(settings)
		if err != nil {
			return err
		}
		var updated map[string]json.RawMessage
		if err := common.Unmarshal(settingsJSON, &updated); err != nil {
			return err
		}
		for _, field := range []string{"text_base_per_million_cny", "text_price_multiplier", "text_official_pricing", "text_official_usd_to_cny"} {
			if value, exists := updated[field]; exists {
				raw[field] = value
			}
		}
		delete(raw, "text_cost_per_million_cny")
		delete(raw, "text_sale_multiplier")
		delete(raw, "text_procurement_discount")
		encoded, err := common.Marshal(raw)
		if err != nil {
			return err
		}
		channel.Setting = common.GetPointer(string(encoded))
		if err := channel.ValidateSettings(); err != nil {
			return err
		}
		if err := tx.Model(&Channel{}).Where("id = ?", channelID).Update("setting", string(encoded)).Error; err != nil {
			return err
		}
		result.Setting = make(map[string]json.RawMessage)
		for _, field := range []string{"text_base_per_million_cny", "text_price_multiplier", "text_official_pricing", "text_official_usd_to_cny"} {
			if value, exists := raw[field]; exists {
				result.Setting[field] = value
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(result.SyncedModels)
	sort.Strings(result.SkippedModels)
	InitChannelCache()
	// Refresh the public quote immediately, instead of waiting for the old TTL.
	updatePricingLock.Lock()
	modelSupportEndpointsLock.Lock()
	updatePricing()
	modelSupportEndpointsLock.Unlock()
	updatePricingLock.Unlock()
	return result, nil
}
