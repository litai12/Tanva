-- Ensure the current Seedance 2.5 snapshot is routable even when a previous
-- 2.5 catalog patch was skipped or its legacy ability is absent. The working
-- official 2.0 Ark ability is the only source of truth required here.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, capabilities, params_def, created_time, updated_time, name_rule
)
SELECT
  'doubao-seedance-2-5-260628',
  'VolcEngine Ark Seedance 2.5 (260628) video generation (480p / 720p)',
  icon, tags, vendor_id, endpoints, 'video', status, sync_official, capabilities, params_def,
  EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, name_rule
FROM models AS source
WHERE source.model_name = 'doubao-seedance-2-0-260128'
  AND source.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM models AS existing
    WHERE existing.model_name = 'doubao-seedance-2-5-260628' AND existing.deleted_at IS NULL
  );

UPDATE channels AS channel
SET models = CASE
  WHEN ',' || COALESCE(channel.models, '') || ',' LIKE '%,doubao-seedance-2-5-260628,%'
    THEN channel.models
  ELSE concat_ws(',', NULLIF(channel.models, ''), 'doubao-seedance-2-5-260628')
END
WHERE channel.id IN (
  SELECT ability.channel_id
  FROM abilities AS ability
  WHERE ability.model = 'doubao-seedance-2-0-260128' AND ability.enabled = true
);

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT ability."group", 'doubao-seedance-2-5-260628', ability.channel_id,
       true, ability.priority, ability.weight, ability.tag
FROM abilities AS ability
WHERE ability.model = 'doubao-seedance-2-0-260128' AND ability.enabled = true
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = true,
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
      (COALESCE(NULLIF(options.value, ''), '{}')::jsonb ->> 'doubao-seedance-2-0-260128')::numeric,
      15
    ) * 1.5
  )
)::text;

COMMIT;
