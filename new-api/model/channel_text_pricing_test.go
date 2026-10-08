package model

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const testTextContract = `{"text_sale_multiplier":2,"text_cost_per_million_cny":{"new-contract-model":{"input":0.2,"output":1,"cache_read":0.02,"cache_write":0.25,"tiers":[{"max_prompt_tokens":100,"input":0.2,"output":1,"cache_read":0.02,"cache_write":0.25},{"max_prompt_tokens":0,"input":0.4,"output":1.5,"cache_read":0.04,"cache_write":0.5}]}}}`

func TestChannelTextQuotesPublishFinalCNYAndAllTiers(t *testing.T) {
	abilities := []AbilityWithChannel{
		{Ability: Ability{ChannelId: 10, Model: "new-contract-model", Group: "default"}, ChannelSetting: testTextContract},
		{Ability: Ability{ChannelId: 10, Model: "new-contract-model", Group: "vip"}, ChannelSetting: testTextContract},
		{Ability: Ability{ChannelId: 20, Model: "new-contract-model", Group: "default"}},
	}
	quotes, legacy, err := channelTextQuotes(abilities)
	require.NoError(t, err)
	require.True(t, legacy["new-contract-model"])
	require.Len(t, quotes["new-contract-model"], 1)
	quote := quotes["new-contract-model"][0]
	require.Equal(t, []string{"default", "vip"}, quote.EnableGroups)
	require.Equal(t, "CNY", quote.Currency)
	require.Equal(t, .4, quote.Input)
	require.Equal(t, 2.0, quote.Output)
	require.Equal(t, .04, quote.CacheRead)
	require.Len(t, quote.Tiers, 2)
	require.Equal(t, 100, quote.Tiers[0].MaxPromptTokens)
	require.Equal(t, .8, quote.Tiers[1].Input)
	require.Equal(t, 3.0, quote.Tiers[1].Output)
	data, err := common.Marshal(quote)
	require.NoError(t, err)
	require.Contains(t, string(data), `"input":0.4`)
	require.Contains(t, string(data), `"tiers"`)
	channel := Channel{Setting: common.GetPointer(testTextContract)}
	require.NoError(t, channel.ValidateSettings())
	channel.Models = "new-contract-model,unpriced-auto-sync-model"
	require.ErrorContains(t, channel.ValidateSettings(), "not configured")
	filtered, err := filterUnpricedContractAbilities([]AbilityWithChannel{
		{Ability: Ability{ChannelId: 10, Model: "unpriced-auto-sync-model", Group: "default"}, ChannelSetting: testTextContract},
		{Ability: Ability{ChannelId: 20, Model: "unpriced-auto-sync-model", Group: "default"}},
	})
	require.NoError(t, err)
	require.Len(t, filtered, 1)
	require.Equal(t, 20, filtered[0].ChannelId)
	channel.Setting = common.GetPointer(`{"text_sale_multiplier":0,"text_cost_per_million_cny":{"bad":{"input":1}}}`)
	require.Error(t, channel.ValidateSettings())
}

