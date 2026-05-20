-- 008z-dedup-alias-models.sql
-- Runs after 008 (alphabetically 008z < 009), before 009's soft-delete.
-- If multiple live rows exist for the same alias model_name (can happen when
-- 008's UPDATE previously set deleted_at=NULL on an already-soft-deleted row
-- while the INSERT also created a new row), keep only the highest-id live row
-- per model_name and soft-delete the lower-id duplicates.
-- Unique timestamps are generated via row-level offsets to avoid the
-- (model_name, deleted_at) unique-constraint violation when multiple rows
-- are deleted in one statement.
-- Safe to run on a clean DB (UPDATE affects 0 rows).

BEGIN;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY model_name ORDER BY id DESC) AS rn,
         ROW_NUMBER() OVER (PARTITION BY model_name ORDER BY id)      AS rn_asc
  FROM models
  WHERE deleted_at IS NULL
    AND model_name IN (
      'gpt-image-2-apimart',
      'gpt-image-2-rightcodes',
      'gpt-image-2-suchuang',
      'gpt-image-2-all'
    )
)
UPDATE models
SET deleted_at   = NOW() - ranked.rn_asc * INTERVAL '1 microsecond',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM ranked
WHERE models.id = ranked.id
  AND ranked.rn > 1;

COMMIT;
