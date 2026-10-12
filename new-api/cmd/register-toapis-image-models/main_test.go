package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func fixture(t *testing.T, disabled bool) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "fixture.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Channel{}, &model.Model{}, &model.Ability{}, &model.Option{}); err != nil {
		t.Fatal(err)
	}
	priority := int64(9999)
	weight := uint(8888)
	baseURL := "https://toapis.cn"
	tag := "toapis"
	channel := model.Channel{Id: 31, Type: 59, Status: 1, Key: "never-copy-this-key", Name: "toapis", BaseURL: &baseURL, Models: "gpt-image-2.5-flare,gpt-image-2.5-sunburst,existing", Group: "default,vip", Priority: &priority, Weight: &weight, Tag: &tag}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if disabled {
		if err := db.Model(&channel).Update("status", 2).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, s := range skus {
		row := model.Model{ModelName: s.source, Status: 1, SyncOfficial: 1, NameRule: 1, Kind: "image", Capabilities: `["text_to_image","image_to_image"]`, ParamsDef: `[]`, VendorID: 22, Icon: "provider", Endpoints: `["/v1/images/generations"]`}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, o := range []model.Option{{Key: "ModelPrice", Value: `{"existing":7,"gpt-image-2.5-flare-vip":99,"gemini-nano-banana-2.1":0.3,"gemini-nano-banana-2.1-official":0.9}`}, {Key: "GroupRatio", Value: `{"default":1,"vip":0.8}`}} {
		if err := db.Create(&o).Error; err != nil {
			t.Fatal(err)
		}
	}
	// Preserve an existing manually disabled target ability and unrelated ability.
	for _, a := range []model.Ability{{Group: "default", Model: skus[0].name, ChannelId: 31, Enabled: false, Priority: &priority, Weight: 2}, {Group: "default", Model: "existing", ChannelId: 31, Enabled: false, Weight: 3}, {Group: "vip", Model: skus[1].source, ChannelId: 31, Enabled: false, Weight: 4}} {
		if err := db.Create(&a).Error; err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func TestDryRunApplyIdempotencyAndStatePreservation(t *testing.T) {
	for _, disabled := range []bool{false, true} {
		t.Run(map[bool]string{false: "enabled", true: "disabled"}[disabled], func(t *testing.T) {
			db := fixture(t, disabled)
			p, err := register(db, 31, false, "")
			if err != nil {
				t.Fatal(err)
			}
			if p.Applied || len(p.Actions) == 0 {
				t.Fatal("dry run missing plan")
			}
			var count int64
			db.Model(&model.Model{}).Count(&count)
			if count != int64(len(skus)) {
				t.Fatal("dry run wrote catalog")
			}
			var channel model.Channel
			db.First(&channel, 31)
			original := channel
			backup := filepath.Join(t.TempDir(), "backup")
			p, err = register(db, 31, true, backup)
			if err != nil {
				t.Fatal(err)
			}
			if !p.Applied || p.Backup == "" {
				t.Fatal("apply/backup missing")
			}
			data, err := os.ReadFile(p.Backup)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(data), "never-copy-this-key") {
				t.Fatal("credential copied to backup")
			}
			info, _ := os.Stat(p.Backup)
			if info.Mode().Perm() != 0600 {
				t.Fatal("backup mode")
			}
			db.First(&channel, 31)
			if channel.Status != original.Status || channel.Key != original.Key || channel.Group != original.Group || !strings.Contains(channel.Models, "existing") {
				t.Fatal("channel unrelated fields changed")
			}
			var price model.Option
			db.Where(&model.Option{Key: "ModelPrice"}).First(&price)
			var prices map[string]float64
			common.UnmarshalJsonStr(price.Value, &prices)
			if prices["existing"] != 7 {
				t.Fatal("unrelated price changed")
			}
			for _, s := range skus {
				if prices[s.name] != s.price {
					t.Fatal("incorrect target price")
				}
			}
			var group model.Option
			db.Where(&model.Option{Key: "GroupRatio"}).First(&group)
			if group.Value != `{"default":1,"vip":0.8}` {
				t.Fatal("group price overwritten")
			}
			var abilities []model.Ability
			db.Where("channel_id = ?", 31).Find(&abilities)
			if len(abilities) != 2*len(skus)+2 {
				t.Fatalf("abilities count %d", len(abilities))
			}
			for _, a := range abilities {
				if a.Model == "existing" && (a.Enabled || a.Weight != 3) {
					t.Fatal("unrelated ability overwritten")
				}
				if a.Model == skus[0].name && a.Group == "default" && (a.Enabled || a.Weight != 2) {
					t.Fatal("disabled target reenabled")
				}
				if a.Model == skus[1].name && a.Group == "vip" && a.Enabled {
					t.Fatal("disabled source ability ignored")
				}
				if disabled && a.Enabled {
					t.Fatal("disabled channel gained enabled ability")
				}
			}
			var entry model.Model
			db.Where("model_name = ?", skus[0].name).First(&entry)
			if entry.VendorID != 22 || entry.Icon != "provider" || entry.NameRule != 0 || entry.SyncOfficial != 0 {
				t.Fatal("clone contract wrong")
			}
			// Administrator metadata/status remains intact while target params get corrected.
			db.Model(&entry).Updates(map[string]interface{}{"status": 2, "description": "admin note", "params_def": "[]"})
			if _, err := register(db, 31, true, backup); err != nil {
				t.Fatal(err)
			}
			db.First(&entry, entry.Id)
			if entry.Status != 2 || entry.Description != "admin note" {
				t.Fatal("admin state overwritten")
			}
			p, err = register(db, 31, true, backup)
			if err != nil {
				t.Fatal(err)
			}
			if p.Applied || len(p.Actions) != 0 || p.Backup != "" {
				t.Fatal("second apply is not no-op")
			}
		})
	}
}

func TestPrerequisiteAndBackupFailuresDoNotWrite(t *testing.T) {
	db := fixture(t, false)
	if _, err := register(db, 31, true, ""); err == nil {
		t.Fatal("backup required")
	}
	db.Where("model_name = ?", skus[1].source).Delete(&model.Model{})
	if _, err := register(db, 31, true, t.TempDir()); err == nil {
		t.Fatal("missing source accepted")
	}
	var count int64
	db.Model(&model.Model{}).Where("model_name = ?", constant.ToAPISNanoBanana21Official).Count(&count)
	if count != 0 {
		t.Fatal("partial registration")
	}
	if _, err := register(db, 999, false, ""); err == nil {
		t.Fatal("wrong channel accepted")
	}
}

func TestIndependentParameterContracts(t *testing.T) {
	for _, s := range skus {
		raw, err := params(s.name)
		if err != nil {
			t.Fatal(err)
		}
		var defs []dto.ModelParamSpec
		if err := common.UnmarshalJsonStr(raw, &defs); err != nil {
			t.Fatal(err)
		}
		byKey := map[string]dto.ModelParamSpec{}
		for _, d := range defs {
			byKey[d.Key] = d
		}
		if *byKey["n"].Min != 1 || *byKey["n"].Max != 1 {
			t.Fatal("batch not fixed")
		}
		if constant.IsToAPISNanoBanana21(s.name) {
			if len(byKey["size"].Options) != 14 || byKey["resolution"].Default != "1K" || byKey["urls"].Metadata["max_items"] != float64(14) {
				t.Fatal("nano params wrong")
			}
			if _, exists := byKey["quality"]; exists {
				t.Fatal("nano leaked VIP quality")
			}
		} else if len(byKey["quality"].Options) != 5 || byKey["quality"].Default != "high" || byKey["size"].Default != "1:1" || byKey["size"].Type != "enum" || byKey["resolution"].Default != "1K" {
			t.Fatal("VIP params wrong")
		}
	}
}

func TestNano21IdentitiesAndDisabledStatesRemainIndependent(t *testing.T) {
	db := fixture(t, false)
	backup := filepath.Join(t.TempDir(), "backup")
	if _, err := register(db, 31, true, backup); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Model{}).Where("model_name = ?", constant.ToAPISNanoBanana21Official).Updates(map[string]interface{}{"status": 2, "description": "disabled official"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Ability{}).Where("model = ? AND channel_id = ?", constant.ToAPISNanoBanana21Official, 31).Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := register(db, 31, true, backup); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{constant.ToAPISNanoBanana21, constant.ToAPISNanoBanana21Official} {
		var row model.Model
		if err := db.Where("model_name = ?", name).First(&row).Error; err != nil {
			t.Fatal(err)
		}
		want := 1
		if name == constant.ToAPISNanoBanana21Official {
			want = 2
		}
		if row.Status != want || (name == constant.ToAPISNanoBanana21Official && row.NameRule != model.NameRuleExact) {
			t.Fatal("independent model identity/state changed", name)
		}
		if name == constant.ToAPISNanoBanana21Official && row.Description != "disabled official" {
			t.Fatal("official admin metadata changed")
		}
		var abilities []model.Ability
		if err := db.Where("model = ? AND channel_id = ?", name, 31).Find(&abilities).Error; err != nil {
			t.Fatal(err)
		}
		if len(abilities) != 2 {
			t.Fatal("missing distinct model abilities", name)
		}
		for _, ability := range abilities {
			if ability.Enabled != (name == constant.ToAPISNanoBanana21) {
				t.Fatal("model ability state crossed identities", name)
			}
		}
	}
}

func TestEmptyLegacySourceCapabilities(t *testing.T) {
	db := fixture(t, false)
	if err := db.Model(&model.Model{}).Where("model_name IN ?", []string{skus[0].source, skus[1].source}).Update("capabilities", "[]").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := register(db, 31, true, filepath.Join(t.TempDir(), "backup")); err != nil {
		t.Fatal(err)
	}
	var entry model.Model
	db.Where("model_name = ?", skus[0].name).First(&entry)
	if entry.Capabilities != `["reference_images"]` {
		t.Fatal("reference image support missing from empty legacy source")
	}
	if p, err := register(db, 31, false, ""); err != nil || len(p.Actions) != 0 {
		t.Fatal("legacy capability merge not idempotent", err)
	}
}
