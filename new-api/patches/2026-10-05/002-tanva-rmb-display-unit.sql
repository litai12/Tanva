-- Tanva deployment only. Explicitly authorized RMB display with numeric 1:1.
-- Does not change any model price/ratio, quotas, wallets, channels or keys.
-- Existing top-up group ratios and discounts are preserved.
BEGIN;
INSERT INTO options (key, value)
VALUES
  ('general_setting.quota_display_type', 'CNY'),
  ('USDExchangeRate', '1'),
  ('Price', '1')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
COMMIT;
