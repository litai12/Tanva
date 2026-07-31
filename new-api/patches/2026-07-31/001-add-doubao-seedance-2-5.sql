-- Register the official VolcEngine Ark Seedance 2.5 model.
--
-- Product contract:
--   model id: doubao-seedance-2-5
--   resolutions: 480p / 720p
--   Tanva retail price: 1.5x the matching Seedance 2.0 per-second tier
--
-- The request shape and routing channel are inherited from the working
-- doubao-seedance-2-0-260128 ability. PostgreSQL, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- 1. Create the model catalog row from the working Seedance 2.0 row.
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT
  'doubao-seedance-2-5',
  'VolcEngine Ark Seedance 2.5 video generation (480p / 720p)',
  m.icon, m.tags, m.vendor_id, m.endpoints, 'video', m.status, m.sync_official,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  m.name_rule
FROM models AS m
WHERE m.model_name = 'doubao-seedance-2-0-260128'
  AND m.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM models AS existing
    WHERE existing.model_name = 'doubao-seedance-2-5'
      AND existing.deleted_at IS NULL
  );

-- 2. Pin the public capability metadata. Duration/mode semantics follow the
-- existing Seedance 2.x request path; the output resolution set is narrower.
UPDATE models
SET
  description = 'VolcEngine Ark Seedance 2.5 video generation (480p / 720p)',
  kind = 'video',
  status = 1,
  capabilities = '["reference_images"]',
  params_def = $json$[
    {"key":"duration","type":"enum","label":"时长","default":5,
     "options":[
       {"value":4,"label":"4s"},{"value":5,"label":"5s"},{"value":6,"label":"6s"},
       {"value":7,"label":"7s"},{"value":8,"label":"8s"},{"value":9,"label":"9s"},
       {"value":10,"label":"10s"},{"value":11,"label":"11s"},{"value":12,"label":"12s"},
       {"value":13,"label":"13s"},{"value":14,"label":"14s"},{"value":15,"label":"15s"}
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
     "options":[
       {"value":"480p","label":"480p"},{"value":"720p","label":"720p"}
     ]}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'doubao-seedance-2-5'
  AND deleted_at IS NULL;

-- 3. Add the model to every official Ark channel already serving Seedance 2.0.
UPDATE channels AS channel
SET models = CASE
  WHEN ',' || COALESCE(channel.models, '') || ',' LIKE '%,doubao-seedance-2-5,%'
    THEN channel.models
  ELSE concat_ws(',', NULLIF(channel.models, ''), 'doubao-seedance-2-5')
END
WHERE channel.id IN (
  SELECT ability.channel_id
  FROM abilities AS ability
  WHERE ability.model = 'doubao-seedance-2-0-260128'
    AND ability.enabled = true
);

-- 4. Clone routing abilities, preserving group/priority/weight/tag.
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT
  ability."group",
  'doubao-seedance-2-5',
  ability.channel_id,
  ability.enabled,
  ability.priority,
  ability.weight,
  ability.tag
FROM abilities AS ability
WHERE ability.model = 'doubao-seedance-2-0-260128'
  AND ability.enabled = true
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET
  enabled = EXCLUDED.enabled,
  priority = EXCLUDED.priority,
  weight = EXCLUDED.weight,
  tag = EXCLUDED.tag;

-- 5. new-api's flat routing gate follows the same 1.5x relationship. Actual
-- duration × resolution billing is calculated by Tanva's managed pricing book.
INSERT INTO options (key, value)
VALUES ('ModelPrice', '{"doubao-seedance-2-5":15}')
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, ''), '{}')::jsonb
  || jsonb_build_object(
    'doubao-seedance-2-5',
    COALESCE(
      (
        COALESCE(NULLIF(options.value, ''), '{}')::jsonb
        ->> 'doubao-seedance-2-0-260128'
      )::numeric,
      10
    ) * 1.5
  )
)::text;

COMMIT;

\echo '----- Seedance 2.5 model / channel abilities -----'
SELECT model_name, kind, status
FROM models
WHERE model_name = 'doubao-seedance-2-5'
  AND deleted_at IS NULL;

SELECT "group", model, channel_id, enabled, priority, weight
FROM abilities
WHERE model = 'doubao-seedance-2-5'
ORDER BY channel_id, "group";

\echo '----- Seedance 2.5 flat routing price -----'
SELECT value::jsonb -> 'doubao-seedance-2-5' AS model_price
FROM options
WHERE key = 'ModelPrice';
