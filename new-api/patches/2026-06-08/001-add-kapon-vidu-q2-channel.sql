-- 001-add-kapon-vidu-q2-channel.sql
-- 让 vidu / kling 走 kapon native task 适配器（new-api 自带），不再绕 apimart。
--
-- 背景 / 根因：
--   * vidu-q2 一直 503：apimart 的视频线不含 Vidu Q2；而且 kapon 的
--     /v1/videos/generations（apimart 适配器 type 59 发的那个）**明确拒收 vidu/kling**
--     （只收 sora/veo/seedance/omni，实测 "invalid model"）。
--   * kapon 的 vidu/kling 只在 native 路径：
--       vidu : POST {base}/vidu/ent/v2/{img2video|start-end2video|reference2video|text2video}
--       kling: POST {base}/kling/v1/videos/{image2video|text2video}
--     鉴权用 Bearer <sk- 令牌>（实测 Token=401 / Bearer=400）。
--
--   new-api 自带 native task 适配器，正好讲这套协议：
--     ChannelTypeVidu = 52  → relay/channel/task/vidu  （{base}/ent/v2/{mode}，轮询 /ent/v2/tasks/{id}/creations）
--     ChannelTypeKling= 50  → relay/channel/task/kling （istanvasMartRelay：sk- 令牌→{base}/kling/v1/videos/{mode}）
--   配套 Go 改动：vidu 适配器鉴权对 sk- 令牌改用 Bearer（原来写死 Token，只适用官方 vidu）。
--
-- 本补丁做的事：
--   1. 把之前那个 type-59 kapon 渠道里塞的 vidu 残留清掉（它只保留 TTS 特殊代理用途）。
--   2. 新建 kapon-vidu (type 52)  → base_url=https://models.kapon.cloud/vidu
--          model_mapping: vidu-q2→viduq2-pro, vidu-q3→viduq3-pro（图生/首尾帧/参考走 pro；
--          参考模式适配器会自动去掉 pro 后缀降回 viduq2，见 vidu/adaptor.go）。
--   3. 新建 kapon-kling (type 50) → base_url=https://models.kapon.cloud
--          models: kling-v2-6 / kling-v3 / kling-v3-omni（后端就发这仨上游名，kapon 同名，免映射）。
--   4. ModelPrice 兜底（真实计费在 Tanva 后端）。
--
-- 路由 / 权重：
--   * kapon-vidu 的 vidu-q2/q3 ability 给到 priority 1200（>apimart 1000，开箱即赢，便于测试）。
--   * kapon-kling 给到 priority 50（**低于** apimart 1000），默认仍由 apimart 服务 kling——因为
--     new-api kling 适配器只支持 image2video/text2video，**不支持首尾帧(image_tail)/多图(image_list)**，
--     强行抢量会让 kling 这两种模式退化。运营要全量切 kapon 时自行在控制台调高权重。
--
-- 幂等：PostgreSQL only，data-only，可安全重复执行。依赖上面的 Go 改动已上线。

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 0: 清掉旧 type-59 kapon 渠道里的 vidu 残留（那条只保留 TTS：speech-* + 特殊代理）。
-- -----------------------------------------------------------------------------

UPDATE channels AS c
SET
  models = (
    SELECT string_agg(m, ',' ORDER BY m)
    FROM (
      SELECT DISTINCT trim(m) AS m
      FROM unnest(string_to_array(c.models, ',')) AS t(m)
      WHERE trim(m) <> '' AND trim(m) NOT IN ('vidu-q2','viduq2','viduq2-pro')
    ) sub
  ),
  model_mapping = (COALESCE(NULLIF(c.model_mapping, ''), '{}')::jsonb - 'vidu-q2')::text
WHERE c.name = 'kapon' AND c.type = 59;

-- 删 vidu-q2/vidu-q3 业务 ability，以及 new-api 可能按 channel.models 自动同步出的
-- viduq2 / viduq2-pro 上游 ability（new-api 模型名匹配忽略连字符，vidu-q2 会命中
-- viduq2 这条高优先级 ability，把流量错抢回这条 TTS 渠道）。
DELETE FROM abilities
WHERE model IN ('vidu-q2','vidu-q3','viduq2','viduq2-pro')
  AND channel_id IN (SELECT id FROM channels WHERE name = 'kapon' AND type = 59);

-- -----------------------------------------------------------------------------
-- Step 1: 上游 video 模型登记（belt-and-suspenders；task 适配器按渠道类型路由，
--   不依赖 GetModelKind，但保持 models 表干净）。
-- -----------------------------------------------------------------------------

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT n.model_name, 'Tanva video model ' || n.model_name, NULL, NULL,
       (SELECT vendor_id FROM models WHERE model_name = 'vidu-q3' AND deleted_at IS NULL LIMIT 1),
       NULL, 'video', 1, 0,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM (VALUES ('viduq2-pro'), ('viduq3-pro')) AS n(model_name)
