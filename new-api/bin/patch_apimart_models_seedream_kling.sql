-- patch_apimart_models_seedream_kling.sql
-- 向 apimart 渠道补充 seedream 图像模型和 kling-v2-6 视频模型
-- 背景：
--   1. seedream5.service.ts 已从 /proxy/ark/images/generations 改为
--      /v1/images/generations 标准路由，需要模型名注册在渠道里
--   2. kling-v2-6（非 motion-control 场景）未在 apimart 中注册
-- 幂等：使用 unnest+DISTINCT 去重，可安全重复执行

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
