-- Add the official DeepSeek channel and route legacy DeepSeek model names to
-- DeepSeek V4.1 Flash. The upstream API model name is deepseek-flash.
-- The API key is injected by patches/_apply.sh as the psql variable
-- :deepseek_key and is intentionally not stored in this repository.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Register the canonical model in the model catalog.
-- ----------------------------------------------------------------------------

INSERT INTO models (
  model_name,
  description,
  endpoints,
  kind,
  capabilities,
  params_def,
  status,
  sync_official,
  created_time,
  updated_time,
  name_rule
)
SELECT
  'deepseek-v4.1-flash',
  'DeepSeek V4.1 Flash via the official DeepSeek API (upstream: deepseek-flash)',
  '/v1/chat/completions',
  'text',
  '["text","vision","tool_calls"]',
  '[]',
  1,
  0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
WHERE NOT EXISTS (
  SELECT 1
  FROM models
  WHERE model_name = 'deepseek-v4.1-flash'
    AND deleted_at IS NULL
);

UPDATE models
SET
  description = 'DeepSeek V4.1 Flash via the official DeepSeek API (upstream: deepseek-flash)',
  endpoints = '/v1/chat/completions',
  kind = 'text',
  capabilities = '["text","vision","tool_calls"]',
  params_def = '[]',
  status = 1,
  sync_official = 0,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint,
  name_rule = 0
WHERE model_name = 'deepseek-v4.1-flash'
  AND deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. Upsert the official OpenAI-compatible DeepSeek channel.
-- ----------------------------------------------------------------------------

WITH channel_seed AS (
  SELECT
    'deepseek-official'::text AS name,
    43::int AS channel_type,
    'default'::text AS channel_group,
    'deepseek-v4.1-flash,deepseek-flash,deepseek-chat,deepseek-reasoner,deepseek-v3.2,deepseek-v4-flash,deepseek-v4-flash-260425,deepseek-v4-flash-vision-exp,deepseek-v4-pro,deepseek-v4-pro-260425'::text AS models,
    '{"deepseek-v4.1-flash":"deepseek-flash","deepseek-flash":"deepseek-flash","deepseek-chat":"deepseek-flash","deepseek-reasoner":"deepseek-flash","deepseek-v3.2":"deepseek-flash","deepseek-v4-flash":"deepseek-flash","deepseek-v4-flash-260425":"deepseek-flash","deepseek-v4-flash-vision-exp":"deepseek-flash","deepseek-v4-pro":"deepseek-flash","deepseek-v4-pro-260425":"deepseek-flash"}'::text AS model_mapping,
    1::int AS status,
    'https://api.deepseek.com'::text AS base_url,
    :deepseek_key AS api_key,
    1000::bigint AS priority,
    100::int AS weight,
    'deepseek-official'::text AS tag
)
INSERT INTO channels (
  type,
  name,
  "group",
  models,
  model_mapping,
  status,
  base_url,
  key,
  created_time,
  test_time,
  priority,
  weight,
  tag
)
SELECT
  channel_type,
  name,
  channel_group,
  models,
  model_mapping,
  status,
  base_url,
  api_key,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0,
  priority,
  weight,
  tag
FROM channel_seed
WHERE NOT EXISTS (
  SELECT 1
  FROM channels
  WHERE name = 'deepseek-official'
    AND type = 43
    AND "group" = 'default'
);

