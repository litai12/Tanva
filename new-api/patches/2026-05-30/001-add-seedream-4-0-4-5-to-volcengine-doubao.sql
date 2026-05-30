-- 001-add-seedream-4-0-4-5-to-volcengine-doubao.sql
-- Purpose: 修复 Seedream 4.0 / 4.5 报错 "No available channel for model
--   doubao-seedream-4-0-250828 under group default"。
--
-- Root cause:
--   前端 Seedream 节点提供 4.0 / 4.5 / 5.0 三个版本，但只有 5.0
--   (doubao-seedream-5-0-260128) 被写进了 VolcEngine/Doubao(ark) 渠道的
--   models 列与 default 组 abilities。4.0 (doubao-seedream-4-0-250828) 和
--   4.5 (doubao-seedream-4-5-251128) 从未写进任何渠道的 abilities，
--   distributor 选不到渠道 → 报 "No available channel"。
--
-- Fix:
--   面向已在服务 doubao 图像/视频任务的 VolcEngine/Doubao 渠道(type 45/54，
--   base_url = 裸域名 https://ark.cn-beijing.volces.com，如 'ark-doubao')：
--     1. models 列追加 doubao-seedream-4-0-250828 与 doubao-seedream-4-5-251128
--        (持久源，防 FixAbility 丢失)；
--     2. 写入 group=default 的 abilities 行(distributor 实际读取的路由表)；
--     3. options.ModelPrice 配置两个模型的按次价格(对齐 5.0 的 0.5)。
--
-- Scope: PostgreSQL only, data-only, idempotent.
-- 业务键: channels.type IN (45,54) AND base_url 指向 ark.cn-beijing.volces.com
-- 参照: patches/2026-05-29/001-add-seed3d-to-volcengine-doubao.sql

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: VolcEngine/Doubao 渠道 models 列追加 4.0 / 4.5 ──────────────────────
UPDATE channels
SET models = CASE
  WHEN models IS NULL OR models = ''             THEN 'doubao-seedream-4-0-250828'
  WHEN models LIKE '%doubao-seedream-4-0-250828%' THEN models
  ELSE models || ',doubao-seedream-4-0-250828'
END
WHERE type IN (45, 54)
  AND base_url LIKE 'https://ark.cn-beijing.volces.com%'
  AND base_url NOT LIKE '%/api/v3%';

UPDATE channels
SET models = CASE
  WHEN models IS NULL OR models = ''              THEN 'doubao-seedream-4-5-251128'
  WHEN models LIKE '%doubao-seedream-4-5-251128%' THEN models
  ELSE models || ',doubao-seedream-4-5-251128'
END
WHERE type IN (45, 54)
  AND base_url LIKE 'https://ark.cn-beijing.volces.com%'
  AND base_url NOT LIKE '%/api/v3%';

-- ── Step 2: abilities 追加 default 组路由行 ────────────────────────────────────
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT 'default', m.model, c.id,
       (c.status = 1),
       COALESCE(c.priority, 0),
       COALESCE(c.weight, 0),
       c.tag
FROM channels AS c
CROSS JOIN (VALUES
  ('doubao-seedream-4-0-250828'),
  ('doubao-seedream-4-5-251128')
) AS m(model)
WHERE c.type IN (45, 54)
  AND c.base_url LIKE 'https://ark.cn-beijing.volces.com%'
  AND c.base_url NOT LIKE '%/api/v3%'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = EXCLUDED.enabled,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

-- ── Step 3: ModelPrice 按次价格(对齐 doubao-seedream-5-0 的 0.5) ───────────────
UPDATE options
SET value = (
  COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
  || '{"doubao-seedream-4-0-250828": 0.5, "doubao-seedream-4-5-251128": 0.5}'::jsonb
)::text
WHERE key = 'ModelPrice';

-- ── Verify ────────────────────────────────────────────────────────────────────
\echo '----- 目标 VolcEngine/Doubao 渠道 (models 应含 4-0-250828 与 4-5-251128) -----'
SELECT id, name, type, status, "group", base_url, left(models, 240) AS models_preview
FROM channels
WHERE type IN (45, 54)
  AND base_url LIKE 'https://ark.cn-beijing.volces.com%'
  AND base_url NOT LIKE '%/api/v3%';

\echo '----- abilities: seedream 4.0 / 4.5 (应有 default 行且 enabled=true) -----'
SELECT a."group", a.model, a.channel_id, a.enabled, a.priority, c.name AS channel_name, c.type
FROM abilities AS a
JOIN channels AS c ON c.id = a.channel_id
WHERE a.model IN ('doubao-seedream-4-0-250828', 'doubao-seedream-4-5-251128')
ORDER BY a.model, a.channel_id;

\echo '----- ModelPrice: seedream 4.0 / 4.5 -----'
SELECT value::jsonb -> 'doubao-seedream-4-0-250828' AS price_4_0,
       value::jsonb -> 'doubao-seedream-4-5-251128' AS price_4_5
FROM options WHERE key = 'ModelPrice';

COMMIT;
