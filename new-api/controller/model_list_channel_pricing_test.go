package controller

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// Pricing and endpoint caches are private to model. Run the fixture in a child
// test process so this controller test cannot leave those caches behind for
// unrelated tests, while still exercising the actual HTTP handler and database.
func TestListModelsChannelPricing(t *testing.T) {
	const fixtureEnv = "TANVA_MODEL_LIST_PRICING_FIXTURE"
	if os.Getenv(fixtureEnv) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestListModelsChannelPricing$", "-test.count=1", "-test.v")
		cmd.Env = append(os.Environ(), fixtureEnv+"=1")
		output, err := cmd.CombinedOutput()
		require.NoError(t, err, "%s", output)
		return
	}

	dbBefore, logDBBefore := model.DB, model.LOG_DB
	sqliteBefore, mysqlBefore, postgresBefore := common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL
	redisBefore, memoryBefore := common.RedisEnabled, common.MemoryCacheEnabled
	masterBefore, sqlitePathBefore := common.IsMasterNode, common.SQLitePath
	selfUseBefore, ginModeBefore := operation_setting.SelfUseModeEnabled, gin.Mode()
	ratioBefore, priceBefore := ratio_setting.ModelRatio2JSONString(), ratio_setting.ModelPrice2JSONString()
	autoGroupsBefore, usableGroupsBefore := setting.AutoGroups2JsonString(), setting.UserUsableGroups2JSONString()
	t.Cleanup(func() {
		model.DB, model.LOG_DB = dbBefore, logDBBefore
		common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL = sqliteBefore, mysqlBefore, postgresBefore
		common.RedisEnabled, common.MemoryCacheEnabled = redisBefore, memoryBefore
		common.IsMasterNode, common.SQLitePath = masterBefore, sqlitePathBefore
		operation_setting.SelfUseModeEnabled = selfUseBefore
		gin.SetMode(ginModeBefore)
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(ratioBefore))
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(priceBefore))
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(autoGroupsBefore))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(usableGroupsBefore))
	})
	common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL = true, false, false
	common.RedisEnabled, common.MemoryCacheEnabled = false, false
	operation_setting.SelfUseModeEnabled = false
	gin.SetMode(gin.TestMode)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"legacy-global-model":1}`))
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{}`))
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["default","vip","restricted"]`))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","vip":"VIP"}`))

	// Use normal initialization to set the database-specific quoted column names.
	// Skip the full application migration; this fixture owns only its own tables.
	t.Setenv("SQL_DSN", "local-model-list-fixture")
	t.Setenv("LOG_SQL_DSN", "")
	common.IsMasterNode = false
	common.SQLitePath = filepath.Join(t.TempDir(), "model-list.sqlite")
	require.NoError(t, model.InitDB())
	db := model.DB
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Channel{}, &model.Ability{}, &model.Model{}, &model.Vendor{}))
	model.DB, model.LOG_DB = db, db
	user := model.User{Id: 41, Username: "catalog-fixture", Group: "default", Setting: "{}"}
	require.NoError(t, db.Create(&user).Error)

	seed := func(id int, name, group string, channelStatus int, abilityEnabled bool, metadataStatus int, contract bool) {
		t.Helper()
		channel := model.Channel{Id: id, Name: "fixture-" + name, Type: 1, Status: channelStatus, Models: name, Group: group}
		if contract {
			settings := dto.ChannelSettings{TextPriceMultiplier: common.GetPointer(.4),
				TextBasePerMillionCNY: map[string]dto.TextTokenCostCNY{name: {Input: 1, Output: 3, CacheRead: .1}}}
			raw, err := common.Marshal(settings)
			require.NoError(t, err)
			channel.Setting = common.GetPointer(string(raw))
		}
		require.NoError(t, db.Create(&channel).Error)
		require.NoError(t, db.Create(&model.Model{ModelName: name, Kind: "chat", Status: metadataStatus, NameRule: model.NameRuleExact}).Error)
		require.NoError(t, db.Create(&model.Ability{ChannelId: id, Model: name, Group: group, Enabled: abilityEnabled}).Error)
	}
	seed(101, "channel-only-model", "default", 1, true, 1, true)
	seed(102, "legacy-global-model", "default", 1, true, 1, false)
	seed(103, "vip-only-model", "vip", 1, true, 1, true)
	seed(104, "disabled-channel-model", "default", 2, true, 1, true)
	seed(105, "disabled-ability-model", "default", 1, false, 1, true)
	seed(106, "disabled-metadata-model", "default", 1, true, 2, true)
	seed(107, "changed-invalid-price-model", "default", 1, true, 1, true)
	seed(108, "restricted-group-model", "restricted", 1, true, 1, true)
	// An auto-synced ability absent from its channel contract must stay hidden.
	require.NoError(t, db.Create(&model.Model{ModelName: "missing-contract-model", Kind: "chat", Status: 1}).Error)
	require.NoError(t, db.Create(&model.Ability{ChannelId: 101, Model: "missing-contract-model", Group: "default", Enabled: true}).Error)

	_, _, hasGlobalPrice := ratio_setting.GetModelRatioOrPrice("channel-only-model")
	require.False(t, hasGlobalPrice, "fixture must exercise the independent-channel fallback")
	// Warm a valid public pricing cache, then simulate an administrator's invalid
	// edit. Current channel validation must not borrow the cached former quote.
	require.NotEmpty(t, model.GetPricing())
	require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 107).Update("setting",
		`{"text_price_multiplier":0.4,"text_base_per_million_cny":{"changed-invalid-price-model":{"input":1,"output":-1}}}`).Error)

	cases := []struct {
		name  string
		group string
		limit map[string]bool
		want  []string
	}{
		{"empty_token_group_uses_user_group_with_independent_and_legacy_prices", "", nil,
			[]string{"channel-only-model", "legacy-global-model"}},
		{"token_group_uses_its_own_priced_routes", "vip", nil, []string{"vip-only-model"}},
		{"auto_group_only_unions_user_usable_groups", "auto", nil,
			[]string{"channel-only-model", "legacy-global-model", "vip-only-model"}},
		{"allowlist_keeps_only_true_entries", "default", map[string]bool{
			"channel-only-model": true, "legacy-global-model": false}, []string{"channel-only-model"}},
		{"allowlist_cannot_borrow_another_groups_price", "default", map[string]bool{"vip-only-model": true}, []string{}},
		{"allowlisted_disabled_routes_and_metadata_stay_hidden", "default", map[string]bool{
			"disabled-channel-model": true, "disabled-ability-model": true, "disabled-metadata-model": true}, []string{}},
		{"invalid_or_missing_current_contract_stays_hidden", "default", map[string]bool{
			"changed-invalid-price-model": true, "missing-contract-model": true}, []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			router := gin.New()
			router.GET("/v1/models", func(c *gin.Context) {
				c.Set("id", user.Id)
				common.SetContextKey(c, constant.ContextKeyTokenGroup, tc.group)
				common.SetContextKey(c, constant.ContextKeyTokenModelLimitEnabled, tc.limit != nil)
				if tc.limit != nil {
					common.SetContextKey(c, constant.ContextKeyTokenModelLimit, tc.limit)
				}
				ListModels(c, constant.ChannelTypeOpenAI)
			})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/models", nil))
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			var body struct {
				Success bool               `json:"success"`
				Object  string             `json:"object"`
				Data    []dto.OpenAIModels `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body))
			require.True(t, body.Success, response.Body.String())
			require.Equal(t, "list", body.Object)
			ids := make([]string, 0, len(body.Data))
			for _, item := range body.Data {
				require.Equal(t, "model", item.Object)
				ids = append(ids, item.Id)
			}
			require.ElementsMatch(t, tc.want, ids)
		})
	}
}
