-- Remove unsupported watermark override from VolcEngine Ark Seedream image channel.
--
-- VolcEngine Ark image generation now rejects unknown top-level field
-- "watermark" with: json: unknown field "watermark". This field was previously
-- injected through channels.param_override for ark-doubao-image.

\set ON_ERROR_STOP on

BEGIN;

UPDATE channels
SET param_override = NULLIF(
  (COALESCE(NULLIF(param_override, ''), '{}')::jsonb - 'watermark')::text,
  '{}'
)
WHERE type = 45
  AND (name = 'ark-doubao-image' OR tag = 'ark-doubao-image')
  AND COALESCE(NULLIF(param_override, ''), '{}')::jsonb ? 'watermark';

\echo '----- ark-doubao-image param_override after watermark removal -----'
SELECT id, name, type, tag, param_override
FROM channels
WHERE type = 45 AND (name = 'ark-doubao-image' OR tag = 'ark-doubao-image');

COMMIT;
