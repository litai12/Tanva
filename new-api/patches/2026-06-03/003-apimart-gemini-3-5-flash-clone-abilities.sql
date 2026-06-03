-- 003-apimart-gemini-3-5-flash-clone-abilities.sql
-- Purpose: 修正 002 —— 002 用写死的渠道条件(name='apimart' AND type=59 AND
--   "group"='default')建 abilities/渠道 models，在部分线上环境该条件命中 0 行，
--   导致 new-api 报 503 "No available channel for model gemini-3.5-flash under
--   group default (distributor)"。002 的 models 目录与定价(与渠道无关)已生效，
--   本 patch 只补「渠道无关」的 abilities + 渠道 models 列。
--
-- 做法: 从已在用的旧 Pro 文本模型 gemini-3-flash-preview 克隆其 abilities、以及
--   其所在渠道的 models 列与 -apimart 映射 —— 自动落到线上真实渠道/分组，无需
--   知道渠道的 name/type/group。
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) 克隆 abilities：gemini-3-flash-preview → gemini-3.5-flash(同渠道/同组/同启用态)
--    -apimart 别名同理克隆。
-- ---------------------------------------------------------------------------

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT "group", 'gemini-3.5-flash', channel_id, enabled, priority, weight, tag
FROM abilities
WHERE model = 'gemini-3-flash-preview'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      tag     = EXCLUDED.tag;

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT "group", 'gemini-3.5-flash-apimart', channel_id, enabled, priority, weight, tag
FROM abilities
WHERE model = 'gemini-3-flash-preview-apimart'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      tag     = EXCLUDED.tag;

-- ---------------------------------------------------------------------------
-- 2) 渠道 models 列：凡含 gemini-3-flash-preview 的渠道，补上 gemini-3.5-flash。
-- ---------------------------------------------------------------------------

UPDATE channels
SET models = models || ',gemini-3.5-flash'
WHERE models LIKE '%gemini-3-flash-preview%'
  AND models NOT LIKE '%gemini-3.5-flash%';

-- ---------------------------------------------------------------------------
-- 3) -apimart 别名 → 真实 id 映射：凡已映射旧 -apimart 别名的渠道，补新别名。
-- ---------------------------------------------------------------------------

UPDATE channels
SET model_mapping = (
  COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb)
  || '{ "gemini-3.5-flash-apimart": "gemini-3.5-flash" }'::jsonb
)::text
WHERE model_mapping LIKE '%gemini-3-flash-preview-apimart%';

-- ---------------------------------------------------------------------------
-- 核对
-- ---------------------------------------------------------------------------

\echo ''
\echo '----- gemini-3.5-flash abilities(克隆后，应含 default 等组且 enabled=t) -----'
SELECT "group", model, channel_id, enabled
FROM abilities
WHERE model LIKE 'gemini-3.5-flash%'
ORDER BY "group", model;

\echo ''
\echo '----- 含 gemini-3.5-flash 的渠道 -----'
SELECT id, name, type, "group"
FROM channels
WHERE models LIKE '%gemini-3.5-flash%'
ORDER BY id;

COMMIT;
