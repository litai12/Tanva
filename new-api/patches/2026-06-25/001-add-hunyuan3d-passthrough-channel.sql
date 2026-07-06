-- 001-add-hunyuan3d-passthrough-channel.sql
-- Purpose: 让前端「2D转3D / 混元3D」节点经 new-api 出模型(腾讯混元 3D 上游)。
--
-- 背景:
--   后端 Convert2Dto3DService 走腾讯混元 3D 独立 API:
--     POST /v1/ai3d/submit  → JobId
--     POST /v1/ai3d/query   → 轮询 Status / ResultFile3Ds
--   鉴权为简单 Bearer sk- 令牌(非腾讯云 TC3 签名), 因此无需写原生 task adapter,
--   直接复用通用透传路由 GenericChannelProxy(controller.special_proxy.go):
--     /proxy/:name/*path → 按渠道名查渠道, 注入 "Authorization: Bearer <key>" 透传上游。
--   与 /proxy/ark/*(豆包 Seed3D)同一条路。
--
--   后端把 HUNYUAN_3D_BASE_URL 指向 ${NEW_API_BASE_URL}/proxy/hunyuan3d, 用
--   NEW_API_KEY 向网关鉴权; 腾讯真实 sk- 改由本渠道(面板)持有, 不再落 .env。
--   提交/轮询/落 OSS 逻辑仍在后端, 透传对其完全透明。
--
--   注: GenericChannelProxy 为纯透传, new-api 侧不计费(同 ark 豆包); 积分仍由
--   后端 withCredits('convert-2d-to-3d') 扣。若要 new-api 侧记账需另写 task adapter。
--
-- Scope: PostgreSQL only, data-only, idempotent. 业务键: channels(name, type)。
-- 参照: patches/2026-05-30/002-add-youchuan-passthrough-channel.sql

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: insert 'hunyuan3d' 透传渠道 (skip if same name+type already exists)。
--   type=1 占位(走 /proxy 透传, 不经 distributor)。
--   models 对透传无功能意义(GenericChannelProxy 按渠道名+路径转发, 不读 models),
--   这里填 'hunyuan-3d' 仅为面板里可读地标识用途; 留空亦可(参 youchuan 透传渠道)。
--   key 为腾讯混元 3D 独立 API 的 sk- 令牌 —— 占位, 由管理员在面板补真实值。
-- -----------------------------------------------------------------------------
INSERT INTO channels (
  name, type, "group", models, status, base_url, key,
  created_time, test_time, priority, weight, tag
)
SELECT
  'hunyuan3d', 1, 'default', 'hunyuan-3d', 1, 'https://api.ai3d.cloud.tencent.com',
  'PLACEHOLDER_HUNYUAN_3D_SK',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'hunyuan3d-passthrough'
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'hunyuan3d' AND type = 1
);

-- -----------------------------------------------------------------------------
-- Step 2: keep base_url/models/group/tag aligned on re-run, but never overwrite
--         `key`(so a panel-entered sk- survives repeated patch runs)，也不动
--         `status`(避免重跑时把管理员手动停用的渠道又重新启用)。
-- -----------------------------------------------------------------------------
UPDATE channels
SET base_url = 'https://api.ai3d.cloud.tencent.com',
    models   = 'hunyuan-3d',
    "group"  = 'default',
    tag      = 'hunyuan3d-passthrough'
WHERE name = 'hunyuan3d' AND type = 1;

-- ── Verify ────────────────────────────────────────────────────────────────────
\echo '----- channel: hunyuan3d (透传) -----'
SELECT id, name, type, status, "group", base_url,
       CASE WHEN key LIKE 'PLACEHOLDER%' THEN '(placeholder — 面板补 sk-)' ELSE '(set)' END AS key_state
FROM channels WHERE name = 'hunyuan3d' AND type = 1;

COMMIT;
