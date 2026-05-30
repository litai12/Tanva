-- 006-add-147ai-mjproxy-channel.sql
-- Purpose: 把 147AI 的普通 Midjourney 做成 new-api 受管渠道+模型(标准 mj-proxy)。
--
-- 依赖: new-api 已新增 ChannelTypeMjProxy=65 + task 适配器(relay/channel/task/mjproxy)，
--       该适配器提交 {base}/mj/submit/imagine、直接轮询 {base}/mj/task/{id}/fetch
--       (绕开 new-api 内置 MJ relay 的 webhook 依赖)。
--
-- 本 patch:
--   1. 建 type=65 受管渠道 '147ai-mj'(base 147AI, key=147AI 密钥占位)；
--      models = midjourney-fast, midjourney-relax。
--   2. 写 group=default 的 abilities。
--   3. 价格: midjourney-fast / midjourney-relax = 0.5(= backend midjourney-imagine 50积分/100)。
--
-- Scope: PostgreSQL only, data-only, idempotent. 业务键: channels(name, type)。

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: 受管渠道 (type=65) ────────────────────────────────────────────────
INSERT INTO channels (
  name, type, "group", models, status, base_url, key,
  created_time, test_time, priority, weight, tag
)
SELECT
  '147ai-mj', 65, 'default',
  'midjourney-fast,midjourney-relax',
  1, 'https://api.147ai.cn',
  'PLACEHOLDER_147AI_MJ_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, '147ai-mjproxy'
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = '147ai-mj' AND type = 65
);

UPDATE channels
SET models   = 'midjourney-fast,midjourney-relax',
    base_url = 'https://api.147ai.cn',
    "group"  = 'default',
    tag      = '147ai-mjproxy'
WHERE name = '147ai-mj' AND type = 65;

-- ── Step 2: abilities ─────────────────────────────────────────────────────────
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT 'default', m.model, c.id, (c.status = 1),
       COALESCE(c.priority, 0), COALESCE(c.weight, 0), c.tag
FROM channels AS c
CROSS JOIN (VALUES ('midjourney-fast'), ('midjourney-relax')) AS m(model)
WHERE c.name = '147ai-mj' AND c.type = 65 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = EXCLUDED.enabled,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

-- ── Step 3: ModelPrice(= backend midjourney-imagine 50积分/100 = 0.5) ─────────
UPDATE options
SET value = (
  COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
  || '{"midjourney-fast": 0.5, "midjourney-relax": 0.5}'::jsonb
)::text
WHERE key = 'ModelPrice';

-- ── Verify ────────────────────────────────────────────────────────────────────
\echo '----- 147ai-mj 渠道(type=65) -----'
SELECT id, name, type, status, "group", base_url, models,
       CASE WHEN key LIKE 'PLACEHOLDER%' THEN '(placeholder — 面板补 147AI key)' ELSE '(set)' END AS key_state
FROM channels WHERE name = '147ai-mj' AND type = 65;

\echo '----- abilities + price -----'
SELECT a.model, a.enabled, (o.value::jsonb ->> a.model) AS price
FROM abilities a
JOIN channels c ON c.id = a.channel_id AND c.name = '147ai-mj'
CROSS JOIN options o
WHERE o.key = 'ModelPrice'
ORDER BY a.model;

COMMIT;
