-- Raise the ToAPIs Seedance 2 retail multiplier from upstream cost x1.2 to x1.5.
--
-- The three SKUs currently share an upstream cost ratio of 31.25:
--   previous ModelRatio = 31.25 * 1.2 = 37.5
--   new ModelRatio      = 31.25 * 1.5 = 46.875
--
-- PostgreSQL, data-only, idempotent. The JSON merge changes only these three
-- model keys and preserves every unrelated ModelRatio entry.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO options (key, value)
VALUES (
  'ModelRatio',
  '{"seedance-2":46.875,"seedance-2-fast":46.875,"seedance-2-mini":46.875}'
)
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, ''), '{}')::jsonb
  || EXCLUDED.value::jsonb
)::text;

COMMIT;

\echo '----- Seedance 2 ModelRatio (cost x1.5) -----'
SELECT
  value::jsonb -> 'seedance-2' AS standard_ratio,
  value::jsonb -> 'seedance-2-fast' AS fast_ratio,
  value::jsonb -> 'seedance-2-mini' AS mini_ratio
FROM options
WHERE key = 'ModelRatio';
