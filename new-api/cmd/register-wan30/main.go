// Register Wan3.0 on existing Ali channels without copying credentials.
package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func register(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		// Clone only already enabled Wan2.7 abilities on Ali channels.
		var abilities []model.Ability
		if err := tx.Model(&model.Ability{}).Select("abilities.*").Joins("JOIN channels ON channels.id = abilities.channel_id").
			Where("channels.type = ? AND channels.status = ? AND abilities.model = ? AND abilities.enabled = ?", 17, 1, "wan2.7-i2v", true).
			Find(&abilities).Error; err != nil {
			return err
		}
		if len(abilities) == 0 {
			return errors.New("no enabled Ali Wan2.7 channel found; configure an Ali channel first")
		}
		now := time.Now().Unix()
		entry := model.Model{ModelName: "wan3.0-video", Description: "Wan3.0 text-to-video; standard price x 1.5", Kind: "video", Tags: "dashscope,video", Endpoints: "/v1/videos", Status: 1, SyncOfficial: 1, CreatedTime: now, UpdatedTime: now, Capabilities: "[]", ParamsDef: `[{"key":"duration","type":"integer","label":"时长","options":[{"value":5},{"value":10},{"value":15},{"value":20},{"value":25},{"value":30}]},{"key":"resolution","type":"string","label":"分辨率","enum":["480P","720P","1080P"]},{"key":"ratio","type":"string","enum":["adaptive"]}]`}
		var count int64
		if err := tx.Model(&model.Model{}).Where("model_name = ?", entry.ModelName).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			if err := tx.Create(&entry).Error; err != nil {
				return err
			}
		}
		seen := map[int]bool{}
		for _, ability := range abilities {
			if !seen[ability.ChannelId] {
				var channel model.Channel
				if err := tx.Select("id", "models").First(&channel, ability.ChannelId).Error; err != nil {
					return err
				}
				found := false
				for _, name := range strings.Split(channel.Models, ",") {
					if strings.TrimSpace(name) == entry.ModelName {
						found = true
					}
				}
				if !found {
					models := strings.Trim(channel.Models, ",") + "," + entry.ModelName
					if err := tx.Model(&model.Channel{}).Where("id = ?", channel.Id).Update("models", models).Error; err != nil {
						return err
					}
				}
				seen[ability.ChannelId] = true
			}
			ability.Model = entry.ModelName
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&ability).Error; err != nil {
				return err
			}
		}
		option := model.Option{Key: "ModelPrice"}
		err := tx.Where(&model.Option{Key: "ModelPrice"}).First(&option).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		ratios := map[string]float64{}
		if option.Value != "" {
			if err := common.UnmarshalJsonStr(option.Value, &ratios); err != nil {
				return err
			}
		}
		ratios[entry.ModelName] = 0.45 // 0.45 CNY/s at 480P, resolution multipliers 1/2/4.
		value, err := common.Marshal(ratios)
		if err != nil {
			return err
		}
		option.Value = string(value)
		return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoUpdates: clause.AssignmentColumns([]string{"value"})}).Create(&option).Error
	})
}

func main() {
	driver := flag.String("driver", "postgres", "postgres, mysql or sqlite")
	apply := flag.Bool("apply", false, "apply registration to database specified by SQL_DSN")
	flag.Parse()
	if !*apply {
		fmt.Println("Use -apply with SQL_DSN set to the existing new-api database; restart new-api afterward.")
		return
	}
	dsn := os.Getenv("SQL_DSN")
	if dsn == "" {
		fmt.Fprintln(os.Stderr, "SQL_DSN is required")
		os.Exit(1)
	}
	var dialector gorm.Dialector
	switch *driver {
	case "postgres":
		dialector = postgres.Open(dsn)
	case "mysql":
		dialector = mysql.Open(dsn)
	case "sqlite":
		dialector = sqlite.Open(dsn)
	default:
		fmt.Fprintln(os.Stderr, "unsupported driver")
		os.Exit(1)
	}
	db, err := gorm.Open(dialector, &gorm.Config{})
	if err == nil {
		err = register(db)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "Wan3.0 registration failed:", err)
		os.Exit(1)
	}
	fmt.Println("Wan3.0 registered. Restart new-api to refresh channel and pricing caches.")
}
