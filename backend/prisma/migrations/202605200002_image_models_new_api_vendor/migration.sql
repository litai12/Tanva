-- 将图像模型（gemini-2.5-image / gemini-3-pro-image / gemini-image-blend /
-- gemini-2.5-image-analyze / gpt-image-2）的默认 vendor 切换到 new_api 渠道，
-- 并回填 generate / generate4 / generatePro / generatePro4 / generateReference / gptImage2
-- NodeConfig 的 managedModelKey 元数据。
--
-- 幂等：
--   SystemSetting  — 追加 new_api vendor（已存在则跳过），设 defaultVendor=new_api；
--                    gpt-image-2 不存在时整体插入。
--   NodeConfig     — || 合并（保留已有字段，仅补充/覆盖 managed 相关字段）。

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1: 工具函数 — 给 model_provider_mapping_v2 中指定模型追加 new_api vendor
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION upsert_img_model_new_api(
  config      jsonb,
  p_key       text,
  p_vendor    jsonb,
  p_new_model jsonb   -- 当模型不存在时整体插入
) RETURNS jsonb
LANGUAGE sql AS $fn$
  WITH
  models AS (
    SELECT COALESCE(config->'models', '[]'::jsonb) AS arr
  ),
  model_found AS (
    SELECT bool_or(el->>'modelKey' = p_key) AS v
    FROM models, jsonb_array_elements(models.arr) el
  ),
  vendor_found AS (
    SELECT bool_or(v->>'vendorKey' = 'new_api') AS v
    FROM models,
         jsonb_array_elements(models.arr) el,
         jsonb_array_elements(COALESCE(el->'vendors', '[]'::jsonb)) v
    WHERE el->>'modelKey' = p_key
  ),
  patched AS (
    SELECT COALESCE(
      jsonb_agg(
        CASE WHEN el->>'modelKey' = p_key THEN
          el
          || jsonb_build_object('defaultVendor', 'new_api')
          || CASE WHEN COALESCE((SELECT v FROM vendor_found), false)
               THEN '{}'::jsonb
               ELSE jsonb_build_object(
                      'vendors',
                      COALESCE(el->'vendors', '[]'::jsonb) || jsonb_build_array(p_vendor)
                    )
             END
        ELSE el END
      ),
      '[]'::jsonb
    ) AS arr
    FROM models, jsonb_array_elements(models.arr) el
  )
  SELECT jsonb_set(
    config,
    '{models}',
    CASE WHEN (SELECT v FROM model_found)
      THEN (SELECT arr FROM patched)
      ELSE COALESCE((SELECT arr FROM patched), '[]'::jsonb) || jsonb_build_array(p_new_model)
    END,
    true
  );
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: 更新 SystemSetting.model_provider_mapping_v2
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE "SystemSetting"
SET "value" = upsert_img_model_new_api(
  "value"::jsonb,
  'gemini-2.5-image',
  '{"vendorKey":"new_api","platformKey":"new_api","label":"New API","enabled":true,"route":"legacy","provider":"new-api","modelName":"gemini-2.5-flash-image-preview","creditsPerCall":20,"priceYuan":0.2}'::jsonb,
  '{"modelKey":"gemini-2.5-image","modelName":"Gemini 2.5 Flash Image","taskType":"image","enabled":true,"defaultVendor":"new_api","vendors":[{"vendorKey":"new_api","platformKey":"new_api","label":"New API","enabled":true,"route":"legacy","provider":"new-api","modelName":"gemini-2.5-flash-image-preview","creditsPerCall":20,"priceYuan":0.2}]}'::jsonb
)::text
WHERE "key" = 'model_provider_mapping_v2';

UPDATE "SystemSetting"
SET "value" = upsert_img_model_new_api(
  "value"::jsonb,
  'gemini-3-pro-image',
  '{"vendorKey":"new_api","platformKey":"new_api","label":"New API","enabled":true,"route":"legacy","provider":"new-api","modelName":"gemini-3-pro","creditsPerCall":40,"priceYuan":0.4}'::jsonb,
  '{"modelKey":"gemini-3-pro-image","modelName":"Gemini 3 Pro Image","taskType":"image","enabled":true,"defaultVendor":"new_api","vendors":[{"vendorKey":"new_api","platformKey":"new_api","label":"New API","enabled":true,"route":"legacy","provider":"new-api","modelName":"gemini-3-pro","creditsPerCall":40,"priceYuan":0.4}]}'::jsonb
)::text
WHERE "key" = 'model_provider_mapping_v2';

UPDATE "SystemSetting"
SET "value" = upsert_img_model_new_api(
  "value"::jsonb,
  'gemini-image-blend',
  '{"vendorKey":"new_api","platformKey":"new_api","label":"New API","enabled":true,"route":"legacy","provider":"new-api","modelName":"gemini-2.5-flash-image-preview","creditsPerCall":40,"priceYuan":0.4}'::jsonb,
  '{"modelKey":"gemini-image-blend","modelName":"Gemini Image Blend","taskType":"image","enabled":true,"defaultVendor":"new_api","vendors":[{"vendorKey":"new_api","platformKey":"new_api","label":"New API","enabled":true,"route":"legacy","provider":"new-api","modelName":"gemini-2.5-flash-image-preview","creditsPerCall":40,"priceYuan":0.4}]}'::jsonb
)::text
WHERE "key" = 'model_provider_mapping_v2';