WHERE NOT EXISTS (
  SELECT 1 FROM models m WHERE m.model_name = n.model_name AND m.deleted_at IS NULL
);

UPDATE models
SET kind = 'video', status = 1, updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE deleted_at IS NULL
  AND model_name IN ('vidu-q2','vidu-q3','viduq2-pro','viduq3-pro',
                     'kling-v2-6','kling-v3','kling-v3-omni');

-- -----------------------------------------------------------------------------
-- Step 2: kapon-vidu 渠道（ChannelType 52）。base_url 末尾 /vidu，适配器再拼 /ent/v2/{mode}。
--   key 复用现有 kapon（type 59）的 sk- 令牌（同一个 kapon.cloud 账号，istanvasMartRelay 据此判 Bearer）。
-- -----------------------------------------------------------------------------

INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override
)
SELECT 'kapon-vidu', 52, 'default',
  'vidu-q2,vidu-q3',
  '{"vidu-q2":"viduq2-pro","vidu-q3":"viduq3-pro"}',
  1, 'https://models.kapon.cloud/vidu',
  (SELECT key FROM channels WHERE name = 'kapon' AND type = 59 LIMIT 1),
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 1200, 0, 'kapon-vidu', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'kapon-vidu' AND type = 52)
  AND EXISTS (
    SELECT 1 FROM channels
    WHERE name = 'kapon' AND type = 59 AND NULLIF(key, '') IS NOT NULL
  );

UPDATE channels AS c
SET models = 'vidu-q2,vidu-q3',
    model_mapping = '{"vidu-q2":"viduq2-pro","vidu-q3":"viduq3-pro"}',
    base_url = 'https://models.kapon.cloud/vidu',
    key = COALESCE(NULLIF(c.key,''), (SELECT key FROM channels WHERE name='kapon' AND type=59 LIMIT 1))
WHERE c.name = 'kapon-vidu' AND c.type = 52;

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT trim(g.grp), m.model, c.id, true, 1200, COALESCE(c.weight,0), c.tag
FROM channels c
CROSS JOIN unnest(string_to_array(c."group", ',')) AS g(grp)
CROSS JOIN (VALUES ('vidu-q2'), ('vidu-q3')) AS m(model)
WHERE c.name = 'kapon-vidu' AND c.type = 52 AND trim(g.grp) <> ''
ON CONFLICT ("group", model, channel_id) DO UPDATE SET enabled = EXCLUDED.enabled, priority = EXCLUDED.priority;

-- -----------------------------------------------------------------------------
-- Step 3: kapon-kling 渠道（ChannelType 50）。base_url=https://models.kapon.cloud，
--   适配器对 sk- 令牌自动拼 /kling/v1/videos/{mode}。免 model_mapping（同名直发）。
--   priority 50（低于 apimart），默认不抢量；详见顶部说明。
-- -----------------------------------------------------------------------------

INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override
)
SELECT 'kapon-kling', 50, 'default',
  'kling-v2-6,kling-v3,kling-v3-omni',
  NULL,
  1, 'https://models.kapon.cloud',
  (SELECT key FROM channels WHERE name = 'kapon' AND type = 59 LIMIT 1),
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 50, 0, 'kapon-kling', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'kapon-kling' AND type = 50)
  AND EXISTS (
    SELECT 1 FROM channels
    WHERE name = 'kapon' AND type = 59 AND NULLIF(key, '') IS NOT NULL
  );

UPDATE channels AS c
SET models = 'kling-v2-6,kling-v3,kling-v3-omni',
    base_url = 'https://models.kapon.cloud',
    key = COALESCE(NULLIF(c.key,''), (SELECT key FROM channels WHERE name='kapon' AND type=59 LIMIT 1))
WHERE c.name = 'kapon-kling' AND c.type = 50;

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT trim(g.grp), m.model, c.id, true, 50, COALESCE(c.weight,0), c.tag
FROM channels c
CROSS JOIN unnest(string_to_array(c."group", ',')) AS g(grp)
CROSS JOIN (VALUES ('kling-v2-6'), ('kling-v3'), ('kling-v3-omni')) AS m(model)
WHERE c.name = 'kapon-kling' AND c.type = 50 AND trim(g.grp) <> ''
ON CONFLICT ("group", model, channel_id) DO UPDATE SET enabled = EXCLUDED.enabled, priority = EXCLUDED.priority;

-- -----------------------------------------------------------------------------
-- Step 4: ModelPrice 兜底（RMB，真实计费在 Tanva 后端）。vidu ¥6/次（600积分）。
-- -----------------------------------------------------------------------------

INSERT INTO options (key, value) VALUES (
  'ModelPrice', '{"vidu-q2": 6, "vidu-q3": 6, "viduq2-pro": 6, "viduq3-pro": 6}'
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

COMMIT;

-- 应用后重启 new-api / 控制台重载渠道（MEMORY_CACHE_ENABLED=true）。
-- 依赖 Go 改动：relay/channel/task/vidu/adaptor.go 对 sk- 令牌改用 Bearer。
