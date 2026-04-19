-- 修复 kling30Video NodeConfig，确保动态计费能正确命中 tencent_vod pricing rules
-- 问题：
--   1. defaultData 缺少 vendorKey/platformKey/managedModelKey → resolveManagedRoutePricing 直接返回 null → 走 600 兜底
--   2. defaultData 缺少 resolution → pricingContext 无 resolution 字段 → 无法命中按分辨率的匹配规则
-- 修复：在 defaultData 和 defaultDataPatch 补齐以上字段

BEGIN;

-- ─────────────────────────────────────────────
-- Step 1: 回填 kling30Video NodeConfig
--   补充 vendorKey / platformKey / managedModelKey / resolution / clipDuration
-- ─────────────────────────────────────────────

UPDATE "NodeConfig"
SET "metadata" = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE("metadata"::jsonb, '{}'::jsonb),
          '{managedModelKey}',
          '"kling-3.0"',
          true
        ),
        '{defaultData}',
        COALESCE("metadata"::jsonb->'defaultData', '{}'::jsonb)
        || '{"vendorKey":"tencent_vod","platformKey":"tencent_vod","managedModelKey":"kling-3.0","resolution":"720P","clipDuration":5}'::jsonb,
        true
      ),
      '{defaultDataPatch}',
      COALESCE("metadata"::jsonb->'defaultDataPatch', '{}'::jsonb)
      || '{"vendorKey":"tencent_vod","platformKey":"tencent_vod","managedModelKey":"kling-3.0","resolution":"720P","clipDuration":5}'::jsonb,
      true
    ),
    '{billingType}',
    '"dynamic"',
    true
  ),
  '{durationRange}',
  '{"min":3,"max":15}'::jsonb,
  true
)
WHERE "nodeKey" = 'kling30Video';

-- ─────────────────────────────────────────────
-- Step 2: 同步更新 migration 002 写入的 kling-3.0/tencent_vod pricing
--   将 displayConfig.defaultSelections 补充 resolution 默认值，
--   确保前端无 resolution 时仍可正确显示默认价格预估
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION patch_kling30_tencent_pricing_display(config jsonb)
RETURNS jsonb
LANGUAGE sql
AS $fn$
  WITH source AS (
    SELECT COALESCE(config, '{}'::jsonb) AS cfg
  ),
  models AS (
    SELECT COALESCE(cfg->'models', '[]'::jsonb) AS m FROM source
  ),
  patched AS (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN model_item->>'modelKey' = 'kling-3.0' THEN
            jsonb_set(
              model_item,
              '{vendors}',
              (
                SELECT COALESCE(
                  jsonb_agg(
                    CASE
                      WHEN vendor_item->>'vendorKey' = 'tencent_vod' THEN
                        jsonb_set(
                          vendor_item,
                          '{pricing,displayConfig,defaultSelections}',
                          COALESCE(
                            vendor_item->'pricing'->'displayConfig'->'defaultSelections',
                            '{}'::jsonb
                          ) || '{"hasAudio":false,"resolution":"720P","duration":5}'::jsonb,
                          true
                        )
                      ELSE vendor_item
                    END
                  ),
                  '[]'::jsonb
                )
                FROM jsonb_array_elements(COALESCE(model_item->'vendors', '[]'::jsonb)) vendor_item
              ),
              true
            )
          ELSE model_item
        END
      ),
      '[]'::jsonb
    ) AS result
    FROM models, jsonb_array_elements(models.m) AS model_item
  )
  SELECT jsonb_set((SELECT cfg FROM source), '{models}', result, true)
  FROM patched;
$fn$;

UPDATE "SystemSetting"
SET "value" = patch_kling30_tencent_pricing_display("value"::jsonb)::text
WHERE "key" = 'model_provider_mapping_v2';

DROP FUNCTION IF EXISTS patch_kling30_tencent_pricing_display(jsonb);

COMMIT;