UPDATE "SystemSetting"
SET "value" = upsert_img_model_new_api(
  "value"::jsonb,
  'gemini-2.5-image-analyze',
  '{"vendorKey":"new_api","platformKey":"new_api","label":"New API","enabled":true,"route":"legacy","provider":"new-api","modelName":"gemini-2.5-pro","creditsPerCall":10,"priceYuan":0.1}'::jsonb,
  '{"modelKey":"gemini-2.5-image-analyze","modelName":"Gemini 2.5 Image Analyze","taskType":"image","enabled":true,"defaultVendor":"new_api","vendors":[{"vendorKey":"new_api","platformKey":"new_api","label":"New API","enabled":true,"route":"legacy","provider":"new-api","modelName":"gemini-2.5-pro","creditsPerCall":10,"priceYuan":0.1}]}'::jsonb
)::text
WHERE "key" = 'model_provider_mapping_v2';

UPDATE "SystemSetting"
SET "value" = upsert_img_model_new_api(
  "value"::jsonb,
  'gpt-image-2',
  '{"vendorKey":"new_api","platformKey":"new_api","label":"New API","enabled":true,"route":"legacy","provider":"new-api","modelName":"gpt-image-2","creditsPerCall":40,"priceYuan":0.4}'::jsonb,
  '{"modelKey":"gpt-image-2","modelName":"GPT-Image-2","taskType":"image","enabled":true,"defaultVendor":"new_api","vendors":[{"vendorKey":"new_api","platformKey":"new_api","label":"New API","enabled":true,"route":"legacy","provider":"new-api","modelName":"gpt-image-2","creditsPerCall":40,"priceYuan":0.4}]}'::jsonb
)::text
WHERE "key" = 'model_provider_mapping_v2';

DROP FUNCTION IF EXISTS upsert_img_model_new_api(jsonb, text, jsonb, jsonb);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3: 回填 NodeConfig.metadata（managedModelKey / routeStrategy / defaultData）
-- ─────────────────────────────────────────────────────────────────────────────

-- generate：gemini-2.5-image，20 credits
UPDATE "NodeConfig"
SET "metadata" = COALESCE("metadata"::jsonb, '{}'::jsonb)
  || '{"modelKeys":["gemini-2.5-image"],"managedModelKey":"gemini-2.5-image","routeStrategy":"model_management_v2","nodeKind":"ai_image_generation"}'::jsonb
  || jsonb_build_object('defaultData',
       COALESCE("metadata"::jsonb->'defaultData', '{}'::jsonb)
       || '{"managedModelKey":"gemini-2.5-image","creditsPerCall":20}'::jsonb)
WHERE "nodeKey" = 'generate';

-- generate4：gemini-2.5-image，80 credits
UPDATE "NodeConfig"
SET "metadata" = COALESCE("metadata"::jsonb, '{}'::jsonb)
  || '{"modelKeys":["gemini-2.5-image"],"managedModelKey":"gemini-2.5-image","routeStrategy":"model_management_v2","nodeKind":"ai_image_generation"}'::jsonb
  || jsonb_build_object('defaultData',
       COALESCE("metadata"::jsonb->'defaultData', '{}'::jsonb)
       || '{"managedModelKey":"gemini-2.5-image","creditsPerCall":80}'::jsonb)
WHERE "nodeKey" = 'generate4';

-- generatePro：gemini-3-pro-image，40 credits
UPDATE "NodeConfig"
SET "metadata" = COALESCE("metadata"::jsonb, '{}'::jsonb)
  || '{"modelKeys":["gemini-3-pro-image"],"managedModelKey":"gemini-3-pro-image","routeStrategy":"model_management_v2","nodeKind":"ai_image_generation"}'::jsonb
  || jsonb_build_object('defaultData',
       COALESCE("metadata"::jsonb->'defaultData', '{}'::jsonb)
       || '{"managedModelKey":"gemini-3-pro-image","creditsPerCall":40}'::jsonb)
WHERE "nodeKey" = 'generatePro';

-- generatePro4：gemini-3-pro-image，160 credits
UPDATE "NodeConfig"
SET "metadata" = COALESCE("metadata"::jsonb, '{}'::jsonb)
  || '{"modelKeys":["gemini-3-pro-image"],"managedModelKey":"gemini-3-pro-image","routeStrategy":"model_management_v2","nodeKind":"ai_image_generation"}'::jsonb
  || jsonb_build_object('defaultData',
       COALESCE("metadata"::jsonb->'defaultData', '{}'::jsonb)
       || '{"managedModelKey":"gemini-3-pro-image","creditsPerCall":160}'::jsonb)
WHERE "nodeKey" = 'generatePro4';

-- generateReference：gemini-image-blend，40 credits
UPDATE "NodeConfig"
SET "metadata" = COALESCE("metadata"::jsonb, '{}'::jsonb)
  || '{"modelKeys":["gemini-image-blend"],"managedModelKey":"gemini-image-blend","routeStrategy":"model_management_v2","nodeKind":"ai_image_generation"}'::jsonb
  || jsonb_build_object('defaultData',
       COALESCE("metadata"::jsonb->'defaultData', '{}'::jsonb)
       || '{"managedModelKey":"gemini-image-blend","creditsPerCall":40}'::jsonb)
WHERE "nodeKey" = 'generateReference';

-- gptImage2：保留现有字段（type/model/provider/resolutions/aspectRatios 等），追加 managed 字段
UPDATE "NodeConfig"
SET "metadata" = COALESCE("metadata"::jsonb, '{}'::jsonb)
  || '{"modelKeys":["gpt-image-2"],"managedModelKey":"gpt-image-2","routeStrategy":"model_management_v2","nodeKind":"ai_image_generation"}'::jsonb
  || jsonb_build_object('defaultData',
       COALESCE("metadata"::jsonb->'defaultData', '{}'::jsonb)
       || '{"managedModelKey":"gpt-image-2"}'::jsonb)
WHERE "nodeKey" = 'gptImage2';

COMMIT;
