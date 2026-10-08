package model

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/types"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestChannelOfficialSingleMultiplierSeedSyncAndMediaIsolation(t *testing.T) {
	data, err := os.ReadFile("../patches/2026-10-08/lluban-chat-official-baseline.json")
	require.NoError(t, err)
	var settings dto.ChannelSettings
	require.NoError(t, common.Unmarshal(data, &settings))
	require.Len(t, settings.TextBasePerMillionCNY, 22)
	require.Len(t, settings.TextOfficialPricing, 20)
	require.Equal(t, .4, settings.GetTextPriceMultiplier())
	for name, base := range settings.TextBasePerMillionCNY {
		contract, err := settings.TextPricing(name)
		require.NoError(t, err, name)
		retail, err := contract.Retail(0)
		require.NoError(t, err, name)
		require.InDelta(t, base.Input*.4, retail.Input, 1e-12, name)
	}
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&Channel{}, &Ability{}, &Model{}, &Vendor{}))
	oldDB, oldPricing, oldVendors, oldTime := DB, pricingMap, vendorsList, lastGetPricingTime
	oldGroups, oldQuotas, oldKinds := modelEnableGroups, modelQuotaTypeMap, modelKindMap
	oldEndpoints, oldSupported := modelSupportEndpointTypes, supportedEndpointMap
	oldMemory := common.MemoryCacheEnabled
	t.Cleanup(func() {
		DB, pricingMap, vendorsList, lastGetPricingTime = oldDB, oldPricing, oldVendors, oldTime
		modelEnableGroups, modelQuotaTypeMap, modelKindMap = oldGroups, oldQuotas, oldKinds
		modelSupportEndpointTypes, supportedEndpointMap = oldEndpoints, oldSupported
		common.MemoryCacheEnabled = oldMemory
		require.NoError(t, sqlDB.Close())
	})
	DB, pricingMap, lastGetPricingTime, common.MemoryCacheEnabled = db, nil, time.Time{}, false
	// Operator changes one multiplier; an explicit official refresh preserves it.
	operatorMultiplier := .6
	settings.TextPriceMultiplier = &operatorMultiplier
	media := types.TextTokenCostCNY{Input: 9, Output: 10, CacheRead: 9, CacheWrite: 9}
	settings.TextBasePerMillionCNY["media-isolation-model"] = media
	names := make([]string, 0, len(settings.TextBasePerMillionCNY))
	for name := range settings.TextBasePerMillionCNY {
		names = append(names, name)
	}
	raw, err := common.Marshal(settings)
	require.NoError(t, err)
	var rawMap map[string]interface{}
	require.NoError(t, common.Unmarshal(raw, &rawMap))
	rawMap["unknown_settings"] = map[string]interface{}{"keep": true}
	raw, err = common.Marshal(rawMap)
	require.NoError(t, err)
	channel := Channel{Id: 701, Status: 1, Type: 1, Models: strings.Join(names, ","), Setting: common.GetPointer(string(raw))}
	require.NoError(t, DB.Create(&channel).Error)
	for _, name := range names {
		kind := "chat"
		if name == "media-isolation-model" {
			kind = "image"
		}
		require.NoError(t, DB.Create(&Model{ModelName: name, Kind: kind, Status: 1, NameRule: NameRuleExact}).Error)
		require.NoError(t, DB.Create(&Ability{ChannelId: 701, Model: name, Group: "default", Enabled: true}).Error)
	}
	unverifiedBefore := settings.TextBasePerMillionCNY["doubao-seed-2-1-turbo-260628"]
	result, err := SyncChannelOfficialPricing(701, ChannelOfficialSyncOptions{})
	require.NoError(t, err)
	require.Len(t, result.SyncedModels, 20)
	require.Len(t, result.SkippedModels, 2)
	require.Contains(t, result.SkippedModels, "doubao-seed-2-1-turbo-260628")
	require.NotContains(t, result.Setting, "unknown_settings")
	require.NotContains(t, result.Setting, "text_sale_multiplier")
	require.NotContains(t, result.Setting, "text_cost_per_million_cny")
	var saved Channel
	require.NoError(t, DB.First(&saved, 701).Error)
	var storedRaw map[string]interface{}
	require.NoError(t, common.UnmarshalJsonStr(*saved.Setting, &storedRaw))
	require.Contains(t, storedRaw, "unknown_settings")
	after := saved.GetSetting()
	require.Equal(t, operatorMultiplier, after.GetTextPriceMultiplier())
	require.Equal(t, unverifiedBefore, after.TextBasePerMillionCNY["doubao-seed-2-1-turbo-260628"])
	require.Equal(t, media, after.TextBasePerMillionCNY["media-isolation-model"])
	require.NotContains(t, after.TextOfficialPricing, "doubao-seed-2-1-turbo-260628")
	for _, item := range GetPricing() {
		if item.ModelKind != "chat" {
			require.Empty(t, item.ChannelTextPrices)
			continue
		}
		require.Len(t, item.ChannelTextPrices, 1)
		quote := item.ChannelTextPrices[0]
		require.Equal(t, operatorMultiplier, quote.PriceMultiplier)
		if item.ModelName == "gpt-6-luna" {
			require.InDelta(t, .438, quote.Input, 1e-12)
			require.InDelta(t, 2.19, quote.Output, 1e-12)
			require.InDelta(t, quote.Input, item.ModelRatio*2, 1e-12)
			require.NotNil(t, quote.OfficialPricing)
			require.Equal(t, 7.3, *quote.BaselineUSDToCNY)
			require.Equal(t, operatorMultiplier, *quote.OfficialPriceMultiplier)
		}
	}
	// A failed synchronization transaction leaves the entire saved contract intact.
	before := *saved.Setting
	_, err = SyncChannelOfficialPricing(701, ChannelOfficialSyncOptions{OfficialModelBindings: map[string]string{"media-isolation-model": "gpt-6-luna"}})
	require.Error(t, err)
	require.NoError(t, DB.First(&saved, 701).Error)
	require.Equal(t, before, *saved.Setting)
	badFX := -1.0
	_, err = SyncChannelOfficialPricing(701, ChannelOfficialSyncOptions{BaselineUSDToCNY: &badFX})
	require.Error(t, err)
	require.NoError(t, DB.First(&saved, 701).Error)
	require.Equal(t, before, *saved.Setting)
}
