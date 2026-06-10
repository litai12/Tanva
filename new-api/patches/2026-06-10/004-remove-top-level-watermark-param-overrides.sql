-- Remove unsupported top-level watermark param overrides from JSON channel
-- overrides. Text/Responses and several strict upstream APIs reject
-- "watermark" with: json: unknown field "watermark".

\set ON_ERROR_STOP on

BEGIN;

UPDATE channels
SET param_override = NULLIF(
  (COALESCE(NULLIF(param_override, ''), '{}')::jsonb - 'watermark')::text,
  '{}'
)
WHERE param_override IS NOT NULL
  AND btrim(param_override) <> ''
  AND btrim(param_override) LIKE '{%'
  AND param_override ~ '"watermark"\s*:'
  AND COALESCE(NULLIF(param_override, ''), '{}')::jsonb ? 'watermark';

\echo '----- remaining JSON param_override with top-level watermark -----'
SELECT id, name, type, tag, param_override
FROM channels
WHERE param_override IS NOT NULL
  AND btrim(param_override) <> ''
  AND btrim(param_override) LIKE '{%'
  AND param_override ~ '"watermark"\s*:'
  AND COALESCE(NULLIF(param_override, ''), '{}')::jsonb ? 'watermark';

COMMIT;
