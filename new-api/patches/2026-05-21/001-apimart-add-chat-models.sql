-- 001-apimart-add-chat-models.sql
-- Purpose: add the four Gemini text/chat models that the Tanva backend
--          sends to new-api for AI对话 / Image Chat / 提示词优化.
--
-- Background: the old banana.provider.ts called APIMart directly for text
-- via apimartTextUrl + makeApimartTextRequest(). After the migration to
-- new-api single-track (AI_MODEL_SINGLE_TRACK defaults to 'new-api'),
-- the same model names are forwarded to new-api — but the apimart channel
-- only had image/video models, so all chat requests failed with
-- "供应商不可用".
--
-- Models added (real-id + -apimart alias form):
--   gemini-2.5-flash        — banana-2.5 Fast 对话默认模型
--   gemini-3-flash-preview  — banana Pro 对话 / tool-selection
--   gemini-3.1-pro          — 主力: 默认对话 / Image Chat / 提示词优化
--   gemini-3.1-pro-preview  — banana-3.1 Ultra 对话默认模型
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Seed chat model entries in the model catalog.
-- ---------------------------------------------------------------------------

WITH chat_models(base_name, description) AS (VALUES
  ('gemini-2.5-flash',       'Gemini 2.5 Flash — banana-2.5 Fast 对话'),
  ('gemini-3-flash-preview', 'Gemini 3 Flash Preview — banana Pro 对话 / tool-selection'),
  ('gemini-3.1-pro',         'Gemini 3.1 Pro — 主力对话 / Image Chat / 提示词优化'),
  ('gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview — banana-3.1 Ultra 对话')
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
WITH chat_models(base_name) AS (VALUES
  ('gemini-2.5-flash'),
  ('gemini-3-flash-preview'),
  ('gemini-3.1-pro'),
  ('gemini-3.1-pro-preview')
),
all_forms AS (
  SELECT base_name AS model_name FROM chat_models
  UNION ALL
  SELECT base_name || '-apimart' FROM chat_models
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
-- Step 2: Merge chat models into apimart channel's models CSV.
-- ---------------------------------------------------------------------------

WITH new_models(model_name) AS (VALUES
  ('gemini-2.5-flash'),
  ('gemini-2.5-flash-apimart'),
  ('gemini-3-flash-preview'),
  ('gemini-3-flash-preview-apimart'),
  ('gemini-3.1-pro'),
  ('gemini-3.1-pro-apimart'),
  ('gemini-3.1-pro-preview'),
  ('gemini-3.1-pro-preview-apimart')
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
-- Step 3: Add -apimart alias → real-id mappings to model_mapping.
-- ---------------------------------------------------------------------------

UPDATE channels AS channel
SET model_mapping = (
  COALESCE(NULLIF(channel.model_mapping, '')::jsonb, '{}'::jsonb)
  || '{
    "gemini-2.5-flash-apimart":       "gemini-2.5-flash",
    "gemini-3-flash-preview-apimart": "gemini-3-flash-preview",
    "gemini-3.1-pro-apimart":         "gemini-3.1-pro",
    "gemini-3.1-pro-preview-apimart": "gemini-3.1-pro-preview"
  }'::jsonb
)::text
WHERE channel.name = 'apimart'
  AND channel.type = 59
  AND channel."group" = 'default';

-- ---------------------------------------------------------------------------
-- Step 4: Enable abilities (default + auto groups).
-- ---------------------------------------------------------------------------

WITH new_models(model_name) AS (VALUES
  ('gemini-2.5-flash'),
  ('gemini-2.5-flash-apimart'),
  ('gemini-3-flash-preview'),
  ('gemini-3-flash-preview-apimart'),
  ('gemini-3.1-pro'),
  ('gemini-3.1-pro-apimart'),
  ('gemini-3.1-pro-preview'),
  ('gemini-3.1-pro-preview-apimart')
),
ability_matrix AS (
  SELECT g.grp, nm.model_name
  FROM new_models AS nm
  CROSS JOIN (VALUES ('default'), ('auto')) AS g(grp)
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
-- Verify
-- ---------------------------------------------------------------------------

\echo ''
\echo '----- APIMart chat models in catalog -----'
SELECT model_name, kind, status
FROM models
WHERE model_name IN (
  'gemini-2.5-flash',       'gemini-2.5-flash-apimart',
  'gemini-3-flash-preview', 'gemini-3-flash-preview-apimart',
  'gemini-3.1-pro',         'gemini-3.1-pro-apimart',
  'gemini-3.1-pro-preview', 'gemini-3.1-pro-preview-apimart'
)
  AND deleted_at IS NULL
ORDER BY model_name;

\echo ''
\echo '----- APIMart channel model count -----'
SELECT cardinality(regexp_split_to_array(models, ',')) AS model_count
FROM channels
WHERE name = 'apimart' AND type = 59 AND "group" = 'default';

\echo ''
\echo '----- APIMart chat abilities -----'
SELECT a."group", a.model, a.enabled
FROM abilities AS a
JOIN channels AS c ON c.id = a.channel_id
WHERE c.name = 'apimart' AND c.type = 59
  AND a.model IN (
    'gemini-2.5-flash', 'gemini-3-flash-preview',
    'gemini-3.1-pro',   'gemini-3.1-pro-preview'
  )
ORDER BY a."group", a.model;

COMMIT;
