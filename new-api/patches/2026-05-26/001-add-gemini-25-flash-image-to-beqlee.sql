-- 001-add-gemini-25-flash-image-to-beqlee.sql
-- !! SUSPENDED !! gemini-2.5-flash-image-preview 在 Google v1beta/generateContent 返回 404，
-- 暂时搁置极速线路支持，待确认模型可用后再执行。
-- Purpose: 为 beqlee-gemini 渠道补充 gemini-2.5-flash-image-preview 模型（极速线路）
--
-- 变更：
--   1. channel models 列表追加 gemini-2.5-flash-image-preview / -ultra
--   2. abilities 追加对应行（default / auto / svip 三组）
--   3. ModelPrice 追加 gemini-2.5-flash-image-preview-ultra = 0.44
--      （AIStudio 官方价 ¥0.4/张 × 1.1 = ¥0.44，new-api 内部 quota 按 1:1）
--   4. model_mapping 追加 -ultra → 原始模型名映射
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: channel models 追加 ────────────────────────────────────────────────

UPDATE channels
SET models = CASE
  WHEN models LIKE '%gemini-2.5-flash-image-preview%' THEN models
  ELSE models || ',gemini-2.5-flash-image-preview,gemini-2.5-flash-image-preview-ultra'
END
WHERE name = 'beqlee-gemini' AND type = 24;

-- ── Step 2: abilities 追加 ─────────────────────────────────────────────────────

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.grp, m.model, c.id, true, 10, 100, 'beqlee-gemini'
FROM (VALUES
  ('gemini-2.5-flash-image-preview'),
  ('gemini-2.5-flash-image-preview-ultra')
) AS m(model)
CROSS JOIN (VALUES ('default'), ('auto'), ('svip')) AS g(grp)
JOIN channels AS c
  ON c.name = 'beqlee-gemini' AND c.type = 24 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = true,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

-- ── Step 3: ModelPrice 追加（新 key 优先，已有自定义不覆盖）──────────────────────

UPDATE options
SET value = (
  '{"gemini-2.5-flash-image-preview-ultra": 0.44}'::jsonb
  || COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
)::text
WHERE key = 'ModelPrice';

-- ── Step 4: model_mapping 追加 -ultra → 原始模型名 ────────────────────────────

UPDATE channels
SET model_mapping = (
  COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb)
  || '{"gemini-2.5-flash-image-preview-ultra": "gemini-2.5-flash-image-preview"}'::jsonb
)::text
WHERE name = 'beqlee-gemini' AND type = 24;

-- ── Verify ────────────────────────────────────────────────────────────────────

\echo '----- beqlee-gemini channel models (preview) -----'
SELECT id, name, type, left(models, 200) AS models_preview
FROM channels
WHERE name = 'beqlee-gemini' AND type = 24;

\echo '----- abilities: gemini-2.5-flash-image-preview -----'
SELECT a."group", a.model, a.enabled, a.priority
FROM abilities AS a
JOIN channels AS c ON c.id = a.channel_id
WHERE c.name = 'beqlee-gemini' AND c.type = 24
  AND a.model LIKE 'gemini-2.5-flash-image-preview%'
ORDER BY a."group", a.model;

\echo '----- ModelPrice: 2.5-flash-image-preview-ultra -----'
SELECT value::jsonb -> 'gemini-2.5-flash-image-preview-ultra' AS price_25_ultra
FROM options WHERE key = 'ModelPrice';

\echo '----- model_mapping after patch -----'
SELECT id, name, left(model_mapping, 200) AS model_mapping
FROM channels
WHERE name = 'beqlee-gemini' AND type = 24;

COMMIT;
