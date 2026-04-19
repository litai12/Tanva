-- 修复 Seedance 2.0 动态定价：
--   1. 更新 seedance-2.0 的 vendor pricing，确保 matchingRules 覆盖所有 inputType（text/image/image_audio）
--   2. 回填 seedance20Video / doubaoVideo NodeConfig，确保 defaultData 含 vendorKey / platformKey

BEGIN;

-- ─────────────────────────────────────────────
-- Step 1: 工具函数
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION replace_managed_vendor_pricing_s20(
  config jsonb,
  target_model_key text,
  target_vendor_key text,
  target_pricing jsonb
)
RETURNS jsonb
LANGUAGE sql
AS $fn$
  WITH source AS (
    SELECT COALESCE(config, '{}'::jsonb) AS cfg
  ),
  current_models AS (
    SELECT COALESCE(cfg->'models', '[]'::jsonb) AS models
    FROM source
  ),
  rebuilt_models AS (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN model_item->>'modelKey' = target_model_key THEN
            jsonb_set(
              model_item,
              '{vendors}',
              (
                SELECT COALESCE(
                  jsonb_agg(
                    CASE
                      WHEN vendor_item->>'vendorKey' = target_vendor_key
                        THEN jsonb_set(vendor_item, '{pricing}', target_pricing, true)
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
    ) AS models
    FROM current_models, jsonb_array_elements(current_models.models) AS model_item
  )
  SELECT jsonb_set((SELECT cfg FROM source), '{models}', rebuilt_models.models, true)
  FROM rebuilt_models;
$fn$;

-- ─────────────────────────────────────────────
-- Step 2: 更新 seedance-2.0 / seedance_api 定价
--   matchingRules 按 seedanceModel × resolution 匹配，
--   inputType 用 "exists" 检查（有值即可），不限制具体类型，
--   evaluator 为 linear，按秒计费
-- ─────────────────────────────────────────────

UPDATE "SystemSetting"
SET "value" = replace_managed_vendor_pricing_s20(
  "value"::jsonb,
  'seedance-2.0',
  'seedance_api',
  $pricing${
    "version": "v2",
    "dimensions": [
      {
        "key": "seedanceModel",
        "label": "Seedance 型号",
        "type": "enum",
        "required": true,
        "options": [
          {"value": "seedance-2.0",      "label": "Seedance 2.0"},
          {"value": "seedance-2.0-fast", "label": "Seedance 2.0 Fast"}
        ]
      },
      {
        "key": "resolution",
        "label": "分辨率",
        "type": "enum",
        "required": true,
        "options": [
          {"value": "480P", "label": "480P"},
          {"value": "720P", "label": "720P"}
        ]
      },
      {
        "key": "duration",
        "label": "时长（秒）",
        "type": "number",
        "required": true
      }
    ],
    "matchingRules": [
      {
        "ruleKey":       "seedance20_fast_480p",
        "label":         "Seedance 2.0 Fast 480P",
        "enabled":       true,
        "priority":      120,
        "evaluatorKey":  "seedance20_fast_480p_eval",
        "conditions": {
          "all": [
            {"field": "seedanceModel", "op": "eq",     "value": "seedance-2.0-fast"},
            {"field": "resolution",    "op": "eq",     "value": "480P"}
          ]
        }
      },
      {
        "ruleKey":       "seedance20_fast_720p",
        "label":         "Seedance 2.0 Fast 720P",
        "enabled":       true,
        "priority":      120,
        "evaluatorKey":  "seedance20_fast_720p_eval",
        "conditions": {
          "all": [
            {"field": "seedanceModel", "op": "eq",     "value": "seedance-2.0-fast"},
            {"field": "resolution",    "op": "eq",     "value": "720P"}
          ]
        }
      },
      {
        "ruleKey":       "seedance20_480p",
        "label":         "Seedance 2.0 480P",
        "enabled":       true,
        "priority":      110,
        "evaluatorKey":  "seedance20_480p_eval",
        "conditions": {
          "all": [
            {"field": "seedanceModel", "op": "eq",     "value": "seedance-2.0"},
            {"field": "resolution",    "op": "eq",     "value": "480P"}
          ]
        }
      },
      {
        "ruleKey":       "seedance20_720p",
        "label":         "Seedance 2.0 720P",
        "enabled":       true,
        "priority":      110,
        "evaluatorKey":  "seedance20_720p_eval",
        "conditions": {
          "all": [
            {"field": "seedanceModel", "op": "eq",     "value": "seedance-2.0"},
            {"field": "resolution",    "op": "eq",     "value": "720P"}
          ]
        }
      }
    ],
    "evaluators": {
      "seedance20_fast_480p_eval": {"type": "linear", "unitField": "duration", "unitPriceYuan": 0.372},
      "seedance20_fast_720p_eval": {"type": "linear", "unitField": "duration", "unitPriceYuan": 0.800},
      "seedance20_480p_eval":      {"type": "linear", "unitField": "duration", "unitPriceYuan": 0.462},
      "seedance20_720p_eval":      {"type": "linear", "unitField": "duration", "unitPriceYuan": 0.994}
    },
    "displayConfig": {
      "specAxes": ["seedanceModel", "resolution", "duration"],
      "labels": {
        "seedanceModel.seedance-2.0":      "Seedance 2.0",
        "seedanceModel.seedance-2.0-fast": "Seedance 2.0 Fast",
        "resolution.480P": "480P",
        "resolution.720P": "720P"
      },
      "defaultSelections": {
        "seedanceModel": "seedance-2.0",
        "resolution":    "720P",
        "duration":      5
      },
      "presets": [
        {"seedanceModel": "seedance-2.0",      "resolution": "720P", "duration": 5},
        {"seedanceModel": "seedance-2.0",      "resolution": "720P", "duration": 10},
        {"seedanceModel": "seedance-2.0-fast", "resolution": "480P", "duration": 5},
        {"seedanceModel": "seedance-2.0-fast", "resolution": "720P", "duration": 5}
      ]
    }
  }$pricing$::jsonb
)::text
WHERE "key" = 'model_provider_mapping_v2';

-- ─────────────────────────────────────────────
-- Step 3: 回填 seedance20Video NodeConfig
--   确保 defaultData 含 vendorKey / platformKey / managedModelKey
-- ─────────────────────────────────────────────

UPDATE "NodeConfig"
SET "metadata" = jsonb_set(
  jsonb_set(
    jsonb_set(
      COALESCE("metadata"::jsonb, '{}'::jsonb),
      '{managedModelKey}',
      '"seedance-2.0"',
      true
    ),
    '{defaultData}',
    COALESCE("metadata"::jsonb->'defaultData', '{}'::jsonb)
    || '{"vendorKey":"seedance_api","platformKey":"seedance_api","managedModelKey":"seedance-2.0"}'::jsonb,
    true
  ),
  '{defaultDataPatch}',
  COALESCE("metadata"::jsonb->'defaultDataPatch', '{}'::jsonb)
  || '{"vendorKey":"seedance_api","platformKey":"seedance_api","managedModelKey":"seedance-2.0"}'::jsonb,
  true
)
WHERE "nodeKey" = 'seedance20Video';

-- ─────────────────────────────────────────────
-- Step 4: 回填 doubaoVideo NodeConfig（Seedance 1.5）
-- ─────────────────────────────────────────────

UPDATE "NodeConfig"
SET "metadata" = jsonb_set(
  jsonb_set(
    jsonb_set(
      COALESCE("metadata"::jsonb, '{}'::jsonb),
      '{managedModelKey}',
      '"seedance-1.5"',
      true
    ),
    '{defaultData}',
    COALESCE("metadata"::jsonb->'defaultData', '{}'::jsonb)
    || '{"vendorKey":"seedance_api","platformKey":"seedance_api","managedModelKey":"seedance-1.5"}'::jsonb,
    true
  ),
  '{defaultDataPatch}',
  COALESCE("metadata"::jsonb->'defaultDataPatch', '{}'::jsonb)
  || '{"vendorKey":"seedance_api","platformKey":"seedance_api","managedModelKey":"seedance-1.5"}'::jsonb,
  true
)
WHERE "nodeKey" = 'doubaoVideo';

-- ─────────────────────────────────────────────
-- Step 5: 清理工具函数
-- ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS replace_managed_vendor_pricing_s20(jsonb, text, text, jsonb);

COMMIT;
