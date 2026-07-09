-- 001-add-seedream-5-0-pro-260628.sql
-- Purpose: 注册 doubao-seedream-5-0-pro-260628（Seedream 5.0 Pro，ARK 直连）。
--
-- 背景:
--   backend Seedream 节点新增 5.0 Pro 版本（modelVersion=5.0-pro），走标准
--   relay /v1/images/generations 请求 ark 主渠道。若不写 models/abilities，
--   distributor 会报 "No available channel for model doubao-seedream-5-0-pro-260628
--   under group default"（同 2026-05-30/001 修 4.0/4.5 的问题）。
--
-- 业务键: channels.name = 'ark-doubao' AND type = 45（2026-05-30/003 整合后的主渠道）。
--   ⚠️ 不能复用 2026-05-30/001 的宽泛键 (type IN (45,54) + ark 裸域名)：
--   之后新增的 ark-seed-audio(语音专用 X-Api-Key，与 ark 图像 key 不通用)、
--   ark-deepseek 也命中该键，会把模型路由到错误凭证的渠道上。
--
-- 做法：
--   1. ark-doubao 主渠道 models 列追加 doubao-seedream-5-0-pro-260628
--      （持久源，防 FixAbility 丢失）；
--   2. 写入 group=default 的 abilities 行（distributor 实际读取的路由表）；
--   3. options.ModelPrice 配置按次价格。
--
-- ModelPrice 换算(对齐 2026-05-30/004 口径: 1元=100积分=1刀 → 价格=backend积分/100)：
--   backend Pro 定价 1K=50积分 / 2K=90积分；ModelPrice 是单一按次价，无法按分辨率
--   区分，按默认档 2K=90积分 → 0.9（同现有 seedream 系列以 2K 档为锚的惯例，
--   1K 请求会在网关侧高估成本，方向与既有 4K 低估同类，可接受）。
--
-- Scope: PostgreSQL only, data-only, idempotent.
-- 参照: patches/2026-05-30/001-add-seedream-4-0-4-5-to-volcengine-doubao.sql
--       patches/2026-05-30/003-consolidate-ark-channels.sql

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: ark-doubao 主渠道 models 列追加 5.0 Pro ────────────────────────────
UPDATE channels
SET models = CASE
  WHEN models IS NULL OR models = ''                     THEN 'doubao-seedream-5-0-pro-260628'
  WHEN models LIKE '%doubao-seedream-5-0-pro-260628%'    THEN models
  ELSE models || ',doubao-seedream-5-0-pro-260628'
END
WHERE name = 'ark-doubao' AND type = 45;

-- ── Step 2: abilities 追加 default 组路由行 ────────────────────────────────────
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT 'default', 'doubao-seedream-5-0-pro-260628', c.id,
       (c.status = 1),
       COALESCE(c.priority, 0),
       COALESCE(c.weight, 0),
       c.tag
FROM channels AS c
WHERE c.name = 'ark-doubao' AND c.type = 45
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = EXCLUDED.enabled,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

-- ── Step 3: ModelPrice 按次价格(backend 2K=90积分 → 0.9) ───────────────────────
UPDATE options
SET value = (
  COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
  || '{"doubao-seedream-5-0-pro-260628": 0.9}'::jsonb
)::text
WHERE key = 'ModelPrice';

-- ── Verify ────────────────────────────────────────────────────────────────────
\echo '----- ark-doubao 主渠道 (models 应含 5-0-pro-260628) -----'
SELECT id, name, type, status, "group", left(models, 300) AS models_preview
FROM channels
WHERE name = 'ark-doubao' AND type = 45;

\echo '----- abilities: seedream 5.0 pro (应只有 ark-doubao 一行且 enabled=true) -----'
SELECT a."group", a.model, a.channel_id, a.enabled, a.priority, c.name AS channel_name
FROM abilities AS a
JOIN channels AS c ON c.id = a.channel_id
WHERE a.model = 'doubao-seedream-5-0-pro-260628'
ORDER BY a.channel_id;

\echo '----- ModelPrice: seedream 5.0 pro -----'
SELECT value::jsonb -> 'doubao-seedream-5-0-pro-260628' AS price_5_0_pro
FROM options WHERE key = 'ModelPrice';

COMMIT;
