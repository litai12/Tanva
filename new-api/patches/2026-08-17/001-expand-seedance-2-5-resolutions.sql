-- Expand the current Seedance 2.5 Ark catalog entry to the same output
-- resolution tiers exposed by Tanva for the standard Seedance 2.0 model.

\set ON_ERROR_STOP on

BEGIN;

UPDATE models
SET
  description = 'VolcEngine Ark Seedance 2.5 (260628) video generation (480p / 720p / 1080p / 4k)',
  params_def = (
    SELECT jsonb_agg(
      CASE
        WHEN param ->> 'key' = 'resolution' THEN
          jsonb_set(
            param,
            '{options}',
            '[
              {"value":"480p","label":"480p"},
              {"value":"720p","label":"720p"},
              {"value":"1080p","label":"1080p"},
              {"value":"4k","label":"4K"}
            ]'::jsonb
          )
        ELSE param
      END
      ORDER BY ordinal
    )
    FROM jsonb_array_elements(
      COALESCE(NULLIF(models.params_def, ''), '[]')::jsonb
    ) WITH ORDINALITY AS entry(param, ordinal)
  )::text,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'doubao-seedance-2-5-260628'
  AND deleted_at IS NULL;

COMMIT;
