-- 001-add-volc-mediakit-enhance.sql
-- Purpose: 把后端「视频画质增强」(火山引擎 AI MediaKit 超分) 接入 new-api，做成
--          一等公民异步任务模型 (与 apimart omni-flash-ext 同级)，由 new-api 持有
--          MediaKit key、记任务日志、原生计费。
--
-- 依赖 (Go 侧，已在本分支实现):
--   - constant.ChannelTypeVolcMediaKit = 66 (+ base URL + name)。
--   - relay/channel/task/volcmediakit task 适配器:
--       submit → POST {base}/api/v1/tools/enhance-video  (Bearer, 返回 task_id)
--       poll   → GET  {base}/api/v1/tasks/{task_id}        (status + result.video_url)
--   - relay.GetTaskAdaptor: ChannelType 66 → volcmediakit.TaskAdaptor。
--
-- 鉴权: MediaKit 用普通 Bearer (渠道 key 即 MediaKit API Key)，非火山 V4 签名。
--
-- 计费 (一口价，与后端 VOLC_ENHANCE_VIDEO_PRICING 完全一致，不按实际时长结算):
--   后端按 版本×分辨率档×帧率档 查表扣固定积分。new-api 复刻:
--     基准 ModelPrice = standard/720P/<=30fps = 90 积分 = 9.0 元 (10 积分/元)。
--     EstimateBilling 返回 ratio = 表内积分/90，使扣减额度与后端逐格相等。
--   注意: ModelPrice 路径下 UsePrice=true → PerCallBilling=true → 跳过完成差额结算，
--         正好符合「一口价」；EstimateBilling 系数仍在提交时生效 (relay_task.go step 6)。
--
-- 已知限制 (过渡期可接受，与 youchuan/mjproxy 等 task-only 渠道一致):
--   - 未新增 APIType 映射，admin「渠道测试」按钮会走 OpenAI 适配器、对本渠道无意义。
--   - type=66 > ChannelTypeDummy(61)，不进入 /models 自动生成的 channelId2Models 默认表；
--     本渠道模型由下方 channels.models 列显式声明，功能不受影响。
--
-- 参数: tool_version(standard|professional, 默认 standard), scene(aigc|short_series|
--       ugc|old_film), resolution(720p|1080p|4k, 与 resolution_limit 互斥),
--       fps(1-120, 智能插帧)。源视频 URL 经 metadata.video_url 传入。
--
-- Doc: backend/docs/火山超分（画质增强）接入API文档.md
-- Scope: PostgreSQL only, data-only, idempotent. 业务键: channels(name, type)。

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 0: vendor 'VolcEngine' (按需创建) ───────────────────────────────────
INSERT INTO vendors (name, description, icon, status, created_time, updated_time)
SELECT 'VolcEngine',
       '火山引擎 — AI MediaKit 媒体处理（画质增强/超分）',
       NULL, 1,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint
WHERE NOT EXISTS (
  SELECT 1 FROM vendors WHERE name = 'VolcEngine' AND deleted_at IS NULL
);

-- ── Step 1: 受管渠道 (type=66, Bearer 透传由 task 适配器处理) ──────────────────
--   key 为 MediaKit API Key 占位符，重跑绝不覆盖 (保留面板手填的真实 key)。
INSERT INTO channels (
  name, type, "group", models, status, base_url, key,
  created_time, test_time, priority, weight, tag
)
SELECT
  'volc-mediakit', 66, 'default',
  'volc-enhance-video',
  1, 'https://mediakit.cn-beijing.volces.com',
  'PLACEHOLDER_VOLC_MEDIAKIT_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'volc-mediakit'
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'volc-mediakit' AND type = 66
);

-- 重跑对齐 base_url/group/models/tag，但不动 key、不动 status。
UPDATE channels
SET models   = 'volc-enhance-video',
    base_url = 'https://mediakit.cn-beijing.volces.com',
    "group"  = 'default',
    tag      = 'volc-mediakit'
WHERE name = 'volc-mediakit' AND type = 66;

-- ── Step 2: 模型 volc-enhance-video (kind=video) ─────────────────────────────
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT 'volc-enhance-video',
       '火山引擎 AI MediaKit 视频画质增强（智能超分/插帧/修复）',
       NULL, NULL, v.id, NULL, 'video', 1, 0,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM (
  SELECT id FROM vendors WHERE name = 'VolcEngine' AND deleted_at IS NULL LIMIT 1
) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = 'volc-enhance-video' AND deleted_at IS NULL
);

-- ── Step 3: kind + params_def ────────────────────────────────────────────────
UPDATE models
SET kind         = 'video',
    params_def   = $json$[
      {"key":"toolVersion","type":"enum","label":"版本","default":"standard",
       "options":[
         {"value":"standard","label":"标准版"},
         {"value":"professional","label":"专业版"}
       ]},
      {"key":"scene","type":"enum","label":"场景","default":"aigc",
       "options":[
         {"value":"aigc","label":"AIGC"},
         {"value":"short_series","label":"短剧"},
         {"value":"ugc","label":"UGC短视频"},
         {"value":"old_film","label":"老片修复"}
       ]},
      {"key":"resolution","type":"enum","label":"分辨率","default":"1080p",
       "options":[
         {"value":"720p","label":"720P"},
         {"value":"1080p","label":"1080P"},
         {"value":"4k","label":"4K"}
       ]},
      {"key":"fps","type":"number","label":"帧率(智能插帧, 留空保持原帧率)",
       "min":1,"max":120}
    ]$json$,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'volc-enhance-video' AND deleted_at IS NULL;

-- ── Step 4: abilities (default + auto + vip) ─────────────────────────────────
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.grp, 'volc-enhance-video', c.id, (c.status = 1),
       COALESCE(c.priority, 0), COALESCE(c.weight, 0), c.tag
FROM (VALUES ('default'), ('auto'), ('vip')) AS g(grp)
JOIN channels AS c
  ON c.name = 'volc-mediakit' AND c.type = 66 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = EXCLUDED.enabled,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

-- ── Step 5: ModelPrice 基准 = standard/720P/<=30fps = 90 积分 = 9.0 元 ─────────
-- 其余档位由 EstimateBilling 按 表内积分/90 缩放，逐格等于后端 VOLC_ENHANCE_VIDEO_PRICING。
INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{"volc-enhance-video": 9.0}'
)
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, '')::jsonb, '{}'::jsonb) || EXCLUDED.value::jsonb
)::text;

-- ── Verify ────────────────────────────────────────────────────────────────────
\echo '----- volc-mediakit 渠道(type=66) -----'
SELECT id, name, type, status, "group", base_url, models,
       CASE WHEN key LIKE 'PLACEHOLDER%' THEN '(placeholder — 面板补 MediaKit key)' ELSE '(set)' END AS key_state
FROM channels WHERE name = 'volc-mediakit' AND type = 66;

\echo '----- model + abilities + price -----'
SELECT m.model_name, m.kind, m.status, m.params_def IS NOT NULL AS has_params_def,
       (o.value::jsonb ->> m.model_name) AS price_cny
FROM models m
CROSS JOIN options o
WHERE m.model_name = 'volc-enhance-video' AND m.deleted_at IS NULL AND o.key = 'ModelPrice';

SELECT a."group", a.model, a.enabled
FROM abilities a
JOIN channels c ON c.id = a.channel_id AND c.name = 'volc-mediakit'
WHERE a.model = 'volc-enhance-video'
ORDER BY a."group";

COMMIT;
