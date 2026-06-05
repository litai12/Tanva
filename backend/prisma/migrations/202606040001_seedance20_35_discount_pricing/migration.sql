-- Apply 35% Seedance 2.0 parameter pricing while keeping 100 credits = 1 yuan.

BEGIN;

CREATE OR REPLACE FUNCTION replace_managed_vendor_pricing_s20_discount(
  config jsonb,
  target_model_key text,
  target_vendor_key text,
  target_pricing jsonb,
  target_default_credits jsonb,
  target_default_price_yuan jsonb
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
                      WHEN vendor_item->>'vendorKey' = target_vendor_key THEN
                        jsonb_set(
                          jsonb_set(
                            jsonb_set(vendor_item, '{pricing}', target_pricing, true),
                            '{creditsPerCall}',
                            target_default_credits,
                            true
                          ),
                          '{priceYuan}',
                          target_default_price_yuan,
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
    ) AS models
    FROM current_models, jsonb_array_elements(current_models.models) AS model_item
  )
  SELECT jsonb_set((SELECT cfg FROM source), '{models}', rebuilt_models.models, true)
  FROM rebuilt_models;
$fn$;

UPDATE "SystemSetting"
SET "value" = replace_managed_vendor_pricing_s20_discount(
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
          {"value": "seedance-2.0", "label": "Seedance 2.0"},
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
          {"value": "720P", "label": "720P"},
          {"value": "1080P", "label": "1080P"}
        ]
      },
      {
        "key": "duration",
        "label": "时长(秒)",
        "type": "number",
        "required": true
      }
    ],
    "matchingRules": [
      {
        "ruleKey": "seedance20_fast_480p",
        "label": "Seedance 2.0 Fast 480P",
        "enabled": true,
        "priority": 120,
        "evaluatorKey": "seedance20_fast_480p_eval",
        "conditions": {
          "all": [
            {"field": "seedanceModel", "op": "eq", "value": "seedance-2.0-fast"},
            {"field": "resolution", "op": "eq", "value": "480P"}
          ]
        }
      },
      {
        "ruleKey": "seedance20_fast_720p",
        "label": "Seedance 2.0 Fast 720P",
        "enabled": true,
        "priority": 120,
        "evaluatorKey": "seedance20_fast_720p_eval",
        "conditions": {
          "all": [
            {"field": "seedanceModel", "op": "eq", "value": "seedance-2.0-fast"},
            {"field": "resolution", "op": "eq", "value": "720P"}
          ]
        }
      },
      {
        "ruleKey": "seedance20_480p",
        "label": "Seedance 2.0 480P",
        "enabled": true,
        "priority": 110,
        "evaluatorKey": "seedance20_480p_eval",
        "conditions": {
          "all": [
            {"field": "seedanceModel", "op": "eq", "value": "seedance-2.0"},
            {"field": "resolution", "op": "eq", "value": "480P"}
          ]
        }
      },
      {
        "ruleKey": "seedance20_720p",
        "label": "Seedance 2.0 720P",
        "enabled": true,
        "priority": 110,
        "evaluatorKey": "seedance20_720p_eval",
        "conditions": {
          "all": [
            {"field": "seedanceModel", "op": "eq", "value": "seedance-2.0"},
            {"field": "resolution", "op": "eq", "value": "720P"}
          ]
        }
      },
      {
        "ruleKey": "seedance20_1080p",
        "label": "Seedance 2.0 1080P",
        "enabled": true,
        "priority": 110,
        "evaluatorKey": "seedance20_1080p_eval",
        "conditions": {
          "all": [
            {"field": "seedanceModel", "op": "eq", "value": "seedance-2.0"},
            {"field": "resolution", "op": "eq", "value": "1080P"}
          ]
        }
      }
    ],
    "evaluators": {
      "seedance20_fast_480p_eval": {"type": "linear", "unitField": "duration", "unitPriceYuan": 0.2821},
      "seedance20_fast_720p_eval": {"type": "linear", "unitField": "duration", "unitPriceYuan": 0.3381},
      "seedance20_480p_eval": {"type": "linear", "unitField": "duration", "unitPriceYuan": 0.35},
      "seedance20_720p_eval": {"type": "linear", "unitField": "duration", "unitPriceYuan": 0.42},
      "seedance20_1080p_eval": {"type": "linear", "unitField": "duration", "unitPriceYuan": 1.05}
    },
    "displayConfig": {
      "specAxes": ["seedanceModel", "resolution", "duration"],
      "labels": {
        "seedanceModel.seedance-2.0": "Seedance 2.0",
        "seedanceModel.seedance-2.0-fast": "Seedance 2.0 Fast",
        "resolution.480P": "480P",
        "resolution.720P": "720P",
        "resolution.1080P": "1080P"
      },
      "defaultSelections": {
        "seedanceModel": "seedance-2.0",
        "resolution": "720P",
        "duration": 5
      },
      "presets": [
        {"seedanceModel": "seedance-2.0", "resolution": "720P", "duration": 5},
        {"seedanceModel": "seedance-2.0", "resolution": "720P", "duration": 10},
        {"seedanceModel": "seedance-2.0", "resolution": "1080P", "duration": 5},
        {"seedanceModel": "seedance-2.0-fast", "resolution": "480P", "duration": 5},
        {"seedanceModel": "seedance-2.0-fast", "resolution": "720P", "duration": 5}
      ]
    }
  }$pricing$::jsonb,
  '210'::jsonb,
  '2.1'::jsonb
)::text
WHERE "key" = 'model_provider_mapping_v2';

UPDATE "NodeConfig"
SET
  "creditsPerCall" = 210,
  "priceYuan" = 2.10,
  "metadata" = jsonb_set(
    jsonb_set(
      jsonb_set(
        COALESCE("metadata"::jsonb, '{}'::jsonb),
        '{managedModelKey}',
        '"seedance-2.0"',
        true
      ),
      '{defaultData}',
      COALESCE("metadata"::jsonb->'defaultData', '{}'::jsonb)
      || '{"vendorKey":"seedance_api","platformKey":"seedance_api","managedModelKey":"seedance-2.0","creditsPerCall":210}'::jsonb,
      true
    ),
    '{defaultDataPatch}',
    COALESCE("metadata"::jsonb->'defaultDataPatch', '{}'::jsonb)
    || '{"vendorKey":"seedance_api","platformKey":"seedance_api","managedModelKey":"seedance-2.0","creditsPerCall":210}'::jsonb,
    true
  )
WHERE "nodeKey" = 'seedance20Video';

DROP FUNCTION IF EXISTS replace_managed_vendor_pricing_s20_discount(jsonb, text, text, jsonb, jsonb, jsonb);

COMMIT;
