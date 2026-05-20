-- 005-add-tencent-channels.sql
-- Purpose: register two Tencent Cloud signing-proxy channels used by
--          the backend's tencent-speech and tencent-vod-aigc services.
--
-- These channels are selected by name in controller/tencent_proxy.go:
--   "tencent-mps" → mps.tencentcloudapi.com  (MPS ProcessMedia / DescribeTaskDetail)
--   "tencent-vod" → vod.tencentcloudapi.com  (VOD CreateAigcImageTask, CreateAigcVideoTask, DescribeTaskDetail)
--
-- Key format: secretId|secretKey
-- Keys are PLACEHOLDERS — fill in via admin console after apply:
--   PLACEHOLDER_TENCENT_MPS_SECRET_KEY_PAIR → SecretId|SecretKey for MPS
--   PLACEHOLDER_TENCENT_VOD_SECRET_KEY_PAIR → SecretId|SecretKey for VOD
--     (may be the same pair if both use the same Tencent sub-account)
--
-- Channel type 1 = ChannelTypeOpenAI (no special behaviour needed; signing is done in proxy handler)
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- tencent-mps: mps.tencentcloudapi.com — Tencent MPS dubbing
-- ---------------------------------------------------------------------------
INSERT INTO channels (
  type, name, key, status, base_url,
  created_time, updated_time
)
SELECT
  1,
  'tencent-mps',
  'PLACEHOLDER_TENCENT_MPS_SECRET_KEY_PAIR',
  1,
  'https://mps.tencentcloudapi.com',
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'tencent-mps' AND deleted_at IS NULL
);

-- ---------------------------------------------------------------------------
-- tencent-vod: vod.tencentcloudapi.com — Tencent VOD AIGC image/video
-- ---------------------------------------------------------------------------
INSERT INTO channels (
  type, name, key, status, base_url,
  created_time, updated_time
)
SELECT
  1,
  'tencent-vod',
  'PLACEHOLDER_TENCENT_VOD_SECRET_KEY_PAIR',
  1,
  'https://vod.tencentcloudapi.com',
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'tencent-vod' AND deleted_at IS NULL
);

COMMIT;
