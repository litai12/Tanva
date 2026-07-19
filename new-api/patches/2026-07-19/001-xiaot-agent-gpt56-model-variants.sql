-- 001-xiaot-agent-gpt56-model-variants.sql
-- Purpose: 把 Tanva 小T大脑从 Claude 4.x 三档迁到 GPT 5.6 Sol/Terra/Luna。
--
-- 路由设计:
--   Tanva 不能直接向本网关请求 gpt-5.6-*，否则 distributor 会把请求送到普通 GPT
--   渠道并绕过小T facade。前端因此使用小T专属门面名；本渠道通过 model_mapping
--   把门面名翻译成 TapCanvas facade 已启用的真实模型 ID：
--     xiaot-agent-gpt-5-6-sol   -> gpt-5.6-sol
--     xiaot-agent-gpt-5-6-terra -> gpt-5.6-terra
--     xiaot-agent-gpt-5-6-luna  -> gpt-5.6-luna
--
-- 计费: 与既有 xiaot-agent 门面一致，ModelPrice 名义按次 0.01；真实计费仍由
-- Tanva backend 按 facade 终帧 usage 结算。
--
-- 用法:
--   docker exec -i tanva-new-api-postgres psql -U new_api -d new_api \
--     -f - < patches/2026-07-19/001-xiaot-agent-gpt56-model-variants.sql
--   应用后重启 tanva-new-api 以重载渠道缓存。
--
-- Scope: PostgreSQL only, data-only, idempotent。业务键 name='xiaot-agent' AND type=1。

\set ON_ERROR_STOP on

BEGIN;

-- 只保留 generic facade 名与当前 GPT 5.6 三档，停止从该渠道暴露旧 Claude 门面。
UPDATE channels
SET models = 'xiaot-agent,xiaot-agent-gpt-5-6-sol,xiaot-agent-gpt-5-6-terra,xiaot-agent-gpt-5-6-luna',
    model_mapping = (
      COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb)
      - 'xiaot-agent-claude-4-8'
      - 'xiaot-agent-claude-4-7'
      - 'xiaot-agent-claude-4-6'
      || '{
        "xiaot-agent-gpt-5-6-sol": "gpt-5.6-sol",
        "xiaot-agent-gpt-5-6-terra": "gpt-5.6-terra",
        "xiaot-agent-gpt-5-6-luna": "gpt-5.6-luna"
      }'::jsonb
    )::text
WHERE name = 'xiaot-agent' AND type = 1;

-- 移除这个小T渠道上的旧 Claude 路由；不影响系统内其它 Claude 渠道。
DELETE FROM abilities AS a
USING channels AS c
WHERE a.channel_id = c.id
  AND c.name = 'xiaot-agent'
  AND c.type = 1
  AND a.model IN (
    'xiaot-agent-claude-4-8',
    'xiaot-agent-claude-4-7',
    'xiaot-agent-claude-4-6'
  );

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT 'default', m.model_name, c.id,
       (c.status = 1),
       COALESCE(c.priority, 0),
       COALESCE(c.weight, 0),
       c.tag
FROM channels AS c
CROSS JOIN (VALUES
  ('xiaot-agent-gpt-5-6-sol'),
  ('xiaot-agent-gpt-5-6-terra'),
  ('xiaot-agent-gpt-5-6-luna')
) AS m(model_name)
WHERE c.name = 'xiaot-agent' AND c.type = 1
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = EXCLUDED.enabled,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{
    "xiaot-agent-gpt-5-6-sol": 0.01,
    "xiaot-agent-gpt-5-6-terra": 0.01,
    "xiaot-agent-gpt-5-6-luna": 0.01
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (COALESCE(NULLIF(options.value, '')::jsonb, '{}'::jsonb) || EXCLUDED.value::jsonb)::text;

\echo '----- xiaot-agent GPT 5.6 channel -----'
SELECT id, name, type, status, models, model_mapping
FROM channels
WHERE name = 'xiaot-agent' AND type = 1;

\echo '----- xiaot-agent abilities（应为 generic + GPT 5.6 三档）-----'
SELECT a.model, a.enabled
FROM abilities AS a
JOIN channels AS c ON c.id = a.channel_id
WHERE c.name = 'xiaot-agent' AND c.type = 1
ORDER BY a.model;

\echo '----- xiaot-agent GPT 5.6 ModelPrice -----'
SELECT value::jsonb -> 'xiaot-agent-gpt-5-6-sol' AS sol,
       value::jsonb -> 'xiaot-agent-gpt-5-6-terra' AS terra,
       value::jsonb -> 'xiaot-agent-gpt-5-6-luna' AS luna
FROM options WHERE key = 'ModelPrice';

COMMIT;
