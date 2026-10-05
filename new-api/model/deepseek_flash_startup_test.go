package model

import (
	"errors"
	"path/filepath"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func deepSeekStartupTestDB(t *testing.T, dsn string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&Option{}))
	return db
}

func deepSeekStartupOptions(t *testing.T, db *gorm.DB) map[string]string {
	t.Helper()
	var options []Option
	require.NoError(t, db.Find(&options).Error)
	result := make(map[string]string)
	for _, row := range options {
		result[row.Key] = row.Value
	}
	return result
}

func assertDeepSeekStartupContract(t *testing.T, db *gorm.DB) {
	t.Helper()
	rows := deepSeekStartupOptions(t, db)
	for key, want := range map[string]float64{"ModelRatio": 1, "CompletionRatio": 4, "CacheRatio": 0.02} {
		var values map[string]float64
		require.NoError(t, common.UnmarshalJsonStr(rows[key], &values))
		for _, alias := range deepSeekFlashContractAliases {
			require.Equal(t, want, values[alias], key+"/"+alias)
		}
	}
	if raw, exists := rows["ModelPrice"]; exists {
		var values map[string]float64
		require.NoError(t, common.UnmarshalJsonStr(raw, &values))
		for _, alias := range deepSeekFlashContractAliases {
			require.NotContains(t, values, alias)
		}
	}
}

func TestDeepSeekFlashStartupRepairsOnlyContractAliases(t *testing.T) {
	db := deepSeekStartupTestDB(t, ":memory:")
	seed := []Option{
		{Key: "ModelRatio", Value: `{"deepseek-v4.1-flash":0.15,"deepseek-flash":0.15,"deepseek-v4-flash":0.15,"unrelated":123.456789012345}`},
		{Key: "CompletionRatio", Value: `{"deepseek-flash":9,"unrelated":7}`},
		{Key: "CacheRatio", Value: `{"deepseek-flash":0.1,"unrelated":0.125}`},
		{Key: "ModelPrice", Value: `{"deepseek-flash":0.3,"deepseek-v4.1-flash":0.3,"deepseek-v4-flash":0.3,"xiaot-agent-deepseek-v4-flash":0.01,"other-fixed":12}`},
		{Key: "GroupRatio", Value: `{"default":0.75}`},
		{Key: "unrelated-setting", Value: "unchanged"},
	}
	require.NoError(t, db.Create(&seed).Error)
	require.NoError(t, EnsureDeepSeekFlashCNYStartupPrices(db))
	assertDeepSeekStartupContract(t, db)
	rows := deepSeekStartupOptions(t, db)
	require.Contains(t, rows["ModelRatio"], `"unrelated":123.456789012345`)
	require.JSONEq(t, `{"unrelated":7,"deepseek-v4.1-flash":4,"deepseek-flash":4,"deepseek-v4-flash":4}`, rows["CompletionRatio"])
	require.JSONEq(t, `{"xiaot-agent-deepseek-v4-flash":0.01,"other-fixed":12}`, rows["ModelPrice"])
	require.Equal(t, `{"default":0.75}`, rows["GroupRatio"])
	require.Equal(t, "unchanged", rows["unrelated-setting"])
	updates := 0
	require.NoError(t, db.Callback().Update().Before("gorm:update").Register("startup_count_updates", func(*gorm.DB) { updates++ }))
	require.NoError(t, EnsureDeepSeekFlashCNYStartupPrices(db))
	require.Equal(t, 0, updates)
	require.Equal(t, rows, deepSeekStartupOptions(t, db))
}

func TestDeepSeekFlashStartupMissingMaps(t *testing.T) {
	db := deepSeekStartupTestDB(t, ":memory:")
	require.NoError(t, EnsureDeepSeekFlashCNYStartupPrices(db))
	assertDeepSeekStartupContract(t, db)
	require.Len(t, deepSeekStartupOptions(t, db), 3)
}

func TestDeepSeekFlashStartupInvalidMapsRollback(t *testing.T) {
	for _, invalid := range []string{`{broken`, `null`, `[]`, `{"unrelated":"do not destroy"}`, `{"unrelated":null}`} {
		t.Run(invalid, func(t *testing.T) {
			db := deepSeekStartupTestDB(t, ":memory:")
			require.NoError(t, db.Create(&Option{Key: "ModelRatio", Value: invalid}).Error)
			before := deepSeekStartupOptions(t, db)
			require.Error(t, EnsureDeepSeekFlashCNYStartupPrices(db))
			require.Equal(t, before, deepSeekStartupOptions(t, db), "inserts and earlier updates must also roll back")
		})
	}
}

func TestDeepSeekFlashStartupWriteFailureRollsBack(t *testing.T) {
	db := deepSeekStartupTestDB(t, ":memory:")
	require.NoError(t, db.Create(&Option{Key: "ModelRatio", Value: `{"unrelated":2}`}).Error)
	before := deepSeekStartupOptions(t, db)
	updates := 0
	require.NoError(t, db.Callback().Update().Before("gorm:update").Register("startup_fail_second_update", func(tx *gorm.DB) {
		updates++
		if updates == 2 {
			tx.AddError(errors.New("fixture startup write failure"))
		}
	}))
	require.ErrorContains(t, EnsureDeepSeekFlashCNYStartupPrices(db), "fixture startup write failure")
	require.Equal(t, before, deepSeekStartupOptions(t, db))
	// A subsequent startup recovers solely from the unchanged persistent values.
	require.NoError(t, db.Callback().Update().Remove("startup_fail_second_update"))
	require.NoError(t, EnsureDeepSeekFlashCNYStartupPrices(db))
	assertDeepSeekStartupContract(t, db)
}

func TestDeepSeekFlashStartupConcurrentInstancesPreserveOtherKeys(t *testing.T) {
	dsn := "file:" + filepath.Join(t.TempDir(), "startup.sqlite") + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	first := deepSeekStartupTestDB(t, dsn)
	second := deepSeekStartupTestDB(t, dsn)
	require.NoError(t, first.Create(&Option{Key: "ModelRatio", Value: `{"unrelated":13,"deepseek-flash":0.15}`}).Error)
	start := make(chan struct{})
	errors := make(chan error, 13)
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			db := first
			if i%2 == 1 {
				db = second
			}
			errors <- EnsureDeepSeekFlashCNYStartupPrices(db)
		}(i)
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		<-start
		// This independent database writer atomically changes only an unrelated
		// key while both startup connections contend for the same price rows.
		errors <- second.Model(&Option{}).Where("key = ?", "ModelRatio").Update("value", gorm.Expr("json_set(value, '$.concurrent-model', ?)", 77)).Error
	}()
	close(start)
	wg.Wait()
	close(errors)
	for err := range errors {
		require.NoError(t, err)
	}
	assertDeepSeekStartupContract(t, first)
	var values map[string]float64
	require.NoError(t, common.UnmarshalJsonStr(deepSeekStartupOptions(t, first)["ModelRatio"], &values))
	require.Equal(t, float64(13), values["unrelated"])
	require.Equal(t, float64(77), values["concurrent-model"])
}
