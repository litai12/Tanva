-- 005-add-tencent-channel.sql
-- Purpose: register ONE shared Tencent Cloud channel used by both
--          tencent-speech (MPS) and tencent-vod-aigc (VOD) services.
--
--   "tencent" → credentials for both mps.tencentcloudapi.com and vod.tencentcloudapi.com
--
-- Key format:  secretId|secretKey
-- Placeholder: PLACEHOLDER_TENCENT_SECRET_KEY_PAIR → SecretId|SecretKey
--
-- Migration: if old records (tencent-mps, tencent-vod) exist from a prior run,
--   this patch renames tencent-mps → tencent and hard-deletes tencent-vod.
--
-- Channel type 1 = ChannelTypeOpenAI (TC3 signing done in handler, not relay)
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- Step 1: Rename tencent-mps → tencent when tencent doesn't exist yet.
UPDATE channels
SET name = 'tencent',
    base_url = ''
WHERE name = 'tencent-mps'
  AND NOT EXISTS (
    SELECT 1 FROM channels WHERE name = 'tencent' AND type = 1 AND "group" = 'default'
  );

-- Step 2: Hard-delete tencent-vod abilities then channel (merged into tencent).
DELETE FROM abilities
WHERE channel_id IN (SELECT id FROM channels WHERE name = 'tencent-vod');

DELETE FROM channels WHERE name = 'tencent-vod';

-- Step 3: Hard-delete leftover tencent-mps if tencent already existed.
DELETE FROM abilities
WHERE channel_id IN (SELECT id FROM channels WHERE name = 'tencent-mps');

DELETE FROM channels WHERE name = 'tencent-mps';

-- Step 4: Insert tencent only if it still doesn't exist.
INSERT INTO channels (
  type, name, key, status, base_url,
  created_time, test_time
)
SELECT
  1,
  'tencent',
  'PLACEHOLDER_TENCENT_SECRET_KEY_PAIR',
  1,
  '',
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'tencent' AND type = 1 AND "group" = 'default'
);

COMMIT;
