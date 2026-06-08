-- 001-add-kapon-vidu-q2-channel.sql
-- 修复 vidu-q2 缺口 + 把 kapon 合并成单一渠道（视频 + MiniMax TTS 同一个 kapon.cloud 账号）。
--
-- 根因：
--   线上 vidu-q2 被分发到 apimart（channel 176, type 59），但 apimart 视频线
--   **不含 Vidu Q2**（只有 vidu-q3/q3-pro/q3-turbo，对 docs.apimart.ai/llms.txt 核实）。
--   2026-06-02/001 误把 vidu-q2→viduq2 注册到 apimart，导致每次 model_not_found（503）。
--   实测 models.kapon.cloud（one-hub 聚合）/v1/models **有**通用 `viduq2`，且
--   /v1/videos/generations 请求体与 apimart 同构，复用 apimart 适配器（type 59）即可出货。
--
-- 合并设计（一个 kapon 渠道两用）：
--   * 视频：走正常 relay → distributor → apimart 适配器（type 59）→ /v1/videos/generations。
--   * MiniMax TTS：走 special proxy controller.ProxyKaponSpeech（转发 /minimaxi/v1/*）。
--     该 special proxy 用 getChannelByName 查渠道，**只看 name+status，不看 type**
--     （controller/special_proxy.go:188），所以同一个 type-59 的 `kapon` 渠道既能承载
--     视频 relay，又能给 TTS 透传当 base_url+key 源。
--   * 因此把旧的 `kapon-speech`（type 35，MiniMax 适配器）并入 `kapon`：speech 模型挂到
--     kapon.models（仅作记录，TTS 不走 ability），删除 kapon-speech 渠道。
--   * 配套 Go 改动：controller.ProxyKaponSpeech 改为先查 "kapon"，回退 "kapon-speech"
--     （pre-merge 部署兼容）。**应用本补丁前请确保该 Go 版本已上线，否则旧二进制只查
--     kapon-speech，删除后 TTS 会短暂不可用。**
--
-- 价格：后端 viduVideo 节点 creditsPerCall=600 / priceYuan=6（100积分=1元 → ¥6/次）。
--   new-api ModelPrice 仅兜底/配额，真实计费在 Tanva 后端，这里同步成 6。
--
-- 参数：vidu-q2 params_def 按官方规格补全（duration 1-8 默认5；resolution 540p/720p/1080p；
--   aspect 16:9/9:16/4:3/3:4/1:1；首尾帧+参考图）。
--
-- 路由：kapon 的 vidu-q2 ability 优先级 1100 > apimart 1000，开箱即赢。
--
-- tencent 不在范围：腾讯 Vidu 走 /proxy/tencent/vod 透传（tencent-vod-vidu，后端
--   tencent-vod-aigc.service.ts 直连），不经 vidu-q2 分发，本就独立可用。
--
-- 幂等：PostgreSQL only，data-only，可安全重复执行。

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: vidu-q2 / viduq2 强制 kind=video（apimart 适配器靠 modelKindMap[上游名] 判别）。
-- -----------------------------------------------------------------------------

UPDATE models
SET kind = 'video', status = 1, updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE deleted_at IS NULL
  AND model_name IN ('vidu-q2', 'viduq2');

-- -----------------------------------------------------------------------------
-- Step 2: vidu-q2 视频参数元数据。
-- -----------------------------------------------------------------------------

UPDATE models SET
  kind = 'video',
  capabilities = '["reference_images","first_last_frame"]',
  params_def = $json$[
    {"key":"duration","type":"enum","label":"时长","default":5,
     "options":[
       {"value":1,"label":"1s"},{"value":2,"label":"2s"},{"value":3,"label":"3s"},
       {"value":4,"label":"4s"},{"value":5,"label":"5s"},{"value":6,"label":"6s"},
       {"value":7,"label":"7s"},{"value":8,"label":"8s"}
     ]},
    {"key":"size","type":"enum","label":"画幅","default":"16:9",
     "options":[
       {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
       {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"},
       {"value":"1:1","label":"1:1","aspectRatio":"1:1"}
     ]},
    {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
     "options":[
       {"value":"720p","label":"720p"},
       {"value":"1080p","label":"1080p"}
     ]}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'vidu-q2' AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Step 3: 统一的 kapon 渠道（type 59）。不存在则新建，继承旧 kapon-speech 的
--   key/base_url（同一个 kapon.cloud 账号）。
-- -----------------------------------------------------------------------------

INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag,
  setting, param_override, header_override
)
SELECT
  'kapon', 59, 'default',
  'speech-01,speech-01-hd,speech-2.6-hd,vidu-q2,viduq2',
  '{"vidu-q2":"viduq2"}',
  1,
  COALESCE(
    (SELECT base_url FROM channels WHERE name = 'kapon-speech' AND type = 35 LIMIT 1),
    'https://models.kapon.cloud'
  ),
  (SELECT key FROM channels WHERE name = 'kapon-speech' AND type = 35 LIMIT 1),
  EXTRACT(EPOCH FROM NOW())::bigint, 0,
  1100, 0, 'kapon',
  COALESCE((SELECT setting FROM channels WHERE name = 'kapon-speech' AND type = 35 LIMIT 1), NULL),
  NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'kapon' AND type = 59
);

-- 已存在：合并 speech + vidu 模型到 models；保证 base_url 指向 kapon.cloud；补 mapping。
UPDATE channels AS c
SET
  models = (
    SELECT string_agg(m, ',' ORDER BY m)
    FROM (
      SELECT DISTINCT trim(m) AS m
      FROM unnest(string_to_array(
        c.models || ',speech-01,speech-01-hd,speech-2.6-hd,vidu-q2,viduq2', ','
      )) AS t(m)
      WHERE trim(m) <> ''
    ) sub
  ),
  base_url = CASE WHEN COALESCE(NULLIF(c.base_url, ''), '') = ''
                  THEN 'https://models.kapon.cloud' ELSE c.base_url END,
  model_mapping = (
    COALESCE(NULLIF(c.model_mapping, ''), '{}')::jsonb || '{"vidu-q2":"viduq2"}'::jsonb
  )::text
WHERE c.name = 'kapon' AND c.type = 59;

-- 若 kapon 的 key 还是空（全新库、无 kapon-speech 可继承），从 kapon-speech 兜底补一次。
UPDATE channels AS c
SET key = (SELECT key FROM channels WHERE name = 'kapon-speech' AND type = 35 LIMIT 1)
WHERE c.name = 'kapon' AND c.type = 59
  AND COALESCE(NULLIF(c.key, ''), '') = ''
  AND EXISTS (SELECT 1 FROM channels WHERE name = 'kapon-speech' AND type = 35);

-- -----------------------------------------------------------------------------
-- Step 4: vidu-q2 ability（kapon 全分组，优先级 1100 > apimart 1000）。
-- -----------------------------------------------------------------------------

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT trim(g.grp), 'vidu-q2', c.id, true, 1100, COALESCE(c.weight, 0), c.tag
FROM channels AS c
CROSS JOIN unnest(string_to_array(c."group", ',')) AS g(grp)
WHERE c.name = 'kapon'
  AND c.type = 59
  AND trim(g.grp) <> ''
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled, priority = EXCLUDED.priority;

-- -----------------------------------------------------------------------------
-- Step 5: 退役旧 kapon-speech 渠道（type 35）—— TTS 已并入 kapon，由 special proxy
--   按名 "kapon" 透传。先清 abilities（一般为空），再删渠道。
-- -----------------------------------------------------------------------------

DELETE FROM abilities
WHERE channel_id IN (SELECT id FROM channels WHERE name = 'kapon-speech' AND type = 35);

DELETE FROM channels
WHERE name = 'kapon-speech' AND type = 35;

-- -----------------------------------------------------------------------------
-- Step 6: ModelPrice 兜底 = 后端 ¥6/次。业务 id 与上游 id 都写。
-- -----------------------------------------------------------------------------

INSERT INTO options (key, value) VALUES (
  'ModelPrice',
  '{"vidu-q2": 6, "viduq2": 6}'
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

COMMIT;

-- 应用后重启 new-api 或控制台「重载渠道」（MEMORY_CACHE_ENABLED=true，内存 ability/渠道缓存需刷新）。
-- 依赖 Go 改动：controller.ProxyKaponSpeech 已改为先查 "kapon" 再回退 "kapon-speech"。
