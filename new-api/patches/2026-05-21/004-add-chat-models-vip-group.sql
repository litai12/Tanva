-- 004-add-chat-models-vip-group.sql
-- Purpose: add 'vip' group abilities for the four Gemini chat models introduced
--          in 001-apimart-add-chat-models.sql.
--
-- Background: patch 001 only seeded 'default' and 'auto' groups. VIP users
-- (NEW_API_KEY_VIP) belong to the 'vip' group, so any chat/vision request
-- that goes through new-api with a VIP key fails with "供应商不可用" for:
--   - Image Chat (AnalyzeNode)    — uses gemini-3.1-pro / gemini-3-flash-preview
--   - 提示词优化 (PromptOptimize) — uses gemini-3.1-pro
--   - 视频分析 (VideoAnalyzeNode) — frame summarisation uses gemini-3-flash-preview
--                                    frame vision uses gemini-3-pro-image-preview
--                                    (image model already covered by patch 002)
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT 'vip', m.model_name, c.id, true, 0, 0, 'apimart'
FROM (VALUES
  ('gemini-2.5-flash'),
  ('gemini-2.5-flash-apimart'),
  ('gemini-3-flash-preview'),
  ('gemini-3-flash-preview-apimart'),
  ('gemini-3.1-pro'),
  ('gemini-3.1-pro-apimart'),
  ('gemini-3.1-pro-preview'),
  ('gemini-3.1-pro-preview-apimart')
) AS m(model_name)
JOIN channels AS c
  ON c.name = 'apimart' AND c.type = 59 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled = true,
      tag     = EXCLUDED.tag;

\echo '----- vip abilities for Gemini chat models after patch -----'
SELECT "group", model, enabled
FROM abilities
WHERE model LIKE 'gemini-2.5-flash%'
   OR model LIKE 'gemini-3-flash-preview%'
   OR model LIKE 'gemini-3.1-pro%'
ORDER BY model, "group";

COMMIT;
