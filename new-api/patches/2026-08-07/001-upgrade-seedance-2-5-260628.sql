-- Upgrade the Seedance 2.5 Ark snapshot to the currently published model ID.
-- This is deliberately additive: existing installations may already have the
-- former `doubao-seedance-2-5` catalog entry and task history.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, capabilities, params_def, created_time, updated_time, name_rule
)
SELECT
  'doubao-seedance-2-5-260628',
  'VolcEngine Ark Seedance 2.5 (260628) video generation (480p / 720p)',
  icon, tags, vendor_id, endpoints, kind, status, sync_official, capabilities, params_def,
  EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, name_rule
FROM models
WHERE model_name = 'doubao-seedance-2-5'
  AND deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM models
    WHERE model_name = 'doubao-seedance-2-5-260628' AND deleted_at IS NULL
  );

UPDATE models
SET description = 'VolcEngine Ark Seedance 2.5 (260628) video generation (480p / 720p)',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'doubao-seedance-2-5-260628' AND deleted_at IS NULL;

UPDATE channels AS channel
SET models = CASE
  WHEN ',' || COALESCE(channel.models, '') || ',' LIKE '%,doubao-seedance-2-5-260628,%'
    THEN channel.models
  ELSE concat_ws(',', NULLIF(channel.models, ''), 'doubao-seedance-2-5-260628')
END
WHERE channel.id IN (
  SELECT channel_id FROM abilities
  WHERE model = 'doubao-seedance-2-5' AND enabled = true
);

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT "group", 'doubao-seedance-2-5-260628', channel_id, enabled, priority, weight, tag
FROM abilities
WHERE model = 'doubao-seedance-2-5'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    priority = EXCLUDED.priority,
    weight = EXCLUDED.weight,
    tag = EXCLUDED.tag;

INSERT INTO options (key, value)
VALUES ('ModelPrice', '{"doubao-seedance-2-5-260628":15}')
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, ''), '{}')::jsonb
  || jsonb_build_object(
    'doubao-seedance-2-5-260628',
    COALESCE(
      (COALESCE(NULLIF(options.value, ''), '{}')::jsonb ->> 'doubao-seedance-2-5')::numeric,
      15
    )
  )
)::text;

COMMIT;
