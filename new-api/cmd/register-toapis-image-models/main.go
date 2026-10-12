// Register the three ToAPIs image SKUs on an existing channel. Never reads keys.
package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

type sku struct {
	name, source string
	price        float64
}

var skus = []sku{
	{"gpt-image-2.5-flare-vip", "gpt-image-2.5-flare", 0.2},
	{"gpt-image-2.5-sunburst-vip", "gpt-image-2.5-sunburst", 0.2},
	{"gemini-nano-banana-2.1", "gemini-3.1-flash-image-preview", 0.3},
}

// Only fields inspected/modified by this tool. Channel credentials/settings are
// intentionally excluded from SELECT, backup, errors and stdout.
type channelSnapshot struct {
	ID       int `gorm:"column:id"`
	Type     int
	Status   int
	Name     string
	BaseURL  string `gorm:"column:base_url"`
	Models   string
	Group    string
	Priority *int64
	Weight   uint
	Tag      *string
}
type snapshot struct {
	Channel   channelSnapshot
	Models    []model.Model
	Abilities []model.Ability
	Options   []model.Option
}
type plan struct {
	ChannelID     int      `json:"channel_id"`
	ChannelStatus int      `json:"channel_status"`
	Groups        []string `json:"groups"`
	Actions       []string `json:"actions"`
	Backup        string   `json:"backup,omitempty"`
	Applied       bool     `json:"applied"`
}

func options(values ...string) []dto.ModelParamOption {
	result := make([]dto.ModelParamOption, 0, len(values))
	for _, v := range values {
		result = append(result, dto.ModelParamOption{Value: v, Label: v})
	}
	return result
}
func params(name string) (string, error) {
	one := float64(1)
	ratio := options("1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9")
	defs := []dto.ModelParamSpec{
		{Key: "size", Type: "enum", Label: "宽高比", Default: "1:1", Options: ratio, Metadata: map[string]interface{}{"api_accepts_pixel_dimensions": true}},
		{Key: "resolution", Type: "enum", Label: "分辨率", Default: "1K", Options: options("1K", "2K", "4K")},
		{Key: "quality", Type: "enum", Label: "质量", Default: "high", Options: options("low", "medium", "high", "xhigh", "max")},
		{Key: "n", Type: "integer", Label: "图片数量", Default: 1, Min: &one, Max: &one},
		{Key: "urls", Type: "array", Label: "参考图片 URL", Scope: "per_request", Metadata: map[string]interface{}{"item_type": "string", "remote_url_only": true}},
	}
	if name == "gemini-nano-banana-2.1" {
		ratio = append(ratio, options("1:4", "4:1", "1:8", "8:1")...)
		defs = []dto.ModelParamSpec{
			{Key: "size", Type: "enum", Label: "宽高比", Default: "1:1", Options: ratio},
			{Key: "resolution", Type: "enum", Label: "分辨率", Default: "1K", Options: options("1K", "2K", "4K")},
			{Key: "n", Type: "integer", Label: "图片数量", Default: 1, Min: &one, Max: &one},
			{Key: "urls", Type: "array", Label: "参考图片 URL", Scope: "per_request", Metadata: map[string]interface{}{"item_type": "string", "remote_url_only": true, "max_items": 14}},
		}
	}
	value, err := common.Marshal(defs)
	return string(value), err
}

func groups(csv string) []string {
	var result []string
	seen := map[string]bool{}
	for _, item := range strings.Split(csv, ",") {
		item = strings.TrimSpace(item)
		if item != "" && !seen[item] {
			result = append(result, item)
			seen[item] = true
		}
	}
	return result
}
func appendModels(csv string) string {
	seen := map[string]bool{}
	for _, item := range groups(csv) {
		seen[item] = true
	}
	for _, s := range skus {
		if !seen[s.name] {
			if csv != "" && !strings.HasSuffix(csv, ",") {
				csv += ","
			}
			csv += s.name
		}
	}
	return csv
}

func capabilities(source model.Model) (string, error) {
	var caps []string
	if common.UnmarshalJsonStr(source.Capabilities, &caps) != nil {
		return "", fmt.Errorf("required source capabilities invalid: %s", source.ModelName)
	}
	// Empty source capabilities are valid legacy catalog rows. All three new SKUs
	// support reference-image input; preserve any other source capability names.
	found := false
	for _, cap := range caps {
		if cap == "reference_images" {
			found = true
			break
		}
	}
	if !found {
		caps = append(caps, "reference_images")
	}
	value, err := common.Marshal(caps)
	return string(value), err
}

