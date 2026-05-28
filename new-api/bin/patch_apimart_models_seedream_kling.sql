-- patch_apimart_models_seedream_kling.sql
-- 向 apimart 渠道补充 seedream 图像模型和 kling-v2-6 视频模型；
-- 启用 ark-doubao 渠道并补充 seed3d 模型，供 seed3d.service.ts 走
-- /v1/video/generations 标准路由。
-- 背景：
--   1. seedream5.service.ts 已从 /proxy/ark/images/generations 改为
--      /v1/images/generations 标准路由，需要模型名注册在渠道里
--   2. seed3d.service.ts 已从 /proxy/ark/contents/generations/tasks 改为
--      /v1/video/generations，走 new-api doubao task relay（ark-doubao 渠道）
--   3. kling-v2-6（非 motion-control 场景）未在 apimart 中注册
-- 幂等：使用 unnest+DISTINCT 去重，可安全重复执行

-- Step 1: 补充 apimart 渠道模型
UPDATE channels
SET models = (
  SELECT string_agg(m, ',' ORDER BY m)
  FROM (
    SELECT DISTINCT trim(m) AS m
    FROM unnest(string_to_array(
      models || ','
      -- Seedream 5.0 图像生成
      || 'doubao-seedream-5-0-260128,doubao-seedream-5-0-260128-apimart,'
      || 'doubao-seedream-5-0,doubao-seedream-5-0-apimart,'
      || 'doubao-seedream-5-0-lite,doubao-seedream-5-0-lite-apimart,'
      || 'doubao-seedream-5-0-lite-260128,doubao-seedream-5-0-lite-260128-apimart,'
      -- Seedream 4.5
      || 'doubao-seedream-4-5-251128,doubao-seedream-4-5-251128-apimart,'
      -- Seedream 4.0
      || 'doubao-seedream-4-0-250828,doubao-seedream-4-0-250828-apimart,'
      -- Kling 2.6（无 motion-control 后缀，视频生成基础路径）
      || 'kling-v2-6,kling-v2-6-apimart',
      ','
    )) AS t(m)
    WHERE trim(m) <> ''
  ) sub
)
WHERE name = 'apimart';

-- Step 2: 启用 watcha 渠道（seedream5.service.ts watcha 路径走此渠道）
-- 模型: seedream-5.0-lite, seedream-5.0, seedream-4.5, seedream-4.0
-- key 已正确配置（WATCHA_SEEDREAM_API_KEY）
UPDATE channels
SET status = 1
WHERE name = 'watcha' AND status != 1;

-- Step 3: 启用 ark-doubao 渠道（seed3d 走此渠道的 doubao task relay）
UPDATE channels
SET status = 1
WHERE name = 'ark-doubao' AND status != 1;

-- Step 4: 修正 ark-doubao-image 渠道 key（原来存了无效 key 导致 "API key doesn't exist"）
-- 确保 ark/ark-doubao/ark-doubao-image 三个渠道使用同一个 Ark API key
UPDATE channels
SET key = (SELECT key FROM channels WHERE name = 'ark' LIMIT 1)
WHERE name IN ('ark-doubao', 'ark-doubao-image')
  AND key != (SELECT key FROM channels WHERE name = 'ark' LIMIT 1);

-- Step 4b: 向 ark-doubao-image 补充 seedream 4.x 模型
-- （new-api 路由 doubao 图像时优先找 type 45 渠道，4.x 不在此渠道会报 "No available channel"）
UPDATE channels
SET models = (
  SELECT string_agg(m, ',' ORDER BY m)
  FROM (
    SELECT DISTINCT trim(m) AS m
    FROM unnest(string_to_array(
      models || ',doubao-seedream-4-5-251128,doubao-seedream-4-0-250828',
      ','
    )) AS t(m)
    WHERE trim(m) <> ''
  ) sub
)
WHERE name = 'ark-doubao-image';

-- Step 5: 向 ark-doubao 渠道补充 doubao-seed3d-2-0-260328 模型
UPDATE channels
SET models = (
  SELECT string_agg(m, ',' ORDER BY m)
  FROM (
    SELECT DISTINCT trim(m) AS m
    FROM unnest(string_to_array(
      models || ',doubao-seed3d-2-0-260328',
      ','
    )) AS t(m)
    WHERE trim(m) <> ''
  ) sub
)
WHERE name = 'ark-doubao';
