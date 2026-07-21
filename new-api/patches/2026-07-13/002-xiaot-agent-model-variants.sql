-- 002-xiaot-agent-model-variants.sql
-- Purpose: 给 xiaot-agent 渠道追加 chat 模型门面名，支持前端选择小T内核模型。
--
-- 背景:
--   Tanva 小T模式的模型选择器（Claude 4.8/4.7/4.6）以门面名请求本网关：
--   xiaot-agent-claude-4-8 / -4-7 / -4-6。TapCanvas facade 将其映射为真实
--   claude id 写入内核 modelAlias。网关侧只需把三个门面名路由到同一渠道。
--
-- 计费: 与 001 相同，ModelPrice 名义按次 0.01（真实计费在 Tanva backend 按 usage）。
--
-- 用法:
--   docker exec -i tanva-new-api-postgres psql -U new_api -d new_api \
--     -f - < patches/2026-07-13/002-xiaot-agent-model-variants.sql
--   （应用后重启 tanva-new-api 加载缓存。）
--
-- Scope: PostgreSQL only, data-only, idempotent。业务键 name='xiaot-agent' AND type=1（同 001）。

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: 渠道 models 列覆盖为全量四名 ──────────────────────────────────────
UPDATE channels
SET models = 'xiaot-agent,xiaot-agent-claude-4-8,xiaot-agent-claude-4-7,xiaot-agent-claude-4-6'
WHERE name = 'xiaot-agent' AND type = 1;

-- ── Step 2: abilities 路由行（每个模型名一行）────────────────────────────────
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT 'default', m.model_name, c.id,
       (c.status = 1),
       COALESCE(c.priority, 0),
       COALESCE(c.weight, 0),
       c.tag
FROM channels AS c
CROSS JOIN (VALUES
  ('xiaot-agent-claude-4-8'),
  ('xiaot-agent-claude-4-7'),
  ('xiaot-agent-claude-4-6')
) AS m(model_name)
WHERE c.name = 'xiaot-agent' AND c.type = 1
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = EXCLUDED.enabled,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

-- ── Step 3: ModelPrice 名义按次价 ─────────────────────────────────────────────
UPDATE options
SET value = (
  COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
  || '{"xiaot-agent-claude-4-8": 0.01, "xiaot-agent-claude-4-7": 0.01, "xiaot-agent-claude-4-6": 0.01}'::jsonb
)::text
WHERE key = 'ModelPrice';

-- ── Verify ────────────────────────────────────────────────────────────────────
\echo '----- xiaot-agent 渠道 models -----'
SELECT id, name, models FROM channels WHERE name = 'xiaot-agent' AND type = 1;

\echo '----- abilities（应 4 行）-----'
SELECT a.model, a.enabled FROM abilities AS a
JOIN channels AS c ON c.id = a.channel_id
WHERE c.name = 'xiaot-agent' AND c.type = 1 ORDER BY a.model;

\echo '----- ModelPrice -----'
SELECT value::jsonb -> 'xiaot-agent-claude-4-8' AS p48,
       value::jsonb -> 'xiaot-agent-claude-4-7' AS p47,
       value::jsonb -> 'xiaot-agent-claude-4-6' AS p46
FROM options WHERE key = 'ModelPrice';

COMMIT;
