package main

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"testing"
)

func TestRegisterWan30IdempotentAndPreservesOtherChannels(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Model{}, &model.Channel{}, &model.Ability{}, &model.Option{}); err != nil {
		t.Fatal(err)
	}
	for _, ch := range []model.Channel{{Id: 1, Type: 17, Status: 1, Models: "wan2.7-i2v"}, {Id: 2, Type: 67, Status: 1, Models: "other"}} {
		if err := db.Create(&ch).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.Ability{Group: "default", Model: "wan2.7-i2v", ChannelId: 1, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Option{Key: "ModelPrice", Value: `{"existing":7}`}).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := register(db); err != nil {
			t.Fatal(err)
		}
	}
	var count int64
	db.Model(&model.Ability{}).Where("model = ?", "wan3.0-video").Count(&count)
	if count != 1 {
		t.Fatalf("abilities = %d, want 1", count)
	}
	var channel model.Channel
	db.First(&channel, 2)
	if channel.Models != "other" {
		t.Fatal("unrelated channel modified")
	}
	var option model.Option
	db.First(&option)
	var ratios map[string]float64
	if err := common.UnmarshalJsonStr(option.Value, &ratios); err != nil {
		t.Fatal(err)
	}
	if ratios["existing"] != 7 || ratios["wan3.0-video"] != 0.45 {
		t.Fatalf("unexpected ratios: %v", ratios)
	}
}
