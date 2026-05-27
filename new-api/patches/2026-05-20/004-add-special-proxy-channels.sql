-- 004-add-special-proxy-channels.sql
-- Purpose: register four pass-through proxy channels used by the backend's
--          specialised services (minimax speech, minimax music, ark seed3d).
--
-- These channels are selected by name in controller/special_proxy.go:
--   "kapon-speech"    → models.kapon.cloud            (minimax TTS proxy)
--   "minimax-music"   → api.minimaxi.com              (minimax music generation)
--   "ark"             → ark.cn-beijing.volces.com/api/v3  (Doubao: Seed3D + Seedream5)
--   "watcha" → tokendance.agent-universe.cn/gateway/ark  (Watcha Seedream5)
--
-- Keys are PLACEHOLDERS — fill in via admin console after apply:
--   PLACEHOLDER_MINIMAX_API_KEY       → MINIMAX_API_KEY (for kapon-speech)
--   PLACEHOLDER_MINIMAX_MUSIC_API_KEY → MINIMAX_MUSIC_API_KEY or MINIMAX_API_KEY (for minimax-music)
--   PLACEHOLDER_ARK_API_KEY           → ARK_API_KEY / DOUBAO_API_KEY (for ark: Seed3D + Seedream5)
--   PLACEHOLDER_WATCHA_SEEDREAM_KEY   → WATCHA_SEEDREAM_API_KEY (for watcha)
--
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- kapon-speech: models.kapon.cloud — Minimax TTS via kapon proxy
-- channel type 35 = ChannelTypeMiniMax
-- ---------------------------------------------------------------------------
INSERT INTO channels (
  type, name, key, status, base_url,
  created_time, test_time
)
SELECT
  35,
  'kapon-speech',
  'PLACEHOLDER_MINIMAX_API_KEY',
  1,
  'https://models.kapon.cloud',
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'kapon-speech' AND type = 35
);

-- ---------------------------------------------------------------------------
-- minimax-music: api.minimaxi.com — Minimax official music generation API
-- channel type 35 = ChannelTypeMiniMax
-- ---------------------------------------------------------------------------
INSERT INTO channels (
  type, name, key, status, base_url,
  created_time, test_time
)
SELECT
  35,
  'minimax-music',
  'PLACEHOLDER_MINIMAX_MUSIC_API_KEY',
  1,
  'https://api.minimaxi.com',
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'minimax-music' AND type = 35
);

-- ---------------------------------------------------------------------------
-- ark: ark.cn-beijing.volces.com/api/v3 — Doubao / Ark unified proxy channel
--      used by both Seed3D and Seedream5 (same base URL, same API key)
-- channel type 1 = ChannelTypeOpenAI (OpenAI-compatible format)
-- ---------------------------------------------------------------------------
INSERT INTO channels (
  type, name, key, status, base_url,
  created_time, test_time
)
SELECT
  1,
  'ark',
  'PLACEHOLDER_ARK_API_KEY',
  1,
  'https://ark.cn-beijing.volces.com/api/v3',
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'ark' AND type = 1
);

-- ---------------------------------------------------------------------------
-- watcha: tokendance.agent-universe.cn/gateway/ark — Watcha Seedream5
-- channel type 1 = ChannelTypeOpenAI
-- ---------------------------------------------------------------------------
INSERT INTO channels (
  type, name, key, status, base_url,
  created_time, test_time
)
SELECT
  1,
  'watcha',
  'PLACEHOLDER_WATCHA_SEEDREAM_KEY',
  1,
  'https://tokendance.agent-universe.cn/gateway/ark',
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'watcha' AND type = 1
);

COMMIT;
