-- 001-add-xiaot-agent-channel.sql
-- Purpose: 注册小T画布智能体渠道（TapCanvas OpenAI facade），模型名 xiaot-agent。
--
-- 背景:
--   Tanva backend 的 canvasAgent run 分支（backend/src/agent/xiaot-agent.service.ts）
--   经本网关流式调用 /v1/chat/completions model=xiaot-agent。上游是 TapCanvas hono
--   的 /public/v1/chat/completions（画布宿主开放协议 facade），标准 OpenAI 协议，
--   鉴权用 TapCanvas 的 tc_sk_* API key，走类型 1（OpenAI）渠道直接透传。
--
-- 计费口径:
--   真实扣费在 Tanva backend 按终帧 usage（= 小T侧实扣积分）×XIAOT_AGENT_CREDITS_PER_1K
--   折算后 deductExact；本网关的 ModelPrice 仅作对账记录，按次名义价 0.01（=1积分/100）。
--
-- 用法（key/base_url 不入库，经 psql 变量传入）:
--   docker exec -i tanva-new-api-postgres psql -U new_api -d new_api \
--     -v xiaot_key="'tc_sk_xxx'" \
--     -v xiaot_base="'http://host.docker.internal:8788/public'" \
--     -f - < patches/2026-07-13/001-add-xiaot-agent-channel.sql
--   生产环境把 xiaot_base 换成正式 TapCanvas API 地址（如 https://t-api.neospark.cn/public），
--   xiaot_key 换成线上签发的 tc_sk key（用户后续替换）。
--
-- Scope: PostgreSQL only, data-only, idempotent（重跑会更新 key/base_url 而不重复建渠道）。
-- 参照: patches/2026-07-09/001（channels/abilities/ModelPrice 三步模式）

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: 渠道（业务键 name='xiaot-agent' AND type=1；存在则更新 key/base_url）──
INSERT INTO channels (type, key, status, name, weight, created_time, test_time,
                      response_time, base_url, other, balance, balance_updated_time,
                      models, "group", used_quota, priority)
SELECT 1, :xiaot_key, 1, 'xiaot-agent', 0, extract(epoch from now())::bigint, 0,
       0, :xiaot_base, '', 0, 0,
       'xiaot-agent', 'default', 0, 0
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'xiaot-agent' AND type = 1);

UPDATE channels
SET key = :xiaot_key,
    base_url = :xiaot_base,
    models = 'xiaot-agent',
    status = 1
WHERE name = 'xiaot-agent' AND type = 1;

-- ── Step 2: abilities 路由行（distributor 实际读取的路由表）──────────────────────
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT 'default', 'xiaot-agent', c.id,
       (c.status = 1),
       COALESCE(c.priority, 0),
       COALESCE(c.weight, 0),
       c.tag
FROM channels AS c
WHERE c.name = 'xiaot-agent' AND c.type = 1
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = EXCLUDED.enabled,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

-- ── Step 3: ModelPrice 名义按次价（对账用，真实计费在 Tanva backend）─────────────
UPDATE options
SET value = (
  COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
  || '{"xiaot-agent": 0.01}'::jsonb
)::text
WHERE key = 'ModelPrice';

-- ── Verify ────────────────────────────────────────────────────────────────────
\echo '----- xiaot-agent 渠道 -----'
SELECT id, name, type, status, "group", base_url, models FROM channels
WHERE name = 'xiaot-agent' AND type = 1;

\echo '----- abilities: xiaot-agent -----'
SELECT a."group", a.model, a.channel_id, a.enabled, c.name AS channel_name
FROM abilities AS a JOIN channels AS c ON c.id = a.channel_id
WHERE a.model = 'xiaot-agent';

\echo '----- ModelPrice: xiaot-agent -----'
SELECT value::jsonb -> 'xiaot-agent' AS price FROM options WHERE key = 'ModelPrice';

COMMIT;
