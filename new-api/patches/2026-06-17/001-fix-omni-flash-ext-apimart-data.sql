-- 001-fix-omni-flash-ext-apimart-data.sql
-- Purpose:
--   Repair APIMart Omni Flash Ext production data when the older 2026-05-21
--   patch was not applied, was applied before the APIMart channel existed, or
--   left the route unavailable in the default/auto/vip groups.
--
-- Runtime note:
--   new-api keeps the internal route key as `omni-flash-ext`; the APIMart
--   adaptor sends the upstream request body with model `Omni-Flash-Ext`
--   because the APIMart API is case-sensitive.
--
-- Scope:
--   - PostgreSQL only
--   - Data-only, idempotent / safe to re-run
--   - After applying, restart new-api or reload channels/abilities if memory
--     cache is enabled.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO vendors (name, description, icon, status, created_time, updated_time)
SELECT 'APIMart AI',
       'APIMart unified gateway - chat, image and video tasks',
       NULL, 1,
       EXTRACT(EPOCH FROM NOW())::bigint,
       EXTRACT(EPOCH FROM NOW())::bigint
WHERE NOT EXISTS (
  SELECT 1 FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL
);

UPDATE vendors
SET description = 'APIMart unified gateway - chat, image and video tasks',
    status = 1,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = 'APIMart AI' AND deleted_at IS NULL;

INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override
)
SELECT 'apimart', 59, 'default',
       'omni-flash-ext,omni-flash-ext-apimart',
       '{"omni-flash-ext-apimart":"omni-flash-ext"}',
       1, 'https://api.apimart.ai', 'PLACEHOLDER_APIMART_KEY',
       EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'apimart', NULL, NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'apimart' AND type = 59
);

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT m.model_name, m.description, NULL, NULL, v.id, NULL, 'video', 1, 0,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM (VALUES
  ('omni-flash-ext',         'APIMart Omni-Flash-Ext video generation - text/image/video to video'),
  ('omni-flash-ext-apimart', 'APIMart vendor-suffixed alias for omni-flash-ext')
) AS m(model_name, description)
CROSS JOIN (
  SELECT id FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL LIMIT 1
) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models AS existing
  WHERE existing.model_name = m.model_name AND existing.deleted_at IS NULL
);

UPDATE models
SET kind         = 'video',
    status       = 1,
    capabilities = '["reference_images","reference_video"]',
    params_def   = $json$[
      {"key":"duration","type":"enum","label":"Duration","default":6,
       "options":[
         {"value":4,"label":"4s"},{"value":6,"label":"6s"},
         {"value":8,"label":"8s"},{"value":10,"label":"10s"}
       ]},
      {"key":"size","type":"enum","label":"Aspect ratio","default":"16:9",
       "options":[
         {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
         {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"}
       ]},
      {"key":"resolution","type":"enum","label":"Resolution","default":"720p",
       "options":[
         {"value":"720p","label":"720p"},
         {"value":"1080p","label":"1080p"},
         {"value":"4k","label":"4K"}
       ]},
      {"key":"generation_type","type":"enum","label":"Mode","default":"frame",
       "options":[
         {"value":"frame","label":"Frame"},
         {"value":"reference","label":"Reference"}
       ]}
    ]$json$,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE deleted_at IS NULL
  AND model_name IN ('omni-flash-ext', 'omni-flash-ext-apimart');

WITH new_models(model_name) AS (
  VALUES ('omni-flash-ext'), ('omni-flash-ext-apimart')
),
target_channels AS (
  SELECT id
  FROM channels
  WHERE name = 'apimart'
    AND type = 59
    AND (
      "group" = 'default'
      OR "group" LIKE 'default,%'
      OR "group" LIKE '%,default,%'
      OR "group" LIKE '%,default'
    )
),
combined AS (
  SELECT c.id, trim(item) AS model_name
  FROM target_channels AS c
  JOIN channels AS channel ON channel.id = c.id
  CROSS JOIN LATERAL regexp_split_to_table(COALESCE(channel.models, ''), ',') AS item
  WHERE trim(item) <> ''
  UNION
  SELECT c.id, nm.model_name
  FROM target_channels AS c
  CROSS JOIN new_models AS nm
),
aggregated AS (
  SELECT id, string_agg(model_name, ',' ORDER BY model_name) AS models
  FROM combined
  GROUP BY id
)
UPDATE channels AS channel
SET models = aggregated.models,
    model_mapping = (
      COALESCE(NULLIF(channel.model_mapping, '')::jsonb, '{}'::jsonb)
      || '{"omni-flash-ext-apimart":"omni-flash-ext"}'::jsonb
    )::text,
    status = 1
FROM aggregated
WHERE channel.id = aggregated.id;

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT trim(g.grp), m.model_name, c.id, true,
       COALESCE(c.priority, 0), COALESCE(c.weight, 0), 'apimart'
FROM channels AS c
CROSS JOIN unnest(string_to_array(COALESCE(c."group", 'default'), ',')) AS g(grp)
CROSS JOIN (VALUES ('omni-flash-ext'), ('omni-flash-ext-apimart')) AS m(model_name)
WHERE c.name = 'apimart'
  AND c.type = 59
  AND trim(g.grp) <> ''
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = true,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.grp, m.model_name, c.id, true,
       COALESCE(c.priority, 0), COALESCE(c.weight, 0), 'apimart'
FROM (VALUES ('default'), ('auto'), ('vip')) AS g(grp)
CROSS JOIN (VALUES ('omni-flash-ext'), ('omni-flash-ext-apimart')) AS m(model_name)
JOIN channels AS c
  ON c.name = 'apimart' AND c.type = 59
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = true,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{"omni-flash-ext": 6.0, "omni-flash-ext-apimart": 6.0}'
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

\echo '----- omni-flash-ext APIMart rows after repair -----'
SELECT model_name, kind, status, params_def IS NOT NULL AS has_params_def
FROM models
WHERE model_name IN ('omni-flash-ext', 'omni-flash-ext-apimart')
  AND deleted_at IS NULL
ORDER BY model_name;

\echo '----- omni-flash-ext APIMart abilities after repair -----'
SELECT a."group", a.model, a.enabled, c.name AS channel_name, c.type AS channel_type
FROM abilities AS a
JOIN channels AS c ON c.id = a.channel_id
WHERE a.model IN ('omni-flash-ext', 'omni-flash-ext-apimart')
  AND c.name = 'apimart'
  AND c.type = 59
ORDER BY a."group", a.model;

COMMIT;
