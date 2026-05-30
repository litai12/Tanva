-- 002-add-youchuan-passthrough-channel.sql
-- Purpose: 让前端 Midjourney V7 / Niji 7 节点经 new-api 出图(优创上游)。
--
-- 背景:
--   后端 MidjourneyProvider 的 V7/Niji 走优创专有协议 (POST /v1/tob/diffusion,
--   轮询 GET /v1/tob/job/{id}, 鉴权头 x-youchuan-app / x-youchuan-secret)。
--   new-api 的标准 MJ relay 只懂 midjourney-proxy 协议, 不懂优创协议; 因此新增了
--   /youchuan 透传路由 (controller.ProxyYouchuan)：按渠道名 'youchuan' 查渠道,
--   把 key("appId|secret") 拆成 x-youchuan-app / x-youchuan-secret 注入上游。
--
--   后端开启 MIDJOURNEY_VIA_NEW_API=1 后, youchuan 模式的 base_url 指向
--   ${NEW_API_BASE_URL}/youchuan, 用 Bearer NEW_API_KEY 向网关鉴权; 优创真实
--   密钥改由本渠道(面板)持有。提交/OSS/轮询逻辑仍在后端, 透传对其完全透明。
--
--   注: 普通 Midjourney(legacy /mj/* 标准协议)本轮不经 new-api —— new-api 的 MJ
--   relay 靠 webhook 回填任务进度, 而后端是轮询模型, 经标准 relay 会卡在 pending。
--   普通 MJ 留作后续(需配置 webhook 回调)单独处理。
--
-- Scope: PostgreSQL only, data-only, idempotent. 业务键: channels(name, type)。
-- 参照: patches/2026-04-18/003-seed-channels-abilities.sql

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: insert 'youchuan' 透传渠道 (skip if same name+type already exists)。
--   type=1 占位(走 /youchuan 透传, 不经 distributor, 故 models 留空)。
--   key 必须是 "appId|secret" 两段, ProxyYouchuan 拆出后注入 x-youchuan-app/secret。
-- -----------------------------------------------------------------------------
INSERT INTO channels (
  name, type, "group", models, status, base_url, key,
  created_time, test_time, priority, weight, tag
)
SELECT
  'youchuan', 1, 'default', '', 1, 'https://ali.youchuan.cn',
  'PLACEHOLDER_YOUCHUAN_APPID|PLACEHOLDER_YOUCHUAN_SECRET',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'youchuan-passthrough'
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'youchuan' AND type = 1
);

-- -----------------------------------------------------------------------------
-- Step 2: keep base_url/group/tag aligned on re-run, but never overwrite `key`
--         (so a panel-entered "appId|secret" survives repeated patch runs)，也
--         不动 `status`（避免重跑时把管理员手动停用的渠道又重新启用）。
-- -----------------------------------------------------------------------------
UPDATE channels
SET base_url = 'https://ali.youchuan.cn',
    "group"  = 'default',
    tag      = 'youchuan-passthrough'
WHERE name = 'youchuan' AND type = 1;

-- ── Verify ────────────────────────────────────────────────────────────────────
\echo '----- channel: youchuan (透传) -----'
SELECT id, name, type, status, "group", base_url,
       CASE WHEN key LIKE 'PLACEHOLDER%' THEN '(placeholder — 面板补 appId|secret)' ELSE '(set)' END AS key_state
FROM channels WHERE name = 'youchuan' AND type = 1;

COMMIT;
