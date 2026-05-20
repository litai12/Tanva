-- 009-fill-proxy-channel-models.sql
-- Purpose: populate the models field for proxy channels that were created empty.
-- These channels are selected by name (not model dispatch), so the models field
-- is informational — it reflects what the backend actually sends through each channel.
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- kapon-speech: MiniMax TTS via models.kapon.cloud/minimaxi/v1/t2a_v2
UPDATE channels
SET models = 'speech-2.6-hd,speech-01,speech-01-hd'
WHERE name = 'kapon-speech' AND type = 35 AND "group" = 'default'
  AND (models IS NULL OR models = '');

-- minimax-music: MiniMax music generation via api.minimaxi.com/v1/music_generation
UPDATE channels
SET models = 'music-2.5+,music-2.5'
WHERE name = 'minimax-music' AND type = 35 AND "group" = 'default'
  AND (models IS NULL OR models = '');

-- watcha: Watcha seedream gateway (seedream-5.0-lite is the default WATCHA_SEEDREAM_MODEL)
UPDATE channels
SET models = 'seedream-5.0-lite,seedream-5.0,seedream-4.5,seedream-4.0'
WHERE name = 'watcha' AND type = 1 AND "group" = 'default'
  AND (models IS NULL OR models = '');

-- tencent: Tencent Cloud VOD AIGC (OS image, Seedance/Vidu video) + MPS ASR
UPDATE channels
SET models = 'tencent-vod-os,tencent-vod-seedance,tencent-vod-vidu,tencent-mps-asr'
WHERE name = 'tencent' AND type = 1 AND "group" = 'default'
  AND (models IS NULL OR models = '');

-- remove-bg: remove.bg background removal API (no model concept, single endpoint)
UPDATE channels
SET models = 'remove-bg-v1'
WHERE name = 'remove-bg' AND type = 1 AND "group" = 'default'
  AND (models IS NULL OR models = '');

COMMIT;