// Exercise the exact checked-in SQL input snapshot, not a parallel handwritten
// list, through a database join and the public pricing catalog builder.
func TestChannelTextPricingRealLLubanSnapshotPublicCatalog(t *testing.T) {
	data, err := os.ReadFile("../patches/2026-10-08/lluban-chat-pricing-snapshot.json")
	require.NoError(t, err)
	var snapshot struct {
		SaleMultiplier float64                         `json:"sale_multiplier"`
		ChannelCosts   map[string]dto.TextTokenCostCNY `json:"channel_costs"`
	}
	require.NoError(t, common.Unmarshal(data, &snapshot))
	require.Len(t, snapshot.ChannelCosts, 22)
	settings := dto.ChannelSettings{TextSaleMultiplier: snapshot.SaleMultiplier, TextCostPerMillionCNY: snapshot.ChannelCosts}
	for name, cost := range snapshot.ChannelCosts {
		contract, err := settings.TextPricing(name)
		require.NoError(t, err, name)
		for _, tier := range cost.Tiers {
			_, err := contract.Retail(tier.MaxPromptTokens)
			require.NoError(t, err, name)
		}
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
	t.Cleanup(func() {
		DB, pricingMap, vendorsList, lastGetPricingTime = oldDB, oldPricing, oldVendors, oldTime
		modelEnableGroups, modelQuotaTypeMap, modelKindMap = oldGroups, oldQuotas, oldKinds
		modelSupportEndpointTypes, supportedEndpointMap = oldEndpoints, oldSupported
		require.NoError(t, sqlDB.Close())
	})
	DB, pricingMap, lastGetPricingTime = db, nil, time.Time{}
	raw, err := common.Marshal(settings)
	require.NoError(t, err)
	names := make([]string, 0, len(snapshot.ChannelCosts))
	for name := range snapshot.ChannelCosts {
		names = append(names, name)
	}
	channel := Channel{Id: 501, Status: 1, Type: 1, Models: strings.Join(names, ","), Setting: common.GetPointer(string(raw))}
	require.NoError(t, channel.ValidateSettings())
	require.NoError(t, DB.Create(&channel).Error)
	for _, name := range names {
		require.NoError(t, DB.Create(&Model{ModelName: name, Kind: "chat", Status: 1, NameRule: NameRuleExact}).Error)
		for _, group := range []string{"default", "vip", "svip"} {
			require.NoError(t, DB.Create(&Ability{ChannelId: 501, Model: name, Group: group, Enabled: true}).Error)
		}
	}
	// Simulate upstream auto-sync bypassing admin validation: a missing cost
	// must not appear in /api/pricing with a default or free global quote.
	require.NoError(t, DB.Create(&Ability{ChannelId: 501, Model: "unpriced-auto-sync-model", Group: "default", Enabled: true}).Error)
	pricing := GetPricing()
	require.Len(t, pricing, 22)
	for _, item := range pricing {
		require.Len(t, item.ChannelTextPrices, 1, item.ModelName)
		quote := item.ChannelTextPrices[0]
		contract, err := settings.TextPricing(item.ModelName)
		require.NoError(t, err)
		want, err := contract.Retail(0)
		require.NoError(t, err)
		require.Equal(t, "CNY", quote.Currency)
		require.Equal(t, 501, quote.ChannelID)
		require.Equal(t, []string{"default", "svip", "vip"}, quote.EnableGroups)
		require.Equal(t, want.Input, quote.Input, item.ModelName)
		require.Equal(t, want.Output, quote.Output, item.ModelName)
		require.Len(t, quote.Tiers, len(snapshot.ChannelCosts[item.ModelName].Tiers), item.ModelName)
		if item.ModelName == "gpt-6-luna" {
			require.InDelta(t, .292, quote.Input, 1e-12)
			require.InDelta(t, 1.46, quote.Output, 1e-12)
			require.InDelta(t, .584, quote.Tiers[1].Input, 1e-12)
			require.InDelta(t, 2.19, quote.Tiers[1].Output, 1e-12)
		}
		if item.ModelName == "kimi-k3" {
			require.InDelta(t, 17.52, *quote.CacheWrite1h, 1e-12)
		}
		if item.ModelName == "deepseek-v4.1-flash" {
			require.InDelta(t, .876, quote.Input, 1e-12)
			require.InDelta(t, 3.504, quote.Output, 1e-12)
			require.InDelta(t, .01752, quote.CacheRead, 1e-12)
		}
	}
}

func TestChannelTextSummaryUsesActualExclusiveContracts(t *testing.T) {
	modelsBefore := ratio_setting.ModelRatio2JSONString()
	pricesBefore := ratio_setting.ModelPrice2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(modelsBefore))
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(pricesBefore))
	})
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"existing-model":8}`))
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"existing-fixed":1}`))
	quotes := []ChannelTextPrice{{TextTokenCostCNY: types.TextTokenCostCNY{Input: .4, Output: 2, CacheRead: .04, CacheWrite: .5}}}
	for _, name := range []string{"existing-model", "existing-fixed", "new-contract-model"} {
		original := Pricing{ModelName: name, ModelRatio: 37.5, CompletionRatio: 6}
		pricing := original
		applyExclusiveChannelTextQuote(&pricing, quotes, false)
		require.Equal(t, .2, pricing.ModelRatio)
		require.Equal(t, 5.0, pricing.CompletionRatio)
		pricing = original
		applyExclusiveChannelTextQuote(&pricing, quotes, true)
		require.Equal(t, original, pricing)
	}
	require.Equal(t, `{"existing-model":8}`, ratio_setting.ModelRatio2JSONString())
	require.Equal(t, `{"existing-fixed":1}`, ratio_setting.ModelPrice2JSONString())
}
