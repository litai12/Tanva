-- 新增 Seedance 2.0（doubao-seedance-2-0-260128）1080P 分辨率支持：
--   1. 在 seedance-2.0 / seedance_api vendor pricing 中追加 1080P 维度选项、匹配规则、评估器
--      仅作用于 seedance-2.0（非 fast）。fast 维持 480P / 720P。
--   2. 回填 seedance20Video NodeConfig 的 outputConfig.resolutions，包含 "1080P"。
--
-- 1080P 单价换算：
--   官方比例 51/46 ≈ 1.1087；720P 现价 0.994 元/秒；
--   故 1080P = 0.994 × 51/46 ≈ 1.102 元/秒。

BEGIN;

-- ─────────────────────────────────────────────
-- Step 1: 工具函数（与 202604190001 同名重建一次，兼容单独执行场景）
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
-- Step 2: 重写 seedance-2.0 / seedance_api 定价
--   维度新增 1080P；新增 seedance20_1080p 匹配规则与评估器
--   fast 仍只有 480P / 720P
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
        "ruleKey":       "seedance20_fast_480p",
        "label":         "Seedance 2.0 Fast 480P",
        "enabled":       true,
        "priority":      120,
        "evaluatorKey":  "seedance20_fast_480p_eval",
        "conditions": {
          "all": [
            {"field": "seedanceModel", "op": "eq", "value": "seedance-2.0-fast"},
            {"field": "resolution",    "op": "eq", "value": "480P"}
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
            {"field": "seedanceModel", "op": "eq", "value": "seedance-2.0-fast"},
            {"field": "resolution",    "op": "eq", "value": "720P"}
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
            {"field": "seedanceModel", "op": "eq", "value": "seedance-2.0"},
            {"field": "resolution",    "op": "eq", "value": "480P"}
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
            {"field": "seedanceModel", "op": "eq", "value": "seedance-2.0"},
            {"field": "resolution",    "op": "eq", "value": "720P"}
          ]
        }
      },
      {
        "ruleKey":       "seedance20_1080p",
        "label":         "Seedance 2.0 1080P",
        "enabled":       true,
        "priority":      110,
        "evaluatorKey":  "seedance20_1080p_eval",
        "conditions": {
          "all": [
            {"field": "seedanceModel", "op": "eq", "value": "seedance-2.0"},
            {"field": "resolution",    "op": "eq", "value": "1080P"}
          ]
        }
      }
    ],
    "evaluators": {
      "seedance20_fast_480p_eval": {"type": "linear", "unitField": "duration", "unitPriceYuan": 0.372},
      "seedance20_fast_720p_eval": {"type": "linear", "unitField": "duration", "unitPriceYuan": 0.800},
      "seedance20_480p_eval":      {"type": "linear", "unitField": "duration", "unitPriceYuan": 0.462},
      "seedance20_720p_eval":      {"type": "linear", "unitField": "duration", "unitPriceYuan": 0.994},
      "seedance20_1080p_eval":     {"type": "linear", "unitField": "duration", "unitPriceYuan": 1.102}
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

-- ─────────────────────────────────────────────
-- Step 3: 回填 seedance20Video NodeConfig 的 outputConfig.resolutions
--   将 metadata.vod.outputConfig.resolutions 替换为 ["480P","720P","1080P"]
--   （保留 seedance-2.0-fast 的可选模型，但 fast 在前端会被限制为 480P/720P）
-- ─────────────────────────────────────────────

UPDATE "NodeConfig"
SET "metadata" = jsonb_set(
  jsonb_set(
    COALESCE("metadata"::jsonb, '{}'::jsonb),
    '{vod}',
    COALESCE("metadata"::jsonb->'vod', '{}'::jsonb),
    true
  ),
  '{vod,outputConfig}',
  COALESCE("metadata"::jsonb->'vod'->'outputConfig', '{}'::jsonb)
    || '{"resolutions":["480P","720P","1080P"]}'::jsonb,
  true
)
WHERE "nodeKey" = 'seedance20Video';

-- ─────────────────────────────────────────────
-- Step 4: 清理工具函数
-- ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS replace_managed_vendor_pricing_s20(jsonb, text, text, jsonb);

COMMIT;
