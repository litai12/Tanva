package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// 额度展示类型
const (
	QuotaDisplayTypeUSD    = "USD"
	QuotaDisplayTypeCNY    = "CNY"
	QuotaDisplayTypeTokens = "TOKENS"
	QuotaDisplayTypeCustom = "CUSTOM"
)

type GeneralSetting struct {
	DocsLink            string `json:"docs_link"`
	PingIntervalEnabled bool   `json:"ping_interval_enabled"`
	PingIntervalSeconds int    `json:"ping_interval_seconds"`
	// 当前站点额度展示类型：USD / CNY / TOKENS
	QuotaDisplayType string `json:"quota_display_type"`
	// 自定义货币符号，用于 CUSTOM 展示类型
	CustomCurrencySymbol string `json:"custom_currency_symbol"`
	// 自定义货币与美元汇率（1 USD = X Custom）
	CustomCurrencyExchangeRate float64 `json:"custom_currency_exchange_rate"`
}

// 默认配置
var generalSetting = GeneralSetting{
	DocsLink:                   "/console/docs",
	PingIntervalEnabled:        false,
	PingIntervalSeconds:        60,
	QuotaDisplayType:           QuotaDisplayTypeCNY,
	CustomCurrencySymbol:       "¤",
	CustomCurrencyExchangeRate: 1.0,
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("general_setting", &generalSetting)
}

func GetGeneralSetting() *GeneralSetting {
	// This Tanva deployment stores RMB numbers directly. Ignore legacy display
	// preferences rather than relabeling or multiplying those numbers again.
	view := generalSetting
	view.QuotaDisplayType = QuotaDisplayTypeCNY
	return &view
}

// IsCurrencyDisplay Tanva 全站使用人民币金额展示。
func IsCurrencyDisplay() bool {
	return true
}

// IsCNYDisplay 是否以人民币展示
func IsCNYDisplay() bool {
	return true
}

// GetQuotaDisplayType 返回额度展示类型
func GetQuotaDisplayType() string {
	return QuotaDisplayTypeCNY
}

// GetCurrencySymbol 返回当前展示类型对应符号
func GetCurrencySymbol() string {
	return "¥"
}

// GetUsdToCurrencyRate 兼容旧接口；Tanva 人民币数字固定 1:1，不取市场汇率。
func GetUsdToCurrencyRate(usdToCny float64) float64 {
	return 1
}
