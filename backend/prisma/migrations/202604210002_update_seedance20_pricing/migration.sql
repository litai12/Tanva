-- 调整 Seedance 2.0 定价（含 Fast 变体）
--
-- 锚点价格（用户指定）：
--   seedance-2.0  480P  10s = 1000 credits = 1.000 yuan/s
--   seedance-2.0  720P  10s = 1200 credits = 1.200 yuan/s
--   seedance-2.0 1080P  10s = 3000 credits = 3.000 yuan/s
--
-- Fast 变体保持与 normal 相同比例（历史比例 ≈ 0.805）：
--   seedance-2.0-fast 480P = 1.000 × 0.805 = 0.805 yuan/s
--   seedance-2.0-fast 720P = 1.200 × 0.805 = 0.966 yuan/s

BEGIN;

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
          {"value": "480P",  "label": "480P"},
          {"value": "720P",  "label": "720P"},
          {"value": "1080P", "label": "1080P"}
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
        "ruleKey":      "seedance20_fast_480p",
        "label":        "Seedance 2.0 Fast 480P",
        "enabled":      true,
        "priority":     120,
        "evaluatorKey": "seedance20_fast_480p_eval",
        "conditions": {
          "all": [
            {"field": "seedanceModel", "op": "eq", "value": "seedance-2.0-fast"},
            {"field": "resolution",    "op": "eq", "value": "480P"}
          ]
        }
      },
      {
        "ruleKey":      "seedance20_fast_720p",
        "label":        "Seedance 2.0 Fast 720P",
        "enabled":      true,
        "priority":     120,
        "evaluatorKey": "seedance20_fast_720p_eval",
        "conditions": {
          "all": [
            {"field": "seedanceModel", "op": "eq", "value": "seedance-2.0-fast"},
            {"field": "resolution",    "op": "eq", "value": "720P"}
          ]
        }
      },
      {
        "ruleKey":      "seedance20_480p",
        "label":        "Seedance 2.0 480P",
        "enabled":      true,
        "priority":     110,
        "evaluatorKey": "seedance20_480p_eval",
        "conditions": {
          "all": [
            {"field": "seedanceModel", "op": "eq", "value": "seedance-2.0"},
            {"field": "resolution",    "op": "eq", "value": "480P"}
          ]
        }
      },
      {
        "ruleKey":      "seedance20_720p",
        "label":        "Seedance 2.0 720P",
        "enabled":      true,
        "priority":     110,
        "evaluatorKey": "seedance20_720p_eval",
        "conditions": {
          "all": [
            {"field": "seedanceModel", "op": "eq", "value": "seedance-2.0"},
            {"field": "resolution",    "op": "eq", "value": "720P"}
          ]
        }
      },
      {
        "ruleKey":      "seedance20_1080p",
        "label":        "Seedance 2.0 1080P",
        "enabled":      true,
        "priority":     110,
        "evaluatorKey": "seedance20_1080p_eval",
        "conditions": {
          "all": [
            {"field": "seedanceModel", "op": "eq", "value": "seedance-2.0"},
            {"field": "resolution",    "op": "eq", "value": "1080P"}
          ]
        }
      }
    ],
    "evaluators": {
      "seedance20_fast_480p_eval": {"type": "linear", "unitField": "duration", "unitPriceYuan": 0.805},
      "seedance20_fast_720p_eval": {"type": "linear", "unitField": "duration", "unitPriceYuan": 0.966},
      "seedance20_480p_eval":      {"type": "linear", "unitField": "duration", "unitPriceYuan": 1.000},
      "seedance20_720p_eval":      {"type": "linear", "unitField": "duration", "unitPriceYuan": 1.200},
      "seedance20_1080p_eval":     {"type": "linear", "unitField": "duration", "unitPriceYuan": 3.000}
    },
    "displayConfig": {
      "specAxes": ["seedanceModel", "resolution", "duration"],
      "labels": {
        "seedanceModel.seedance-2.0":      "Seedance 2.0",
        "seedanceModel.seedance-2.0-fast": "Seedance 2.0 Fast",
        "resolution.480P":  "480P",
        "resolution.720P":  "720P",
        "resolution.1080P": "1080P"
      },
      "defaultSelections": {
        "seedanceModel": "seedance-2.0",
        "resolution":    "720P",
        "duration":      5
      },
      "presets": [
        {"seedanceModel": "seedance-2.0",      "resolution": "720P",  "duration": 5},
        {"seedanceModel": "seedance-2.0",      "resolution": "720P",  "duration": 10},
        {"seedanceModel": "seedance-2.0",      "resolution": "1080P", "duration": 5},
        {"seedanceModel": "seedance-2.0-fast", "resolution": "480P",  "duration": 5},
        {"seedanceModel": "seedance-2.0-fast", "resolution": "720P",  "duration": 5}
      ]
    }
  }$pricing$::jsonb
)::text
WHERE "key" = 'model_provider_mapping_v2';

DROP FUNCTION IF EXISTS replace_managed_vendor_pricing_s20(jsonb, text, text, jsonb);

COMMIT;
