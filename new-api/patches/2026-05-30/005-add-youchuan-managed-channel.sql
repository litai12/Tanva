-- 005-add-youchuan-managed-channel.sql
-- Purpose: 把优创(V7/Niji)做成 new-api 的"受管渠道+模型"——走 distributor、abilities
--          路由、ModelPrice 计费，而不再是按渠道名透传。
--
-- 依赖: new-api 已新增 ChannelTypeYouchuan=64 + task 适配器(relay/channel/task/youchuan)。
--       后端改走标准 task API: POST /v1/video/generations {model, prompt, images}
--       → distributor 按 model 命中 abilities → 选到本(type=64)渠道 → 优创适配器
--       转 /v1/tob/diffusion 提交、/v1/tob/job/{id} 轮询。
--
-- 本 patch:
--   1. 建 type=64 的受管渠道 'youchuan'(base 优创裸域名, key="appId|secret" 占位)；
--      models = midjourney-v7, niji-7, midjourney-niji-7。
--   2. 写 group=default 的 abilities(distributor 路由表)。
--   3. 停用旧的 type=1 透传渠道 'youchuan'(002 建的)——已被受管渠道取代。
--      (002 的 /youchuan 透传路由保留为惰性 fallback, 无 enabled 的 type=1 渠道即不生效)
--
-- 价格: 见 004-*(midjourney-v7/niji-7/midjourney-niji-7 = 0.5 = 50积分/100)。
-- Scope: PostgreSQL only, data-only, idempotent. 业务键: channels(name, type)。

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: 受管渠道 (type=64) ────────────────────────────────────────────────
INSERT INTO channels (
  name, type, "group", models, status, base_url, key,
  created_time, test_time, priority, weight, tag
)
SELECT
  'youchuan', 64, 'default',
  'midjourney-v7,niji-7,midjourney-niji-7',
  1, 'https://ali.youchuan.cn',
  'PLACEHOLDER_YOUCHUAN_APPID|PLACEHOLDER_YOUCHUAN_SECRET',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'youchuan-managed'
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'youchuan' AND type = 64
);

-- 重跑时对齐 models/base/group/tag，但不覆盖 key 与 status(保留面板所填密钥与启停)。
UPDATE channels
SET models   = 'midjourney-v7,niji-7,midjourney-niji-7',
    base_url = 'https://ali.youchuan.cn',
    "group"  = 'default',
    tag      = 'youchuan-managed'
WHERE name = 'youchuan' AND type = 64;

-- ── Step 2: abilities(default 组路由表) ───────────────────────────────────────
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT 'default', m.model, c.id, (c.status = 1),
       COALESCE(c.priority, 0), COALESCE(c.weight, 0), c.tag
FROM channels AS c
CROSS JOIN (VALUES
  ('midjourney-v7'), ('niji-7'), ('midjourney-niji-7')
) AS m(model)
WHERE c.name = 'youchuan' AND c.type = 64 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = EXCLUDED.enabled,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

-- ── Step 3: 停用旧的 type=1 透传渠道(被受管渠道取代) ──────────────────────────
UPDATE channels SET status = 2
WHERE name = 'youchuan' AND type = 1
  AND EXISTS (SELECT 1 FROM channels k WHERE k.name = 'youchuan' AND k.type = 64 AND k.status = 1);

-- ── Verify ────────────────────────────────────────────────────────────────────
\echo '----- youchuan 渠道(64=受管 应启用; 1=透传 应停用) -----'
SELECT id, name, type, status, "group", base_url, left(models, 80) AS models,
       CASE WHEN key LIKE 'PLACEHOLDER%' THEN '(placeholder — 面板补 appId|secret)' ELSE '(set)' END AS key_state
FROM channels WHERE name = 'youchuan' ORDER BY type;

\echo '----- abilities: V7/Niji 路由(应命中 type=64 渠道, enabled=true) -----'
SELECT a.model, a.channel_id, a.enabled, c.type
FROM abilities a JOIN channels c ON c.id = a.channel_id
WHERE a.model IN ('midjourney-v7','niji-7','midjourney-niji-7')
ORDER BY a.model;

COMMIT;
