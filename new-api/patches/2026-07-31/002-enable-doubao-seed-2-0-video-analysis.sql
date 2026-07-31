-- Enable the three official Doubao Seed 2.0 video-understanding models on the
-- managed ark-doubao channel and correct the gateway base-tier retail ratio.
--
-- Root cause fixed here:
-- 2026-05-14/001 only wrote options pricing. It did not add model catalog rows,
-- channel.models entries, or abilities, so distributor could still return
-- "No available channel ... under group default".
--
-- Commercial contract:
--   Tanva credits: 100 credits = RMB 1
--   retail price: VolcEngine official online-inference price × 1.5
--   ModelRatio below represents the official [0,32K] input tier:
--     Pro  ¥3.2/M × 0.75 = 2.40; output ratio 5
--     Lite ¥0.6/M × 0.75 = 0.45; output ratio 6
--     Mini ¥0.2/M × 0.75 = 0.15; output ratio 10
--   (0.75 = /1000 × USD(500) × retail markup(1.5))
--
-- Tanva backend performs the final user deduction from actual Responses usage,
-- including the official 32K/128K context tiers and audio/cache rates. This
-- flat gateway ratio remains the safe base-tier quota configuration.
--
-- PostgreSQL, data-only, idempotent. Existing ark-doubao credentials and
-- channel tuning are preserved.

\set ON_ERROR_STOP on

BEGIN;

-- Fail loudly instead of producing a successful-looking patch with zero
-- abilities when the managed production channel is absent or duplicated.
DO $$
DECLARE
  channel_count integer;
BEGIN
  SELECT count(*)
  INTO channel_count
  FROM channels
  WHERE name = 'ark-doubao'
    AND type = 45;

  IF channel_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one ark-doubao type=45 channel, found %',
      channel_count;
  END IF;
END
$$;

-- 1. Public model catalog.
WITH seed_models(model_name, description) AS (VALUES
  (
    'doubao-seed-2-0-mini-260428',
    'VolcEngine Doubao Seed 2.0 Mini multimodal video understanding'
  ),
  (
    'doubao-seed-2-0-lite-260428',
    'VolcEngine Doubao Seed 2.0 Lite multimodal video understanding'
  ),
  (
    'doubao-seed-2-0-pro-260215',
    'VolcEngine Doubao Seed 2.0 Pro multimodal video understanding'
  )
)
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule, capabilities, params_def
)
SELECT
  sm.model_name,
  sm.description,
  NULL,
  'volcengine,doubao,multimodal,video-understanding',
  NULL,
  '/v1/responses',
  'chat',
  1,
  0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0,
  '["text","video"]',
  '[{"key":"max_output_tokens","type":"integer","label":"Max output tokens","default":16384}]'
FROM seed_models AS sm
WHERE NOT EXISTS (
  SELECT 1
  FROM models AS existing
  WHERE existing.model_name = sm.model_name
    AND existing.deleted_at IS NULL
);

UPDATE models
SET
  kind = 'chat',
  status = 1,
  endpoints = '/v1/responses',
  capabilities = '["text","video"]',
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE deleted_at IS NULL
  AND model_name IN (
    'doubao-seed-2-0-mini-260428',
    'doubao-seed-2-0-lite-260428',
    'doubao-seed-2-0-pro-260215'
  );

-- 2. Persist the models on the established Ark channel. Do not create a
-- placeholder-key channel: production credentials must stay in ark-doubao.
WITH seed_models(model_name) AS (VALUES
  ('doubao-seed-2-0-mini-260428'),
  ('doubao-seed-2-0-lite-260428'),
  ('doubao-seed-2-0-pro-260215')
)
UPDATE channels AS channel
SET
  models = (
    SELECT string_agg(DISTINCT model_name, ',' ORDER BY model_name)
    FROM (
      SELECT trim(value) AS model_name
      FROM unnest(string_to_array(COALESCE(channel.models, ''), ',')) AS value
      UNION ALL
      SELECT sm.model_name
      FROM seed_models AS sm
    ) AS all_models
    WHERE model_name <> ''
  ),
  "group" = CASE
    WHEN 'default' = ANY (
      string_to_array(replace(COALESCE(channel."group", ''), ' ', ''), ',')
    )
      THEN channel."group"
    ELSE concat_ws(',', NULLIF(channel."group", ''), 'default')
  END
WHERE channel.name = 'ark-doubao'
  AND channel.type = 45;

