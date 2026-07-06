-- 003-add-omni-flash-ext.sql
-- Purpose: add APIMart Omni-Flash-Ext video generation model to new-api.
--
-- API docs: https://docs.apimart.ai/cn/api-reference/videos/omni-flash-ext/generation
-- Endpoint: POST /v1/videos/generations (upstream model="Omni-Flash-Ext";
-- internal route key remains "omni-flash-ext")
--
-- Parameters:
--   duration     : 4 | 6 | 8 | 10 seconds (default 6)
--   resolution   : 720p | 1080p | 4k (default 720p)
--   aspect_ratio : 16:9 | 9:16 (default 16:9)
--   image_urls   : 0, 1, or 3 reference images (no 2-image support upstream)
--
-- Steps:
--   1. Insert omni-flash-ext + omni-flash-ext-apimart into models table.
--   2. Set kind=video + params_def.
--   3. Merge into APIMart channel models list + model_mapping.
--   4. Seed abilities (default, auto, vip groups).
--   5. Flat model_price fallback (720p × 6s ≈ 5 CNY).
--
-- Idempotent: INSERT ON CONFLICT DO NOTHING; UPDATE guarded by NOT LIKE check.
-- Scope: PostgreSQL only, data-only.

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: insert model entries ─────────────────────────────────────────────

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT m.model_name, m.description, NULL, NULL, v.id, NULL, 'video', 1, 0,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM (VALUES
  ('omni-flash-ext',        'APIMart Omni-Flash-Ext video generation — text/image to video'),
  ('omni-flash-ext-apimart','APIMart vendor-suffixed alias for omni-flash-ext')
) AS m(model_name, description)
CROSS JOIN (
  SELECT id FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL LIMIT 1
) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models AS existing
  WHERE existing.model_name = m.model_name AND existing.deleted_at IS NULL
);

-- ── Step 2: set kind + params_def ────────────────────────────────────────────
-- image_urls constraint (0/1/3) is enforced on the frontend; the upstream
-- silently ignores unknown combinations, so no hard guard needed here.

UPDATE models
SET kind         = 'video',
    params_def   = $json$[
      {"key":"duration","type":"enum","label":"时长","default":6,
       "options":[
         {"value":4,"label":"4s"},{"value":6,"label":"6s"},
         {"value":8,"label":"8s"},{"value":10,"label":"10s"}
       ]},
      {"key":"size","type":"enum","label":"画幅","default":"16:9",
       "options":[
         {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
         {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"}
       ]},
      {"key":"resolution","type":"enum","label":"分辨率","default":"720P",
       "options":[
         {"value":"720P","label":"720P"},
         {"value":"1080P","label":"1080P"},
         {"value":"4K","label":"4K"}
       ]}
    ]$json$,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('omni-flash-ext', 'omni-flash-ext-apimart')
  AND deleted_at IS NULL;

-- ── Step 3: add to APIMart channel ───────────────────────────────────────────

WITH new_models(model_name) AS (VALUES
  ('omni-flash-ext'),
  ('omni-flash-ext-apimart')
),
existing AS (
  SELECT channel.id, trim(item) AS model_name
  FROM channels AS channel
  CROSS JOIN LATERAL regexp_split_to_table(COALESCE(channel.models, ''), ',') AS item
  WHERE channel.name = 'apimart' AND channel.type = 59 AND channel."group" = 'default'
),
combined AS (
  SELECT id, model_name FROM existing WHERE model_name <> ''
  UNION
  SELECT channel.id, nm.model_name
  FROM channels AS channel
  CROSS JOIN new_models AS nm
  WHERE channel.name = 'apimart' AND channel.type = 59 AND channel."group" = 'default'
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

-- model_mapping: alias → real-id
UPDATE channels
SET model_mapping = (
  COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb)
  || '{"omni-flash-ext-apimart":"omni-flash-ext"}'::jsonb
)::text
WHERE name = 'apimart' AND type = 59 AND "group" = 'default';

-- ── Step 4: seed abilities (default + auto + vip) ────────────────────────────

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.grp, m.model_name, c.id, true, 0, 0, 'apimart'
FROM (VALUES
  ('omni-flash-ext'),
  ('omni-flash-ext-apimart')
) AS m(model_name)
CROSS JOIN (VALUES ('default'), ('auto'), ('vip')) AS g(grp)
JOIN channels AS c
  ON c.name = 'apimart' AND c.type = 59 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled = true,
      tag     = EXCLUDED.tag;

-- ── Step 5: flat model_price fallback ────────────────────────────────────────
-- 720P × 6s placeholder; adjust once APIMart publishes per-second pricing.

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{"omni-flash-ext": 5.0, "omni-flash-ext-apimart": 5.0}'
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

-- ── Verify ────────────────────────────────────────────────────────────────────

\echo '----- omni-flash-ext models after patch -----'
SELECT model_name, kind, status, params_def IS NOT NULL AS has_params_def
FROM models
WHERE model_name LIKE 'omni-flash-ext%'
  AND deleted_at IS NULL
ORDER BY model_name;

COMMIT;