func readSnapshot(tx *gorm.DB, channelID int) (snapshot, error) {
	var before snapshot
	if err := tx.Table("channels").Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id", "type", "status", "name", "base_url", "models", "group", "priority", "weight", "tag").
		Where("id = ?", channelID).Take(&before.Channel).Error; err != nil {
		return before, errors.New("selected channel not found or unreadable")
	}
	if before.Channel.Type != 59 || strings.TrimRight(strings.ToLower(before.Channel.BaseURL), "/") != "https://toapis.cn" {
		return before, errors.New("selected channel must be type 59 at https://toapis.cn")
	}
	if len(groups(before.Channel.Group)) == 0 {
		return before, errors.New("selected channel has no groups")
	}
	names := []string{}
	for _, s := range skus {
		names = append(names, s.name, s.source)
	}
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("model_name IN ?", names).Find(&before.Models).Error; err != nil {
		return before, errors.New("model snapshot failed")
	}
	if err := tx.Where("channel_id = ?", channelID).Find(&before.Abilities).Error; err != nil {
		return before, errors.New("ability snapshot failed")
	}
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(&model.Option{Key: "ModelPrice"}).Find(&before.Options).Error; err != nil {
		return before, errors.New("price snapshot failed")
	}
	return before, nil
}

func buildPlan(before snapshot) (plan, map[string]model.Model, map[string]float64, error) {
	p := plan{ChannelID: before.Channel.ID, ChannelStatus: before.Channel.Status, Groups: groups(before.Channel.Group), Actions: []string{}}
	byName := map[string]model.Model{}
	for _, row := range before.Models {
		if _, found := byName[row.ModelName]; found {
			return p, nil, nil, errors.New("duplicate active model catalog rows")
		}
		byName[row.ModelName] = row
	}
	prices := map[string]float64{}
	if len(before.Options) != 1 || common.UnmarshalJsonStr(before.Options[0].Value, &prices) != nil || prices == nil {
		return p, nil, nil, errors.New("existing ModelPrice must be a JSON numeric object")
	}
	if appendModels(before.Channel.Models) != before.Channel.Models {
		p.Actions = append(p.Actions, "append three SKUs to selected channel.models")
	}
	for _, s := range skus {
		source, exists := byName[s.source]
		if !exists {
			return p, nil, nil, fmt.Errorf("required source catalog row missing: %s", s.source)
		}
		caps, err := capabilities(source)
		if err != nil {
			return p, nil, nil, err
		}
		def, err := params(s.name)
		if err != nil {
			return p, nil, nil, errors.New("parameter encoding failed")
		}
		if target, found := byName[s.name]; !found {
			p.Actions = append(p.Actions, "clone catalog: "+s.name)
		} else if target.ParamsDef != def || target.Capabilities != caps || target.Kind != "image" {
			p.Actions = append(p.Actions, "update capability/params only: "+s.name)
		}
		if price, exists := prices[s.name]; !exists || price != s.price {
			p.Actions = append(p.Actions, fmt.Sprintf("set ModelPrice[%s]=%g CNY", s.name, s.price))
		}
		for _, group := range p.Groups {
			found := false
			for _, a := range before.Abilities {
				if a.Group == group && a.Model == s.name {
					found = true
					break
				}
			}
			if !found {
				p.Actions = append(p.Actions, "add ability: "+group+"/"+s.name+" (inherit channel/source state)")
			}
		}
	}
	return p, byName, prices, nil
}

func writeBackup(dir string, before snapshot) (string, error) {
	if dir == "" {
		return "", errors.New("--backup-dir is required with --apply")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", errors.New("backup directory creation failed")
	}
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return "", errors.New("backup directory must have permissions 0700")
	}
	data, err := common.Marshal(before)
	if err != nil {
		return "", errors.New("backup encoding failed")
	}
	file, err := os.CreateTemp(dir, "toapis-image-before-*.json")
	if err != nil {
		return "", errors.New("backup creation failed")
	}
	defer file.Close()
	if err := file.Chmod(0600); err != nil {
		return "", errors.New("backup permissions failed")
	}
	if _, err := file.Write(data); err != nil {
		return "", errors.New("backup write failed")
	}
	if err := file.Sync(); err != nil {
		return "", errors.New("backup sync failed")
	}
	return filepath.Abs(file.Name())
}

