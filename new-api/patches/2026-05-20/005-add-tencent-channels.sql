-- 005-add-tencent-channel.sql
-- Purpose: register ONE shared Tencent Cloud channel used by both
--          tencent-speech (MPS) and tencent-vod-aigc (VOD) services.
--
--   "tencent" → credentials for both mps.tencentcloudapi.com and vod.tencentcloudapi.com
--               (MPS and VOD share the same secretId/secretKey in most deployments)
--
-- Key format:  secretId|secretKey
-- Placeholder — fill in via admin console after apply:
--   PLACEHOLDER_TENCENT_SECRET_KEY_PAIR → SecretId|SecretKey
--
-- The upstream endpoint is determined by the route, not the channel base_url:
--   POST /proxy/tencent/mps → mps.tencentcloudapi.com
--   POST /proxy/tencent/vod → vod.tencentcloudapi.com
--
-- Migration: if old records (tencent-mps, tencent-vod) exist from a prior run,
--   this patch renames tencent-mps → tencent and soft-deletes tencent-vod.
--
-- Channel type 1 = ChannelTypeOpenAI (no upstream relay; TC3 signing done in handler)
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- Step 1: Rename tencent-mps → tencent when tencent doesn't exist yet.
UPDATE channels
SET name         = 'tencent',
    base_url     = '',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = 'tencent-mps'
  AND deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM channels WHERE name = 'tencent' AND deleted_at IS NULL
  );

-- Step 2: Soft-delete tencent-vod (merged into the tencent channel).
UPDATE channels
SET deleted_at   = EXTRACT(EPOCH FROM NOW())::bigint,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = 'tencent-vod'
  AND deleted_at IS NULL;

-- Step 3: Soft-delete any leftover tencent-mps that wasn't renamed
--         (happens when tencent already existed before step 1 ran).
UPDATE channels
SET deleted_at   = EXTRACT(EPOCH FROM NOW())::bigint,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = 'tencent-mps'
  AND deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM channels WHERE name = 'tencent' AND deleted_at IS NULL
  );

-- Step 4: Insert tencent only if it still doesn't exist after the rename above.
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
