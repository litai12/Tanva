-- 002-apimart-add-gemini-3-5-flash.sql
-- Purpose: add the new chat-only model `gemini-3.5-flash` to the APIMart channel,
--          and price it per APIMart 定价（输入 $1.2/M、输出 $7.2/M）。
--
-- Background: banana(Pro) 对话档的文本模型从 gemini-3-flash-preview 切到
--   gemini-3.5-flash（后端 providerDefaultTextModels.banana / 前端
--   BANANA_PRO_TEXT_MODEL）。该模型仅对话能力(chat)，无图像/视频。新模型若不在
--   apimart 渠道的 models/abilities + ModelRatio 里，会以「供应商不可用」或
--   「模型价格未配置」失败。本 patch 复刻 001/004/006 的做法补齐。
--
-- Pricing（new-api 约定 ModelRatio = 美元/M ÷ 2；CompletionRatio = 输出/输入）：
--   ModelRatio      gemini-3.5-flash = 1.2 / 2 = 0.6
--   CompletionRatio gemini-3.5-flash = 7.2 / 1.2 = 6
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Seed chat model entry in the model catalog (base + -apimart alias).
-- ---------------------------------------------------------------------------

WITH chat_models(base_name, description) AS (VALUES
  ('gemini-3.5-flash', 'Gemini 3.5 Flash — banana Pro 对话(仅对话能力)')
),
all_forms AS (
  SELECT base_name AS model_name, description FROM chat_models
  UNION ALL
  SELECT base_name || '-apimart', description || ' (APIMart alias)' FROM chat_models
),
apimart_vendor AS (
  SELECT id FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL LIMIT 1
)
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT
  f.model_name, f.description, NULL, NULL, v.id, NULL, 'chat', 1, 0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
FROM all_forms AS f
CROSS JOIN apimart_vendor AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = f.model_name AND deleted_at IS NULL
);

-- Revive soft-deleted rows if any.
WITH all_forms(model_name) AS (VALUES
  ('gemini-3.5-flash'),
  ('gemini-3.5-flash-apimart')
),
apimart_vendor AS (
  SELECT id FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL LIMIT 1
)
UPDATE models AS target
SET kind         = 'chat',
    vendor_id    = v.id,
    status       = 1,
    deleted_at   = NULL,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM all_forms AS f
CROSS JOIN apimart_vendor AS v
WHERE target.model_name = f.model_name;

-- ---------------------------------------------------------------------------
-- Step 2: Merge model into apimart channel's models CSV.
-- ---------------------------------------------------------------------------

WITH new_models(model_name) AS (VALUES
  ('gemini-3.5-flash'),
  ('gemini-3.5-flash-apimart')
),
existing AS (
  SELECT channel.id, trim(item) AS model_name
  FROM channels AS channel
  CROSS JOIN LATERAL regexp_split_to_table(COALESCE(channel.models, ''), ',') AS item
  WHERE channel.name = 'apimart'
    AND channel.type = 59
    AND channel."group" = 'default'
),
combined AS (
  SELECT id, model_name FROM existing WHERE model_name <> ''
  UNION
  SELECT channel.id, nm.model_name
  FROM channels AS channel
  CROSS JOIN new_models AS nm
  WHERE channel.name = 'apimart'
    AND channel.type = 59
    AND channel."group" = 'default'
),
aggregated AS (
  SELECT id, string_agg(model_name, ',' ORDER BY model_name) AS models
  FROM combined
  GROUP BY id
)
UPDATE channels AS channel
SET models = aggregated.models
FROM aggregated
WHERE channel.id = aggregated.id;

-- ---------------------------------------------------------------------------
-- Step 3: Add -apimart alias → real-id mapping to model_mapping.
-- ---------------------------------------------------------------------------

UPDATE channels AS channel
SET model_mapping = (
  COALESCE(NULLIF(channel.model_mapping, '')::jsonb, '{}'::jsonb)
  || '{ "gemini-3.5-flash-apimart": "gemini-3.5-flash" }'::jsonb
)::text
WHERE channel.name = 'apimart'
  AND channel.type = 59
  AND channel."group" = 'default';

-- ---------------------------------------------------------------------------
-- Step 4: Enable abilities for default + auto + vip groups (mirror 001 & 004).
-- ---------------------------------------------------------------------------

WITH new_models(model_name) AS (VALUES
  ('gemini-3.5-flash'),
  ('gemini-3.5-flash-apimart')
),
ability_matrix AS (
  SELECT g.grp, nm.model_name
  FROM new_models AS nm
  CROSS JOIN (VALUES ('default'), ('auto'), ('vip')) AS g(grp)
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT am.grp, am.model_name, channel.id, true, 0, 0, 'apimart'
FROM ability_matrix AS am
JOIN channels AS channel
  ON channel.name = 'apimart'
 AND channel.type = 59
 AND channel."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = EXCLUDED.enabled,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

-- ---------------------------------------------------------------------------
-- Step 5: Pricing — ModelRatio 0.6 / CompletionRatio 6 (existing wins; 仅补缺失).
-- ---------------------------------------------------------------------------

UPDATE options
SET value = (
  '{"gemini-3.5-flash": 0.6, "gemini-3.5-flash-apimart": 0.6}'::jsonb
  || COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
)::text
WHERE key = 'ModelRatio';

UPDATE options
SET value = (
  '{"gemini-3.5-flash": 6, "gemini-3.5-flash-apimart": 6}'::jsonb
  || COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
)::text
WHERE key = 'CompletionRatio';

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------

\echo ''
\echo '----- gemini-3.5-flash in catalog -----'
SELECT model_name, kind, status
FROM models
WHERE model_name IN ('gemini-3.5-flash', 'gemini-3.5-flash-apimart')
  AND deleted_at IS NULL
ORDER BY model_name;

\echo ''
\echo '----- gemini-3.5-flash abilities -----'
SELECT a."group", a.model, a.enabled
FROM abilities AS a
JOIN channels AS c ON c.id = a.channel_id
WHERE c.name = 'apimart' AND c.type = 59
  AND a.model LIKE 'gemini-3.5-flash%'
ORDER BY a."group", a.model;

\echo ''
\echo '----- gemini-3.5-flash pricing -----'
SELECT
  (SELECT value::jsonb -> 'gemini-3.5-flash' FROM options WHERE key = 'ModelRatio')      AS model_ratio,
  (SELECT value::jsonb -> 'gemini-3.5-flash' FROM options WHERE key = 'CompletionRatio') AS completion_ratio;

COMMIT;
