-- Add VolcEngine Ark DeepSeek models.

BEGIN;

INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 45, 'ark-deepseek', 'default',
  'deepseek-v4-flash-260425,deepseek-v4-pro-260425',
  NULL, 1, 'https://ark.cn-beijing.volces.com', 'PLACEHOLDER_ARK_API_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 10, 100, 'ark-deepseek', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'ark-deepseek' AND type = 45);

INSERT INTO options (key, value)
VALUES (
  'ModelRatio',
  '{
    "deepseek-v4-flash-260425": 0.684931506849315,
    "deepseek-v4-pro-260425": 0.821917808219178
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

INSERT INTO options (key, value)
VALUES (
  'CompletionRatio',
  '{
    "deepseek-v4-flash-260425": 2,
    "deepseek-v4-pro-260425": 2
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

COMMIT;
