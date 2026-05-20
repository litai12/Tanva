-- 007-cleanup-redundant-channels.sql
-- Purpose: clean up channels that became redundant after the new-api migration.
--
-- Changes:
--   1. Merge 147ai-veo → 147ai
--      - Add VEO models (veo3-fast/pro/pro-frames) to 147ai channel abilities
--      - Update 147ai base_url to api1.147ai.com (unified endpoint)
--      - Soft-delete 147ai-veo and disable its abilities
--
--   2. Migrate tencent-mps + tencent-vod → tencent
--      - Rename tencent-mps to tencent (or insert fresh if already cleaned)
--      - Soft-delete tencent-vod (merged into tencent)
--
-- Idempotent: safe to re-run.
-- Scope: PostgreSQL only.

BEGIN;

-- ===========================================================================
-- 1. MERGE 147ai-veo INTO 147ai
-- ===========================================================================

-- 1a. Ensure VEO models exist in the models table.
WITH base_models(model_name, kind) AS (VALUES
  ('veo3-fast',       'video'),
  ('veo3-pro',        'video'),
  ('veo3-pro-frames', 'video')
)
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT f.model_name,
       '147AI VEO model — ' || f.model_name,
       NULL, NULL, v.id, NULL, f.kind, 1, 0,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM base_models AS f
CROSS JOIN (SELECT id FROM vendors WHERE name = '147AI' AND deleted_at IS NULL LIMIT 1) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = f.model_name AND deleted_at IS NULL
);

-- 1b. Update 147ai channel: switch to api1.147ai.com and add VEO to models list.
UPDATE channels
SET base_url     = 'https://api1.147ai.com',
    models       = 'gemini-3-pro-image-preview,gemini-3.1-flash-image-preview,gpt-image-2,'
                || 'gemini-3-pro-image-preview-147ai,gemini-3.1-flash-image-preview-147ai,gpt-image-2-147ai,'
                || 'veo3-fast,veo3-pro,veo3-pro-frames',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = '147ai'
  AND type = 63
  AND "group" = 'default'
  AND deleted_at IS NULL;

-- 1c. Register VEO abilities under 147ai channel.
WITH models_list(model) AS (VALUES
  ('veo3-fast'), ('veo3-pro'), ('veo3-pro-frames')
),
ability_matrix AS (
  SELECT g.ability_group, m.model
  FROM models_list AS m
  CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT am.ability_group, am.model, c.id, true, 10, 100, '147ai'
FROM ability_matrix AS am
JOIN channels AS c
  ON c.name = '147ai' AND c.type = 63 AND c."group" = 'default' AND c.deleted_at IS NULL
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = EXCLUDED.enabled,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

-- 1d. Disable abilities of 147ai-veo (so they don't shadow 147ai abilities).
UPDATE abilities
SET enabled = false
WHERE channel_id IN (
  SELECT id FROM channels WHERE name = '147ai-veo' AND deleted_at IS NULL
);

-- 1e. Soft-delete 147ai-veo channel.
UPDATE channels
SET deleted_at   = EXTRACT(EPOCH FROM NOW())::bigint,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = '147ai-veo'
  AND deleted_at IS NULL;

-- ===========================================================================
-- 2. MIGRATE tencent-mps + tencent-vod → tencent
-- ===========================================================================

-- 2a. Rename tencent-mps → tencent when tencent doesn't exist yet.
UPDATE channels
SET name         = 'tencent',
    base_url     = '',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = 'tencent-mps'
  AND deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM channels WHERE name = 'tencent' AND deleted_at IS NULL
  );

-- 2b. Soft-delete tencent-vod (merged into tencent).
UPDATE channels
SET deleted_at   = EXTRACT(EPOCH FROM NOW())::bigint,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = 'tencent-vod'
  AND deleted_at IS NULL;

-- 2c. Soft-delete any leftover tencent-mps (if tencent already exists after 2a).
UPDATE channels
SET deleted_at   = EXTRACT(EPOCH FROM NOW())::bigint,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = 'tencent-mps'
  AND deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM channels WHERE name = 'tencent' AND deleted_at IS NULL
  );

-- 2d. Insert tencent only if it still doesn't exist.
INSERT INTO channels (
  type, name, key, status, base_url,
  created_time, updated_time
)
SELECT
  1,
  'tencent',
  'PLACEHOLDER_TENCENT_SECRET_KEY_PAIR',
  1,
  '',
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'tencent' AND deleted_at IS NULL
);

COMMIT;
