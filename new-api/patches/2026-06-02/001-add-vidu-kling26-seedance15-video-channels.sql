-- 001-add-vidu-kling26-seedance15-video-channels.sql
-- Purpose: wire three previously-unrouted video models so the Tanva VIDU /
--   Kling 2.6 / Seedance 1.5-pro nodes work after the new-api migration.
--
--   * VIDU      -> apimart channel: business ids vidu-q3 / vidu-q2 mapped to
--                  upstream viduq3 / viduq2 (the apimart `model` strings).
--   * Kling 2.6 -> apimart channel: kling-v2-6 (real upstream id, no remap).
--   * Seedance 1.5-pro -> ark-doubao-video channel (direct VolcEngine):
--                  doubao-seedance-1-5-pro-251215 (snapshot id, in the doubao
--                  adaptor ModelList).
--
-- Why each piece is required:
--   - models.kind='video' for the UPSTREAM id (viduq3/viduq2/kling-v2-6/
--     doubao-seedance-1-5-pro-251215) — apimart.SubmitPath + GetModelKind read
--     modelKindMap[UpstreamModelName]; an empty kind hard-fails the request.
--   - channels.model_mapping vidu-q3->viduq3 / vidu-q2->viduq2 so the billable
--     business id is rewritten to the apimart upstream string.
--   - abilities rows are the actual routing gate.
--   - params_def drives the new-api admin UI parameter metadata.
--
-- Pricing: vidu-q3 / kling-v2-6 already priced; vidu-q2 and
--   doubao-seedance-1-5-pro-251215 dynamic rates are added in model/pricing.go
--   (mirroring analogs — operator should verify). Flat ModelPrice fallbacks
--   are seeded below.
--
-- Scope: PostgreSQL only, data-only, idempotent. Mirrors 2026-04-22/008.

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: Seed models rows (kind=video) for business + upstream forms.
--   vendor_id is copied from an existing analog so we don't create orphans.
-- -----------------------------------------------------------------------------

WITH apimart_vendor AS (
  SELECT id FROM vendors WHERE name = 'APIMart AI' AND deleted_at IS NULL LIMIT 1
),
doubao_vendor AS (
  SELECT vendor_id AS id FROM models
  WHERE model_name = 'doubao-seedance-2-0-260128' AND deleted_at IS NULL
  LIMIT 1
),
new_models(model_name, kind, vendor_kind) AS (VALUES
  ('vidu-q3',                        'video', 'apimart'),
  ('vidu-q2',                        'video', 'apimart'),
  ('viduq3',                         'video', 'apimart'),
  ('viduq2',                         'video', 'apimart'),
  ('vidu-q2-apimart',                'video', 'apimart'),
  ('kling-v2-6',                     'video', 'apimart'),
  ('kling-v2-6-apimart',             'video', 'apimart'),
  ('doubao-seedance-1-5-pro-251215', 'video', 'doubao')
)
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT n.model_name,
       'Tanva video model ' || n.model_name,
       NULL, NULL,
       CASE WHEN n.vendor_kind = 'doubao'
            THEN (SELECT id FROM doubao_vendor)
            ELSE (SELECT id FROM apimart_vendor) END,
       NULL, n.kind, 1, 0,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM new_models AS n
WHERE NOT EXISTS (
  SELECT 1 FROM models AS m
  WHERE m.model_name = n.model_name AND m.deleted_at IS NULL
);

-- Force kind=video on re-runs (rows may pre-exist from pricing-only patches
-- with an empty kind, which would break apimart.SubmitPath / GetModelKind).
UPDATE models AS m
SET kind = 'video', status = 1, updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE m.deleted_at IS NULL
  AND m.model_name IN (
    'vidu-q3','vidu-q2','viduq3','viduq2','vidu-q2-apimart',
    'kling-v2-6','kling-v2-6-apimart','doubao-seedance-1-5-pro-251215'
  );

