-- 001-add-kapon-base-and-video-channels.sql
-- 自包含地把 kapon 三条渠道补齐，解决「线上全新部署没有 kapon」：
--   * 之前 base `kapon`(type 59) 是手动在后台建的，没有任何 patch → 全新部署天然缺失；
--   * 2026-06-08 的 patch 只「读」base kapon 的 key 来建 kapon-vidu/kling，依赖它先存在；
--   * new-api-patch 是一次性容器，老部署不会自动重跑后加的 patch。
-- 本 patch 一锅端建好三条，不依赖 2026-06-08 是否跑过，可与其共存（NOT EXISTS 幂等）。
--
-- 渠道：
--   kapon       (type 59, APIMart)  base_url=https://models.kapon.cloud         models=speech-01,speech-01-hd,speech-2.6-hd  prio 11000
--   kapon-vidu  (type 52, Vidu)     base_url=https://models.kapon.cloud/vidu    models=vidu-q2,vidu-q3                       prio 1200
--   kapon-kling (type 50, Kling)    base_url=https://models.kapon.cloud         models=kling-v2-6,kling-v3,kling-v3-omni     prio 50
--
-- 密钥：三条共用同一个 kapon.cloud 的 sk- 令牌。这里只写占位 `PLACEHOLDER_KAPON_KEY`，
--       绝不把真密钥写进 git。部署后在 new-api 后台把 **kapon 这一条** 的 key 填上真值，
--       然后重跑一次本 patch（docker compose run --rm new-api-patch）：
--       kapon 不会被覆盖（NOT EXISTS），kapon-vidu/kling 的占位 key 会自动从 kapon 同步成真值。
--
-- 幂等：PostgreSQL only，data-only，可安全重复执行。
-- 依赖 Go 改动：relay/channel/task/vidu/adaptor.go 对 sk- 令牌改用 Bearer（随 2026-06-08 一起上线）。

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: base kapon 渠道（ChannelType 59 / APIMart）。仅 TTS 特殊代理用途 + 给视频渠道供 key。
--   insert-only：若已存在（含手动建/已填真 key）则不动，避免覆盖真密钥。
-- -----------------------------------------------------------------------------

INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 59, 'kapon', 'default',
  'speech-01,speech-01-hd,speech-2.6-hd',
  NULL, 1, 'https://models.kapon.cloud', 'PLACEHOLDER_KAPON_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 11000, 0, 'kapon', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'kapon' AND type = 59);

-- speech-* abilities（belt-and-suspenders；new-api 重载渠道也会按 models 自动同步）。
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT trim(g.grp), m.model, c.id, true, 11000, COALESCE(c.weight,0), c.tag
FROM channels c
CROSS JOIN unnest(string_to_array(c."group", ',')) AS g(grp)
CROSS JOIN (VALUES ('speech-01'), ('speech-01-hd'), ('speech-2.6-hd')) AS m(model)
WHERE c.name = 'kapon' AND c.type = 59 AND trim(g.grp) <> ''
ON CONFLICT ("group", model, channel_id) DO UPDATE SET enabled = EXCLUDED.enabled, priority = EXCLUDED.priority;

-- -----------------------------------------------------------------------------
-- Step 2: 上游 video 模型登记（task 适配器按渠道类型路由，不依赖 GetModelKind；保持 models 表干净）。
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
-- Step 3: kapon-vidu 渠道（ChannelType 52）。base_url 末尾 /vidu，适配器再拼 /ent/v2/{mode}。
--   key 复用 base kapon（type 59）的令牌。
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
  AND EXISTS (SELECT 1 FROM channels WHERE name = 'kapon' AND type = 59 AND NULLIF(key, '') IS NOT NULL);

-- 同步配置；key 仍是占位时(空或 PLACEHOLDER)从 kapon 拉真值，否则保留已填真值。
UPDATE channels AS c
SET models = 'vidu-q2,vidu-q3',
    model_mapping = '{"vidu-q2":"viduq2-pro","vidu-q3":"viduq3-pro"}',
    base_url = 'https://models.kapon.cloud/vidu',
    key = COALESCE(
      NULLIF(NULLIF(c.key, ''), 'PLACEHOLDER_KAPON_KEY'),
      (SELECT key FROM channels WHERE name = 'kapon' AND type = 59 LIMIT 1)
    )
WHERE c.name = 'kapon-vidu' AND c.type = 52;

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT trim(g.grp), m.model, c.id, true, 1200, COALESCE(c.weight,0), c.tag
FROM channels c
CROSS JOIN unnest(string_to_array(c."group", ',')) AS g(grp)
CROSS JOIN (VALUES ('vidu-q2'), ('vidu-q3')) AS m(model)
WHERE c.name = 'kapon-vidu' AND c.type = 52 AND trim(g.grp) <> ''
ON CONFLICT ("group", model, channel_id) DO UPDATE SET enabled = EXCLUDED.enabled, priority = EXCLUDED.priority;

-- -----------------------------------------------------------------------------
-- Step 4: kapon-kling 渠道（ChannelType 50）。base_url=https://models.kapon.cloud，
--   适配器对 sk- 令牌自动拼 /kling/v1/videos/{mode}。免 model_mapping（同名直发）。
--   priority 50（低于 apimart），默认不抢量。
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
  AND EXISTS (SELECT 1 FROM channels WHERE name = 'kapon' AND type = 59 AND NULLIF(key, '') IS NOT NULL);

UPDATE channels AS c
SET models = 'kling-v2-6,kling-v3,kling-v3-omni',
    base_url = 'https://models.kapon.cloud',
    key = COALESCE(
      NULLIF(NULLIF(c.key, ''), 'PLACEHOLDER_KAPON_KEY'),
      (SELECT key FROM channels WHERE name = 'kapon' AND type = 59 LIMIT 1)
    )
WHERE c.name = 'kapon-kling' AND c.type = 50;

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT trim(g.grp), m.model, c.id, true, 50, COALESCE(c.weight,0), c.tag
FROM channels c
CROSS JOIN unnest(string_to_array(c."group", ',')) AS g(grp)
CROSS JOIN (VALUES ('kling-v2-6'), ('kling-v3'), ('kling-v3-omni')) AS m(model)
WHERE c.name = 'kapon-kling' AND c.type = 50 AND trim(g.grp) <> ''
ON CONFLICT ("group", model, channel_id) DO UPDATE SET enabled = EXCLUDED.enabled, priority = EXCLUDED.priority;

-- -----------------------------------------------------------------------------
-- Step 5: ModelPrice 兜底（RMB，真实计费在 Tanva 后端）。vidu ¥6/次。
-- -----------------------------------------------------------------------------

INSERT INTO options (key, value) VALUES (
  'ModelPrice', '{"vidu-q2": 6, "vidu-q3": 6, "viduq2-pro": 6, "viduq3-pro": 6}'
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

COMMIT;

-- 应用后：①在 new-api 后台把 kapon 渠道的 key 填成真 sk- 令牌；②重跑一次本 patch 让
--   kapon-vidu/kapon-kling 的占位 key 同步成真值；③重启 new-api / 控制台重载渠道。