WITH channel_seed AS (
  SELECT
    'deepseek-official'::text AS name,
    43::int AS channel_type,
    'default'::text AS channel_group,
    'deepseek-v4.1-flash,deepseek-flash,deepseek-chat,deepseek-reasoner,deepseek-v3.2,deepseek-v4-flash,deepseek-v4-flash-260425,deepseek-v4-flash-vision-exp,deepseek-v4-pro,deepseek-v4-pro-260425'::text AS models,
    '{"deepseek-v4.1-flash":"deepseek-flash","deepseek-flash":"deepseek-flash","deepseek-chat":"deepseek-flash","deepseek-reasoner":"deepseek-flash","deepseek-v3.2":"deepseek-flash","deepseek-v4-flash":"deepseek-flash","deepseek-v4-flash-260425":"deepseek-flash","deepseek-v4-flash-vision-exp":"deepseek-flash","deepseek-v4-pro":"deepseek-flash","deepseek-v4-pro-260425":"deepseek-flash"}'::text AS model_mapping,
    1::int AS status,
    'https://api.deepseek.com'::text AS base_url,
    :deepseek_key AS api_key,
    1000::bigint AS priority,
    100::int AS weight,
    'deepseek-official'::text AS tag
)
UPDATE channels AS target
SET
  models = source.models,
  model_mapping = source.model_mapping,
  status = source.status,
  base_url = source.base_url,
  key = source.api_key,
  priority = source.priority,
  weight = source.weight,
  tag = source.tag
FROM channel_seed AS source
WHERE target.name = source.name
  AND target.type = source.channel_type
  AND target."group" = source.channel_group;

-- Disable the same public model aliases on other channels so selection cannot
-- fall back to the old proxy/Ark DeepSeek credentials.
UPDATE abilities AS ability
SET enabled = false
FROM channels AS channel
WHERE ability.channel_id = channel.id
  AND NOT (
    channel.name = 'deepseek-official'
    AND channel.type = 43
    AND channel."group" = 'default'
  )
  AND ability.model IN (
    'deepseek-v4.1-flash',
    'deepseek-flash',
    'deepseek-chat',
    'deepseek-reasoner',
    'deepseek-v3.2',
    'deepseek-v4-flash',
    'deepseek-v4-flash-260425',
    'deepseek-v4-flash-vision-exp',
    'deepseek-v4-pro',
    'deepseek-v4-pro-260425'
  );

WITH ability_seed(ability_group, model_name) AS (
  VALUES
    ('default', 'deepseek-v4.1-flash'),
    ('auto', 'deepseek-v4.1-flash'),
    ('vip', 'deepseek-v4.1-flash'),
    ('svip', 'deepseek-v4.1-flash'),
    ('codex', 'deepseek-v4.1-flash')
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT
  seed.ability_group,
  seed.model_name,
  channel.id,
  true,
  1000,
  100,
  'deepseek-official'
FROM ability_seed AS seed
JOIN channels AS channel
  ON channel.name = 'deepseek-official'
 AND channel.type = 43
 AND channel."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET
  enabled = EXCLUDED.enabled,
  priority = EXCLUDED.priority,
  weight = EXCLUDED.weight,
  tag = EXCLUDED.tag;

-- Keep gateway billing aligned with DeepSeek's official peak-period rates:
-- $0.30/M input, $1.20/M output, and $0.006/M cache-hit input.
INSERT INTO options (key, value)
VALUES
  ('ModelRatio', '{"deepseek-v4.1-flash":0.15,"deepseek-flash":0.15,"deepseek-chat":0.15,"deepseek-reasoner":0.15,"deepseek-v3.2":0.15,"deepseek-v4-flash":0.15,"deepseek-v4-flash-260425":0.15,"deepseek-v4-flash-vision-exp":0.15,"deepseek-v4-pro":0.15,"deepseek-v4-pro-260425":0.15}'),
  ('CompletionRatio', '{"deepseek-v4.1-flash":4,"deepseek-flash":4,"deepseek-chat":4,"deepseek-reasoner":4,"deepseek-v3.2":4,"deepseek-v4-flash":4,"deepseek-v4-flash-260425":4,"deepseek-v4-flash-vision-exp":4,"deepseek-v4-pro":4,"deepseek-v4-pro-260425":4}'),
  ('CacheRatio', '{"deepseek-v4.1-flash":0.02,"deepseek-flash":0.02,"deepseek-chat":0.02,"deepseek-reasoner":0.02,"deepseek-v3.2":0.02,"deepseek-v4-flash":0.02,"deepseek-v4-flash-260425":0.02,"deepseek-v4-flash-vision-exp":0.02,"deepseek-v4-pro":0.02,"deepseek-v4-pro-260425":0.02}')
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, ''), '{}')::jsonb || EXCLUDED.value::jsonb
)::text;

COMMIT;
