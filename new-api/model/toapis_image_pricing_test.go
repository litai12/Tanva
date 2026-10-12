package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestToAPISVIPPublicPricingIncludesAllQualityResolutionSpecs(t *testing.T) {
	prices := map[string][3]float64{"low": {.2, .3, .4}, "medium": {.3, .4, .5}, "high": {.4, .6, .8}, "xhigh": {.6, 1, 1.4}, "max": {1.5, 3, 4.5}}
	for _, model := range []string{"gpt-image-2.5-flare-vip", "gpt-image-2.5-sunburst-vip"} {
		pricing := buildParamPricing(model, nil)
		require.NotNil(t, pricing)
		require.Equal(t, "CNY", pricing.Currency)
		require.Len(t, pricing.Results, 15)
		seen := map[string]bool{}
		for _, result := range pricing.Results {
			index := map[string]int{"1k": 0, "2k": 1, "4k": 2}[result.Resolution]
			require.Equal(t, prices[result.Quality][index], result.PriceCNY)
			require.Equal(t, "image:"+result.Resolution+":"+result.Quality, result.SpecKey)
			require.False(t, seen[result.SpecKey])
			seen[result.SpecKey] = true
		}
		base, ok := fixedImageBasePriceCNY(model)
		require.True(t, ok)
		require.Equal(t, .2, base)
	}
}

// Exercise the public catalog builders, including canonicalization of ability
// names. Per-model pricing helpers alone cannot detect merged official SKUs.
func TestToAPISNano21PublicCatalogKeepsIndependentIdentities(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&Channel{}, &Ability{}, &Model{}, &Vendor{}))
	oldDB, oldPricing, oldVendors, oldTime := DB, pricingMap, vendorsList, lastGetPricingTime
	oldGroups, oldQuotas, oldKinds := modelEnableGroups, modelQuotaTypeMap, modelKindMap
	oldEndpoints, oldSupported := modelSupportEndpointTypes, supportedEndpointMap
	oldMemory := common.MemoryCacheEnabled
	oldGroupCol := commonGroupCol
	t.Cleanup(func() {
		DB, pricingMap, vendorsList, lastGetPricingTime = oldDB, oldPricing, oldVendors, oldTime
		modelEnableGroups, modelQuotaTypeMap, modelKindMap = oldGroups, oldQuotas, oldKinds
		modelSupportEndpointTypes, supportedEndpointMap = oldEndpoints, oldSupported
		common.MemoryCacheEnabled = oldMemory
		commonGroupCol = oldGroupCol
		require.NoError(t, sqlDB.Close())
	})
	DB, pricingMap, lastGetPricingTime, common.MemoryCacheEnabled = db, nil, time.Time{}, false
	commonGroupCol = "`group`" // Match the SQLite quoting selected by gateway DB initialization.
	ordinary, official := constant.ToAPISNanoBanana21, constant.ToAPISNanoBanana21Official
	channel := Channel{Id: 31, Type: constant.ChannelTypeApimart, Status: 1, Key: "fixture", Name: "toapis", Models: ordinary + "," + official, Group: "default,vip"}
	require.NoError(t, db.Create(&channel).Error)
	for _, name := range []string{ordinary, official} {
		require.NoError(t, db.Create(&Model{ModelName: name, Status: 1, NameRule: NameRuleExact, Kind: "image", Endpoints: `[{"type":"image-generation","path":"/v1/images/generations","method":"POST"}]`}).Error)
		for _, group := range []string{"default", "vip"} {
			require.NoError(t, db.Create(&Ability{Model: name, Group: group, ChannelId: 31, Enabled: true}).Error)
		}
	}
	require.ElementsMatch(t, []string{ordinary, official}, GetEnabledModels())
	for _, group := range []string{"default", "vip"} {
		require.ElementsMatch(t, []string{ordinary, official}, GetGroupEnabledModels(group))
	}
	require.NotContains(t, RoutingModelSelectionCandidates(ordinary), official)
	require.NotContains(t, RoutingModelSelectionCandidates(official), ordinary)
	RefreshPricing()
	prices := GetPricing()
	require.Len(t, prices, 2)
	for _, item := range prices {
		expected := map[string][]float64{ordinary: {.2, .3, .4}, official: {.3, .6, .9}}[item.ModelName]
		require.NotEmpty(t, expected, item.ModelName)
		require.Equal(t, expected[0], item.ModelPrice)
		require.ElementsMatch(t, []string{"default", "vip"}, item.EnableGroup)
		require.NotNil(t, item.ParamPricing)
		require.Len(t, item.ParamPricing.Results, 3)
		for index, result := range item.ParamPricing.Results {
			require.Equal(t, expected[index], result.PriceCNY)
		}
	}
	// An ability disable affects only its own identity in both public lists.
	require.NoError(t, db.Model(&Ability{}).Where("model = ?", official).Update("enabled", false).Error)
	RefreshPricing()
	require.Equal(t, []string{ordinary}, GetEnabledModels())
	require.Len(t, GetPricing(), 1)
	require.Equal(t, ordinary, GetPricing()[0].ModelName)
	// A catalog-only disable must also remain independent of the other SKU.
	require.NoError(t, db.Model(&Ability{}).Where("model = ?", official).Update("enabled", true).Error)
	require.NoError(t, db.Model(&Model{}).Where("model_name = ?", ordinary).Update("status", 2).Error)
	RefreshPricing()
	require.Len(t, GetPricing(), 1)
	require.Equal(t, official, GetPricing()[0].ModelName)
}

func TestToAPISNano21PublicPricingUsesLatestTanvasRetailPrices(t *testing.T) {
	for model, prices := range map[string][]float64{"gemini-nano-banana-2.1": {.2, .3, .4}, "gemini-nano-banana-2.1-official": {.3, .6, .9}} {
		pricing := buildParamPricing(model, nil)
		require.NotNil(t, pricing)
		require.Len(t, pricing.Results, 3)
		for index, result := range pricing.Results {
			require.Equal(t, prices[index], result.PriceCNY)
			require.Equal(t, "", result.Quality)
			require.Equal(t, "image:"+result.Resolution, result.SpecKey)
		}
		base, ok := fixedImageBasePriceCNY(model)
		require.True(t, ok)
		require.Equal(t, prices[0], base)
	}
}
