-- 004-add-special-proxy-channels.sql
-- Purpose: register three pass-through proxy channels used by the backend's
--          specialised services (minimax speech, minimax music, ark seed3d).
--
-- These channels are selected by name in controller/special_proxy.go:
--   "kapon-speech"   → models.kapon.cloud  (minimax TTS proxy)
--   "minimax-music"  → api.minimaxi.com    (minimax music generation)
--   "ark-seed3d"     → ark.cn-beijing.volces.com/api/v3  (Doubao 3D generation)
--
-- Keys are PLACEHOLDERS — fill in via admin console after apply:
--   PLACEHOLDER_MINIMAX_API_KEY       → MINIMAX_API_KEY (for kapon-speech)
--   PLACEHOLDER_MINIMAX_MUSIC_API_KEY → MINIMAX_MUSIC_API_KEY or MINIMAX_API_KEY (for minimax-music)
--   PLACEHOLDER_ARK_API_KEY           → ARK_API_KEY or SEED3D_API_KEY (for ark-seed3d)
--
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- kapon-speech: models.kapon.cloud — Minimax TTS via kapon proxy
-- channel type 35 = ChannelTypeMiniMax
-- ---------------------------------------------------------------------------
INSERT INTO channels (
  type, name, key, status, base_url,
  created_time, updated_time
)
SELECT
  35,
  'kapon-speech',
  'PLACEHOLDER_MINIMAX_API_KEY',
  1,
  'https://models.kapon.cloud',
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'kapon-speech' AND deleted_at IS NULL
);

-- ---------------------------------------------------------------------------
-- minimax-music: api.minimaxi.com — Minimax official music generation API
-- channel type 35 = ChannelTypeMiniMax
-- ---------------------------------------------------------------------------
INSERT INTO channels (
  type, name, key, status, base_url,
  created_time, updated_time
)
SELECT
  35,
  'minimax-music',
  'PLACEHOLDER_MINIMAX_MUSIC_API_KEY',
  1,
  'https://api.minimaxi.com',
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'minimax-music' AND deleted_at IS NULL
);

-- ---------------------------------------------------------------------------
-- ark-seed3d: ark.cn-beijing.volces.com/api/v3 — Doubao Seed3D generation
-- channel type 1 = ChannelTypeOpenAI (OpenAI-compatible format)
-- ---------------------------------------------------------------------------
INSERT INTO channels (
  type, name, key, status, base_url,
  created_time, updated_time
)
SELECT
  1,
  'ark-seed3d',
  'PLACEHOLDER_ARK_API_KEY',
  1,
  'https://ark.cn-beijing.volces.com/api/v3',
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'ark-seed3d' AND deleted_at IS NULL
);

COMMIT;