-- 3. Distributor routing abilities for every group declared by ark-doubao.
WITH seed_models(model_name) AS (VALUES
  ('doubao-seed-2-0-mini-260428'),
  ('doubao-seed-2-0-lite-260428'),
  ('doubao-seed-2-0-pro-260215')
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT
  trim(channel_group.grp),
  sm.model_name,
  channel.id,
  (channel.status = 1),
  COALESCE(channel.priority, 0),
  COALESCE(channel.weight, 0),
  channel.tag
FROM channels AS channel
CROSS JOIN LATERAL (
  SELECT trim(value) AS grp
  FROM unnest(
    string_to_array(COALESCE(channel."group", ''), ',')
  ) AS value
  WHERE trim(value) <> ''
  UNION
  SELECT 'default'
) AS channel_group
CROSS JOIN seed_models AS sm
WHERE channel.name = 'ark-doubao'
  AND channel.type = 45
  AND trim(channel_group.grp) <> ''
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET
  enabled = EXCLUDED.enabled,
  priority = EXCLUDED.priority,
  weight = EXCLUDED.weight,
  tag = EXCLUDED.tag;

-- 4. Correct the old ×1.2 base-tier ratios to official ×1.5.
INSERT INTO options (key, value)
VALUES (
  'ModelRatio',
  '{
    "doubao-seed-2-0-pro-260215":2.4,
    "doubao-seed-2.0-pro":2.4,
    "doubao-seed-2-0-lite-260428":0.45,
    "doubao-seed-2-0-lite-260215":0.45,
    "doubao-seed-2.0-lite":0.45,
    "doubao-seed-2-0-mini-260428":0.15,
    "doubao-seed-2.0-mini":0.15
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, ''), '{}')::jsonb
  || EXCLUDED.value::jsonb
)::text;

INSERT INTO options (key, value)
VALUES (
  'CompletionRatio',
  '{
    "doubao-seed-2-0-pro-260215":5,
    "doubao-seed-2.0-pro":5,
    "doubao-seed-2-0-lite-260428":6,
    "doubao-seed-2-0-lite-260215":6,
    "doubao-seed-2.0-lite":6,
    "doubao-seed-2-0-mini-260428":10,
    "doubao-seed-2.0-mini":10
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, ''), '{}')::jsonb
  || EXCLUDED.value::jsonb
)::text;

INSERT INTO options (key, value)
VALUES (
  'CacheRatio',
  '{
    "doubao-seed-2-0-pro-260215":0.2,
    "doubao-seed-2.0-pro":0.2,
    "doubao-seed-2-0-lite-260428":0.2,
    "doubao-seed-2-0-lite-260215":0.2,
    "doubao-seed-2.0-lite":0.2,
    "doubao-seed-2-0-mini-260428":0.2,
    "doubao-seed-2.0-mini":0.2
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, ''), '{}')::jsonb
  || EXCLUDED.value::jsonb
)::text;

INSERT INTO options (key, value)
VALUES (
  'AudioRatio',
  '{
    "doubao-seed-2-0-lite-260428":15,
    "doubao-seed-2-0-lite-260215":15,
    "doubao-seed-2.0-lite":15,
    "doubao-seed-2-0-mini-260428":15,
    "doubao-seed-2.0-mini":15
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, ''), '{}')::jsonb
  || EXCLUDED.value::jsonb
)::text;

-- These are token-billed models. Remove any accidental fixed-price override.
UPDATE options
SET value = (
  COALESCE(NULLIF(value, ''), '{}')::jsonb
  - 'doubao-seed-2-0-mini-260428'
  - 'doubao-seed-2-0-lite-260428'
  - 'doubao-seed-2-0-pro-260215'
)::text
WHERE key = 'ModelPrice';

COMMIT;

\echo '----- Doubao Seed 2.0 catalog / ark-doubao abilities -----'
SELECT model_name, kind, status, endpoints, capabilities
FROM models
WHERE deleted_at IS NULL
  AND model_name IN (
    'doubao-seed-2-0-mini-260428',
    'doubao-seed-2-0-lite-260428',
    'doubao-seed-2-0-pro-260215'
  )
ORDER BY model_name;

SELECT id, name, type, status, "group", models
FROM channels
WHERE name = 'ark-doubao'
  AND type = 45;

SELECT
  channel.name AS channel_name,
  ability."group",
  ability.model,
  ability.enabled,
  ability.priority,
  ability.weight
FROM abilities AS ability
JOIN channels AS channel ON channel.id = ability.channel_id
WHERE channel.name = 'ark-doubao'
  AND channel.type = 45
  AND ability.model IN (
    'doubao-seed-2-0-mini-260428',
    'doubao-seed-2-0-lite-260428',
    'doubao-seed-2-0-pro-260215'
  )
ORDER BY ability."group", ability.model;

\echo '----- Doubao Seed 2.0 corrected base-tier pricing -----'
SELECT
  value::jsonb -> 'doubao-seed-2-0-mini-260428' AS mini
FROM options
WHERE key = 'ModelRatio';

SELECT
  value::jsonb -> 'doubao-seed-2-0-lite-260428' AS lite
FROM options
WHERE key = 'ModelRatio';

SELECT
  value::jsonb -> 'doubao-seed-2-0-pro-260215' AS pro
FROM options
WHERE key = 'ModelRatio';