func applyPlan(tx *gorm.DB, before snapshot, catalog map[string]model.Model, prices map[string]float64) error {
	now := time.Now().Unix()
	updatedModels := appendModels(before.Channel.Models)
	if updatedModels != before.Channel.Models {
		if err := tx.Table("channels").Where("id = ?", before.Channel.ID).Update("models", updatedModels).Error; err != nil {
			return errors.New("channel append failed")
		}
	}
	for _, s := range skus {
		source := catalog[s.source]
		caps, _ := capabilities(source)
		def, _ := params(s.name)
		if target, exists := catalog[s.name]; exists {
			if target.ParamsDef != def || target.Capabilities != caps || target.Kind != "image" {
				if err := tx.Model(&model.Model{}).Where("id = ?", target.Id).Updates(map[string]interface{}{"params_def": def, "capabilities": caps, "kind": "image", "updated_time": now}).Error; err != nil {
					return errors.New("catalog update failed")
				}
			}
		} else {
			entry := source
			entry.Id = 0
			entry.ModelName = s.name
			entry.Description = s.name + " via ToAPIs"
			entry.Kind = "image"
			entry.SyncOfficial = 0
			entry.NameRule = model.NameRuleExact
			entry.CreatedTime = now
			entry.UpdatedTime = now
			entry.ParamsDef = def
			entry.Capabilities = caps
			if err := tx.Create(&entry).Error; err != nil {
				return errors.New("catalog insert failed")
			}
			// GORM default:1 otherwise turns explicit disabled source/sync_official=0 into 1.
			if err := tx.Model(&model.Model{}).Where("id = ?", entry.Id).Updates(map[string]interface{}{"status": source.Status, "sync_official": 0}).Error; err != nil {
				return errors.New("catalog state preservation failed")
			}
		}
		for _, group := range groups(before.Channel.Group) {
			exists := false
			enabled := before.Channel.Status == 1
			for _, a := range before.Abilities {
				if a.Group != group {
					continue
				}
				if a.Model == s.name {
					exists = true
				}
				if a.Model == s.source {
					enabled = enabled && a.Enabled
				}
			}
			if exists {
				continue
			}
			ability := model.Ability{Group: group, Model: s.name, ChannelId: before.Channel.ID, Enabled: enabled, Priority: before.Channel.Priority, Weight: before.Channel.Weight, Tag: before.Channel.Tag}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&ability).Error; err != nil {
				return errors.New("ability insert failed")
			}
		}
		prices[s.name] = s.price
	}
	var old map[string]float64
	_ = common.UnmarshalJsonStr(before.Options[0].Value, &old)
	if reflect.DeepEqual(old, prices) {
		return nil
	}
	encoded, err := common.Marshal(prices)
	if err != nil {
		return errors.New("price encoding failed")
	}
	if err := tx.Model(&model.Option{}).Where(&model.Option{Key: "ModelPrice"}).Update("value", string(encoded)).Error; err != nil {
		return errors.New("price merge failed")
	}
	return nil
}

func register(db *gorm.DB, id int, apply bool, backupDir string) (plan, error) {
	var p plan
	tx := db.Begin()
	if tx.Error != nil {
		return p, errors.New("database transaction could not start; connection details withheld")
	}
	defer tx.Rollback()
	err := func() error {
		before, err := readSnapshot(tx, id)
		if err != nil {
			return err
		}
		var catalog map[string]model.Model
		var prices map[string]float64
		p, catalog, prices, err = buildPlan(before)
		if err != nil {
			return err
		}
		if !apply || len(p.Actions) == 0 {
			return nil
		}
		p.Backup, err = writeBackup(backupDir, before)
		if err != nil {
			return err
		}
		if err := applyPlan(tx, before, catalog, prices); err != nil {
			return err
		}
		p.Applied = true
		return nil
	}()
	if err != nil {
		p.Applied = false
		return p, err
	}
	if err := tx.Commit().Error; err != nil {
		p.Applied = false
		return p, errors.New("database commit failed; transaction outcome must be checked")
	}
	return p, nil
}

func main() {
	driver := flag.String("driver", "postgres", "postgres, mysql or sqlite")
	apply := flag.Bool("apply", false, "apply registration (default: read-only plan)")
	id := flag.Int("channel-id", 31, "existing ToAPIs channel ID")
	backupDir := flag.String("backup-dir", "", "0700 directory for pre-change JSON backup; required with --apply")
	flag.Parse()
	if *apply && *backupDir == "" {
		fmt.Fprintln(os.Stderr, "--backup-dir required with --apply")
		os.Exit(1)
	}
	dsn := os.Getenv("SQL_DSN")
	if dsn == "" {
		fmt.Fprintln(os.Stderr, "SQL_DSN is required (credentials are not accepted as flags)")
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
	db, err := gorm.Open(dialector, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent), DisableAutomaticPing: true})
	if err != nil {
		fmt.Fprintln(os.Stderr, "database connection failed; connection details withheld")
		os.Exit(1)
	}
	p, err := register(db, *id, *apply, *backupDir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "registration failed:", err)
		os.Exit(1)
	}
	out, _ := common.Marshal(p)
	fmt.Println(string(out))
	if p.Applied {
		fmt.Println("Restart new-api after deployment to refresh catalog, channel and price caches.")
	}
}
