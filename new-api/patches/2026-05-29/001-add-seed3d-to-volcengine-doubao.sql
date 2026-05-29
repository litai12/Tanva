-- 001-add-seed3d-to-volcengine-doubao.sql
-- Purpose: 修复 Seed3D 报错 "No available channel for model
--   doubao-seed3d-2-0-260328 under group default"。
--
-- Root cause:
--   后端 Seed3DService 已从旧的 `/proxy/ark`(按渠道名透传，不查 abilities)
--   切换到标准 relay `POST /v1/video/generations`。该路径经 distributor，
--   必须命中 abilities 才能选到渠道；选中后由 GetTaskAdaptor 按渠道 type 决定
--   适配器：type 45(VolcEngine)/54(Doubao) → doubao task 适配器，
--   实际转发到 {base_url}/api/v3/contents/generations/tasks。
--
--   但 doubao-seed3d-2-0-260328 从未写进任何 VolcEngine/Doubao 渠道的 abilities：
--     - 2026-05-20/004 先建了 type=1 的 'ark' 透传代理渠道(给 /proxy/ark 用)；
--     - 2026-05-20/008 想把含 seed3d 的完整 models 重插 'ark'，但 NOT EXISTS
--       守卫因 004 已建该渠道而为假 → 整条 INSERT 被跳过。
--   而且 type=1(OpenAI)即便命中也会走 Sora 适配器，不是 doubao 适配器——
--   所以 seed3d 不能挂在 type=1 的 'ark' 代理渠道，必须挂在 VolcEngine/Doubao 渠道。
--
-- Fix:
--   面向已在服务 doubao 视频任务的 VolcEngine/Doubao 渠道(type 45/54，
--   base_url = 裸域名 https://ark.cn-beijing.volces.com，如 'ark-doubao')：
--     1. models 列追加 doubao-seed3d-2-0-260328(持久源，防 FixAbility 丢失)；
--     2. 写入 group=default 的 abilities 行(distributor 实际读取的路由表)。
--
-- Scope: PostgreSQL only, data-only, idempotent.
-- 业务键: channels.type IN (45,54) AND base_url 指向 ark.cn-beijing.volces.com

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: VolcEngine/Doubao 渠道 models 列追加 doubao-seed3d-2-0-260328 ────────
UPDATE channels
SET models = CASE
  WHEN models IS NULL OR models = ''            THEN 'doubao-seed3d-2-0-260328'
  WHEN models LIKE '%doubao-seed3d-2-0-260328%' THEN models
  ELSE models || ',doubao-seed3d-2-0-260328'
END
WHERE type IN (45, 54)
  AND base_url LIKE 'https://ark.cn-beijing.volces.com%'
  AND base_url NOT LIKE '%/api/v3%';   -- doubao 适配器自拼 /api/v3，base_url 必须是裸域名

-- ── Step 2: abilities 追加 default 组路由行 ────────────────────────────────────
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT 'default',
       'doubao-seed3d-2-0-260328',
       c.id,
       (c.status = 1),
       COALESCE(c.priority, 0),
       COALESCE(c.weight, 0),
       c.tag
FROM channels AS c
WHERE c.type IN (45, 54)
  AND c.base_url LIKE 'https://ark.cn-beijing.volces.com%'
  AND c.base_url NOT LIKE '%/api/v3%'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = EXCLUDED.enabled,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

-- ── Verify ────────────────────────────────────────────────────────────────────
\echo '----- 目标 VolcEngine/Doubao 渠道 (models 应含 doubao-seed3d-2-0-260328) -----'
SELECT id, name, type, status, "group", base_url, left(models, 200) AS models_preview
FROM channels
WHERE type IN (45, 54)
  AND base_url LIKE 'https://ark.cn-beijing.volces.com%'
  AND base_url NOT LIKE '%/api/v3%';

\echo '----- abilities: doubao-seed3d-2-0-260328 (应有 default 行且 enabled=true) -----'
SELECT a."group", a.model, a.channel_id, a.enabled, a.priority, c.name AS channel_name, c.type
FROM abilities AS a
JOIN channels AS c ON c.id = a.channel_id
WHERE a.model = 'doubao-seed3d-2-0-260328'
ORDER BY a.channel_id, a."group";

COMMIT;
