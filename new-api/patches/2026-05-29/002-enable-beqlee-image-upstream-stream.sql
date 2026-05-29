-- 002-enable-beqlee-image-upstream-stream.sql
-- Purpose: 给 beqlee-gemini 渠道开启 image_upstream_stream，让 Gemini 出图请求
--   对上游改用 streamGenerateContent(SSE)，使上游响应头尽早返回，规避该渠道经
--   Cloudflare Worker(generativelanguage.beqlee.icu)转发时的 ~100s 524 超时。
--   new-api 仍在内部把 SSE 流收完后，向下游返回一次性 images JSON（详见
--   relay/channel/gemini 的 GeminiImagineImageStreamHandler 与 ChannelSettings
--   的 ImageUpstreamStream 字段）。
--
-- 仅作用于 beqlee-gemini 渠道；其他 Gemini 渠道不受影响。
--
-- Scope: PostgreSQL only, data-only, idempotent.
-- 业务键: channels.name = 'beqlee-gemini' AND channels.type = 24 (ChannelTypeGemini)

\set ON_ERROR_STOP on

BEGIN;

-- setting 可能为 NULL 或空字符串，先归一成 '{}'::jsonb 再合并开关，幂等。
UPDATE channels
SET setting = (
  COALESCE(NULLIF(setting, '')::jsonb, '{}'::jsonb)
  || '{"image_upstream_stream": true}'::jsonb
)::text
WHERE name = 'beqlee-gemini' AND type = 24;

-- ── Verify ────────────────────────────────────────────────────────────────────
\echo '----- beqlee-gemini setting (应含 image_upstream_stream=true) -----'
SELECT id, name, type,
       (NULLIF(setting, '')::jsonb -> 'image_upstream_stream') AS image_upstream_stream
FROM channels
WHERE name = 'beqlee-gemini' AND type = 24;

COMMIT;