-- -----------------------------------------------------------------------------
-- Step 2: params_def (video parameter metadata).
--   Specs verified against docs.apimart.ai (2026-06).
-- -----------------------------------------------------------------------------

-- vidu-q3: duration 3-16, size 16:9/9:16/4:3/3:4/1:1, res 540p/720p/1080p
UPDATE models SET
  kind = 'video', capabilities = '["reference_images","first_last_frame"]',
  params_def = $json$[
    {"key":"duration","type":"enum","label":"时长","default":5,
     "options":[
       {"value":3,"label":"3s"},{"value":4,"label":"4s"},{"value":5,"label":"5s"},
       {"value":6,"label":"6s"},{"value":7,"label":"7s"},{"value":8,"label":"8s"},
       {"value":9,"label":"9s"},{"value":10,"label":"10s"},{"value":11,"label":"11s"},
       {"value":12,"label":"12s"},{"value":13,"label":"13s"},{"value":14,"label":"14s"},
       {"value":15,"label":"15s"},{"value":16,"label":"16s"}
     ]},
    {"key":"size","type":"enum","label":"画幅","default":"16:9",
     "options":[
       {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
       {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"},
       {"value":"4:3","label":"4:3","aspectRatio":"4:3"},
       {"value":"3:4","label":"3:4","aspectRatio":"3:4"},
       {"value":"1:1","label":"1:1","aspectRatio":"1:1"}
     ]},
    {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
     "options":[{"value":"540p","label":"540p"},{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"}]}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'vidu-q3' AND deleted_at IS NULL;

-- vidu-q2: duration 1-8, size 16:9/9:16/1:1, res 720p/1080p
UPDATE models SET
  kind = 'video', capabilities = '["reference_images","first_last_frame"]',
  params_def = $json$[
    {"key":"duration","type":"enum","label":"时长","default":4,
     "options":[
       {"value":1,"label":"1s"},{"value":2,"label":"2s"},{"value":3,"label":"3s"},
       {"value":4,"label":"4s"},{"value":5,"label":"5s"},{"value":6,"label":"6s"},
       {"value":7,"label":"7s"},{"value":8,"label":"8s"}
     ]},
    {"key":"size","type":"enum","label":"画幅","default":"16:9",
     "options":[
       {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
       {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"},
       {"value":"1:1","label":"1:1","aspectRatio":"1:1"}
     ]},
    {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
     "options":[{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"}]}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'vidu-q2' AND deleted_at IS NULL;

-- kling-v2-6: duration 5/10, mode std/pro, size 16:9/9:16/1:1, res 720p/1080p
UPDATE models SET
  kind = 'video', capabilities = '["reference_images","first_last_frame"]',
  params_def = $json$[
    {"key":"duration","type":"enum","label":"时长","default":5,
     "options":[{"value":5,"label":"5s"},{"value":10,"label":"10s"}]},
    {"key":"mode","type":"enum","label":"模式","default":"std",
     "options":[{"value":"std","label":"标准"},{"value":"pro","label":"专家"}]},
    {"key":"size","type":"enum","label":"画幅","default":"16:9",
     "options":[
       {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
       {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"},
       {"value":"1:1","label":"1:1","aspectRatio":"1:1"}
     ]},
    {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
     "options":[{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"}]}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'kling-v2-6' AND deleted_at IS NULL;

-- doubao-seedance-1-5-pro-251215: duration 4-12 (def 5), size 6 ratios incl 21:9, res 480p/720p/1080p
UPDATE models SET
  kind = 'video', capabilities = '["reference_images"]',
  params_def = $json$[
    {"key":"duration","type":"enum","label":"时长","default":5,
     "options":[
       {"value":4,"label":"4s"},{"value":5,"label":"5s"},{"value":6,"label":"6s"},
       {"value":7,"label":"7s"},{"value":8,"label":"8s"},{"value":9,"label":"9s"},
       {"value":10,"label":"10s"},{"value":11,"label":"11s"},{"value":12,"label":"12s"}
     ]},
    {"key":"size","type":"enum","label":"画幅","default":"16:9",
     "options":[
       {"value":"21:9","label":"21:9","aspectRatio":"21:9","orientation":"landscape"},
       {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
       {"value":"4:3","label":"4:3","aspectRatio":"4:3","orientation":"landscape"},
       {"value":"1:1","label":"1:1","aspectRatio":"1:1"},
       {"value":"3:4","label":"3:4","aspectRatio":"3:4","orientation":"portrait"},
       {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"}
     ]},
    {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
     "options":[{"value":"480p","label":"480p"},{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"}]}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'doubao-seedance-1-5-pro-251215' AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Step 3: apimart channel — add vidu / kling-v2-6 to models + model_mapping.
-- -----------------------------------------------------------------------------

UPDATE channels AS c
SET models = CASE
      WHEN c.models LIKE '%vidu-q3%' THEN c.models
      ELSE c.models || ',vidu-q3,vidu-q2,viduq3,viduq2,vidu-q2-apimart,kling-v2-6,kling-v2-6-apimart'
    END,
    model_mapping = (
      COALESCE(NULLIF(c.model_mapping, ''), '{}')::jsonb
      || $json${
        "vidu-q3": "viduq3",
        "vidu-q2": "viduq2",
        "vidu-q2-apimart": "viduq2",
        "kling-v2-6-apimart": "kling-v2-6"
      }$json$::jsonb
    )::text
WHERE c.name = 'apimart' AND c.type = 59;

-- -----------------------------------------------------------------------------
-- Step 4: ark-doubao-video channel — add Seedance 1.5-pro snapshot id.
-- -----------------------------------------------------------------------------

UPDATE channels AS c
SET models = CASE
      WHEN c.models LIKE '%doubao-seedance-1-5-pro-251215%' THEN c.models
      ELSE c.models || ',doubao-seedance-1-5-pro-251215'
    END
WHERE c.name = 'ark-doubao-video' AND c.type = 54;

-- -----------------------------------------------------------------------------
-- Step 5: abilities (default + auto) for every requestable business id.
-- -----------------------------------------------------------------------------

WITH ability_seed(model, channel_name, channel_type) AS (VALUES
  ('vidu-q3',                        'apimart',          59),
  ('vidu-q2',                        'apimart',          59),
  ('vidu-q2-apimart',                'apimart',          59),
  ('kling-v2-6',                     'apimart',          59),
  ('kling-v2-6-apimart',             'apimart',          59),
  -- Seedance routes to the official ark-doubao-video channel (snapshot ids).
  -- These are listed in channels.models but had no ability rows (the routing
  -- gate), so the distributor could never pick ark for them.
  ('doubao-seedance-1-5-pro-251215', 'ark-doubao-video', 54),
  ('doubao-seedance-2-0-260128',     'ark-doubao-video', 54),
  ('doubao-seedance-2-0-fast-260128','ark-doubao-video', 54)
),
matrix AS (
  SELECT s.model, s.channel_name, s.channel_type, g.ability_group
  FROM ability_seed AS s
  CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT mx.ability_group, mx.model, c.id, true, 0, 0, c.tag
FROM matrix AS mx
JOIN channels AS c
  ON c.name = mx.channel_name AND c.type = mx.channel_type AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled;

-- -----------------------------------------------------------------------------
-- Step 6: flat ModelPrice fallbacks (RMB). Dynamic per-second rates live in
--   model/pricing.go; these are belt-and-suspenders for the new ids.
--   Existing DB entries win (admin overrides survive).
-- -----------------------------------------------------------------------------

INSERT INTO options (key, value) VALUES (
  'ModelPrice',
  $json${
    "vidu-q2": 1.25,
    "viduq2": 1.25,
    "doubao-seedance-1-5-pro-251215": 6.0
  }$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

COMMIT;
