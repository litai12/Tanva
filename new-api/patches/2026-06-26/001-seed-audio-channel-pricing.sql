-- 001-seed-audio-channel-pricing.sql
-- Purpose: make doubao-seed-audio-1-0 (火山豆包语音/音频生成) servable through
--          new-api: register its price, create a dedicated VolcEngine(type 45)
--          channel bound to the model, and add its routing ability.
--
-- Background: seed-audio is relayed via the volcengine adaptor's seed-audio
-- branch to openspeech.bytedance.com/api/v3/tts/create using X-Api-Key auth
-- (the channel key is sent AS the X-Api-Key). That speech-console X-Api-Key is a
-- DIFFERENT credential from the Ark大模型 API key used by the existing ark-doubao
-- channel (chat/seedance) — so it needs its OWN channel.
--
-- new-api gates every relay on a configured price (options.ModelRatio /
-- ModelPrice) unless self-use mode is on; without it the request is rejected
-- with "价格未配置". User-facing 积分 are NOT charged from this ratio — they are
-- charged single-track from the X-NewApi-Consumed-Credits response header
-- (2 积分/秒 by original_duration). This ModelRatio entry is only new-api's
-- internal gateway-token accounting / the price-gate.
--
-- !!! OPERATOR ACTION REQUIRED !!!
-- This patch creates the channel with a PLACEHOLDER key. After it runs, set the
-- real 语音控制台 X-Api-Key on the 'ark-seed-audio' channel (new-api admin UI →
-- 渠道 → ark-seed-audio → Key), or run an environment-local UPDATE. Secrets are
-- intentionally NOT committed here.
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- 1) Price gate: merge doubao-seed-audio-1-0 into options.ModelRatio (idempotent).
--    7.5 mirrors tts-1; only affects gateway-token accounting, not user 积分.
UPDATE options
SET value = (value::jsonb || '{"doubao-seed-audio-1-0": 7.5}'::jsonb)::text
WHERE key = 'ModelRatio';

-- 2) Dedicated VolcEngine (type 45) channel for seed-audio, placeholder key.
--    base_url empty → adaptor resolves to the default ark base, whose seed-audio
--    branch routes to openspeech.bytedance.com (HTTP), not the ark host.
INSERT INTO channels (type, key, status, name, base_url, models, "group", priority, weight, auto_ban, created_time)
SELECT 45, 'REPLACE_WITH_SPEECH_X_API_KEY', 1, 'ark-seed-audio', '', 'doubao-seed-audio-1-0', 'default', 10, 100, 1, extract(epoch FROM now())::bigint
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'ark-seed-audio');

-- 3) Routing ability for the model on that channel, group 'default' (idempotent).
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT 'default', 'doubao-seed-audio-1-0', id, true, 10, 100, ''
FROM channels WHERE name = 'ark-seed-audio'
ON CONFLICT ("group", model, channel_id) DO NOTHING;

COMMIT;
