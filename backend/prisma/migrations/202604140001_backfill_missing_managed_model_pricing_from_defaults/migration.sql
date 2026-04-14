BEGIN;

CREATE OR REPLACE FUNCTION patch_managed_model_vendor(
  config jsonb,
  target_model_key text,
  target_vendor_key text,
  vendor_patch jsonb,
  metadata_patch jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  next_config jsonb;
BEGIN
  SELECT jsonb_set(
    config,
    '{models}',
    COALESCE(
      (
        SELECT jsonb_agg(
          CASE
            WHEN model_item->>'modelKey' = target_model_key THEN
              jsonb_strip_nulls(
                model_item ||
                CASE
                  WHEN metadata_patch IS NULL THEN '{}'::jsonb
                  ELSE jsonb_build_object(
                    'metadata',
                    COALESCE(model_item->'metadata', '{}'::jsonb) || metadata_patch
                  )
                END ||
                jsonb_build_object(
                  'vendors',
                  COALESCE(
                    (
                      SELECT jsonb_agg(
                        CASE
                          WHEN vendor_item->>'vendorKey' = target_vendor_key THEN
                            jsonb_strip_nulls(vendor_item || vendor_patch)
                          ELSE vendor_item
                        END
                      )
                      FROM jsonb_array_elements(COALESCE(model_item->'vendors', '[]'::jsonb)) AS vendor_item
                    ),
                    '[]'::jsonb
                  )
                )
              )
            ELSE model_item
          END
        )
        FROM jsonb_array_elements(COALESCE(config->'models', '[]'::jsonb)) AS model_item
      ),
      '[]'::jsonb
    ),
    true
  )
  INTO next_config;

  RETURN next_config;
END;
$fn$;

CREATE OR REPLACE FUNCTION apply_missing_managed_model_pricing_defaults(config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  next_config jsonb := config;
BEGIN
  next_config := patch_managed_model_vendor(
    next_config,
    'gemini-3-pro-image',
    'banana',
    '{
      "creditsPerCall": 40,
      "priceYuan": 0.4,
      "pricing": {
        "defaults": { "credits": 40, "priceYuan": 0.4 },
        "rules": [
          { "when": { "resolution": "2K" }, "price": { "credits": 60, "priceYuan": 0.6 } },
          { "when": { "resolution": "4K" }, "price": { "credits": 80, "priceYuan": 0.8 } }
        ]
      }
    }'::jsonb,
    '{
      "specPricing": {
        "defaults": { "credits": 40 },
        "rules": [
          { "when": { "resolution": "2K" }, "price": { "credits": 60, "priceYuan": 0.6 } },
          { "when": { "resolution": "4K" }, "price": { "credits": 80, "priceYuan": 0.8 } }
        ]
      }
    }'::jsonb
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'gemini-3.1-image',
    'banana-3.1',
    '{
      "creditsPerCall": 30,
      "priceYuan": 0.3,
      "pricing": {
        "defaults": { "credits": 30, "priceYuan": 0.3 },
        "rules": [
          { "when": { "resolution": "0.5K" }, "price": { "credits": 30, "priceYuan": 0.3 } },
          { "when": { "resolution": "2K" }, "price": { "credits": 40, "priceYuan": 0.4 } },
          { "when": { "resolution": "4K" }, "price": { "credits": 50, "priceYuan": 0.5 } }
        ]
      }
    }'::jsonb,
    '{
      "specPricing": {
        "defaults": { "credits": 30 },
        "rules": [
          { "when": { "resolution": "0.5K" }, "price": { "credits": 30, "priceYuan": 0.3 } },
          { "when": { "resolution": "2K" }, "price": { "credits": 40, "priceYuan": 0.4 } },
          { "when": { "resolution": "4K" }, "price": { "credits": 50, "priceYuan": 0.5 } }
        ]
      }
    }'::jsonb
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'gemini-image-edit',
    'banana',
    '{
      "creditsPerCall": 40,
      "priceYuan": 0.4,
      "pricing": {
        "defaults": { "credits": 40, "priceYuan": 0.4 },
        "rules": [
          { "when": { "resolution": "2K" }, "price": { "credits": 60, "priceYuan": 0.6 } },
          { "when": { "resolution": "4K" }, "price": { "credits": 80, "priceYuan": 0.8 } }
        ]
      }
    }'::jsonb,
    '{
      "specPricing": {
        "defaults": { "credits": 40 },
        "rules": [
          { "when": { "resolution": "2K" }, "price": { "credits": 60, "priceYuan": 0.6 } },
          { "when": { "resolution": "4K" }, "price": { "credits": 80, "priceYuan": 0.8 } }
        ]
      }
    }'::jsonb
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'gemini-3.1-image-edit',
    'banana-3.1',
    '{
      "creditsPerCall": 30,
      "priceYuan": 0.3,
      "pricing": {
        "defaults": { "credits": 30, "priceYuan": 0.3 },
        "rules": [
          { "when": { "resolution": "0.5K" }, "price": { "credits": 30, "priceYuan": 0.3 } },
          { "when": { "resolution": "2K" }, "price": { "credits": 40, "priceYuan": 0.4 } },
          { "when": { "resolution": "4K" }, "price": { "credits": 50, "priceYuan": 0.5 } }
        ]
      }
    }'::jsonb,
    '{
      "specPricing": {
        "defaults": { "credits": 30 },
        "rules": [
          { "when": { "resolution": "0.5K" }, "price": { "credits": 30, "priceYuan": 0.3 } },
          { "when": { "resolution": "2K" }, "price": { "credits": 40, "priceYuan": 0.4 } },
          { "when": { "resolution": "4K" }, "price": { "credits": 50, "priceYuan": 0.5 } }
        ]
      }
    }'::jsonb
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'gemini-image-blend',
    'banana',
    '{
      "creditsPerCall": 40,
      "priceYuan": 0.4,
      "pricing": {
        "defaults": { "credits": 40, "priceYuan": 0.4 },
        "rules": [
          { "when": { "resolution": "2K" }, "price": { "credits": 60, "priceYuan": 0.6 } },
          { "when": { "resolution": "4K" }, "price": { "credits": 80, "priceYuan": 0.8 } }
        ]
      }
    }'::jsonb,
    '{
      "specPricing": {
        "defaults": { "credits": 40 },
        "rules": [
          { "when": { "resolution": "2K" }, "price": { "credits": 60, "priceYuan": 0.6 } },
          { "when": { "resolution": "4K" }, "price": { "credits": 80, "priceYuan": 0.8 } }
        ]
      }
    }'::jsonb
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'gemini-3.1-image-blend',
    'banana-3.1',
    '{
      "creditsPerCall": 30,
      "priceYuan": 0.3,
      "pricing": {
        "defaults": { "credits": 30, "priceYuan": 0.3 },
        "rules": [
          { "when": { "resolution": "0.5K" }, "price": { "credits": 30, "priceYuan": 0.3 } },
          { "when": { "resolution": "2K" }, "price": { "credits": 40, "priceYuan": 0.4 } },
          { "when": { "resolution": "4K" }, "price": { "credits": 50, "priceYuan": 0.5 } }
        ]
      }
    }'::jsonb,
    '{
      "specPricing": {
        "defaults": { "credits": 30 },
        "rules": [
          { "when": { "resolution": "0.5K" }, "price": { "credits": 30, "priceYuan": 0.3 } },
          { "when": { "resolution": "2K" }, "price": { "credits": 40, "priceYuan": 0.4 } },
          { "when": { "resolution": "4K" }, "price": { "credits": 50, "priceYuan": 0.5 } }
        ]
      }
    }'::jsonb
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'gemini-image-analyze',
    'gemini',
    '{
      "creditsPerCall": 40,
      "priceYuan": 0.4,
      "pricing": {
        "defaults": { "credits": 40, "priceYuan": 0.4 },
        "rules": [
          { "when": { "resolution": "2K" }, "price": { "credits": 60, "priceYuan": 0.6 } },
          { "when": { "resolution": "4K" }, "price": { "credits": 80, "priceYuan": 0.8 } }
        ]
      }
    }'::jsonb,
    '{
      "specPricing": {
        "defaults": { "credits": 40 },
        "rules": [
          { "when": { "resolution": "2K" }, "price": { "credits": 60, "priceYuan": 0.6 } },
          { "when": { "resolution": "4K" }, "price": { "credits": 80, "priceYuan": 0.8 } }
        ]
      }
    }'::jsonb
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'gemini-2.5-image-edit',
    'banana-2.5',
    '{
      "creditsPerCall": 20,
      "priceYuan": 0.2,
      "pricing": {
        "defaults": { "credits": 20, "priceYuan": 0.2 },
        "rules": []
      }
    }'::jsonb,
    '{
      "specPricing": {
        "defaults": { "credits": 20 },
        "rules": []
      }
    }'::jsonb
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'gemini-2.5-image-blend',
    'banana-2.5',
    '{
      "creditsPerCall": 20,
      "priceYuan": 0.2,
      "pricing": {
        "defaults": { "credits": 20, "priceYuan": 0.2 },
        "rules": []
      }
    }'::jsonb,
    '{
      "specPricing": {
        "defaults": { "credits": 20 },
        "rules": []
      }
    }'::jsonb
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'gemini-2.5-image-analyze',
    'banana-2.5',
    '{
      "creditsPerCall": 20,
      "priceYuan": 0.2,
      "pricing": {
        "defaults": { "credits": 20, "priceYuan": 0.2 }
      }
    }'::jsonb
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'seedream5',
    'seedream5',
    '{
      "creditsPerCall": 30,
      "priceYuan": 0.3,
      "pricing": {
        "defaults": { "credits": 30, "priceYuan": 0.3 }
      }
    }'::jsonb
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'midjourney',
    'midjourney',
    '{
      "creditsPerCall": 50,
      "priceYuan": 0.5,
      "pricing": {
        "defaults": { "credits": 50, "priceYuan": 0.5 }
      }
    }'::jsonb
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'wan-2.6',
    'dashscope',
    '{
      "creditsPerCall": 600,
      "priceYuan": 6,
      "pricing": {
        "defaults": { "credits": 600, "priceYuan": 6 }
      }
    }'::jsonb
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'wan-2.6-r2v',
    'dashscope',
    '{
      "creditsPerCall": 600,
      "priceYuan": 6,
      "pricing": {
        "defaults": { "credits": 600, "priceYuan": 6 }
      }
    }'::jsonb
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'wan-2.7',
    'dashscope',
    '{
      "creditsPerCall": 600,
      "priceYuan": 6,
      "pricing": {
        "defaults": { "credits": 600, "priceYuan": 6 }
      }
    }'::jsonb
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'sora-2',
    'sora2_api',
    '{
      "creditsPerCall": 750,
      "priceYuan": 7.5,
      "pricing": {
        "version": "v2",
        "dimensions": [
          {
            "key": "model",
            "label": "模型",
            "type": "enum",
            "required": true,
            "options": [
              { "value": "sora-2", "label": "Sora 2" },
              { "value": "sora-2-vip", "label": "Sora 2 VIP" },
              { "value": "sora-2-pro", "label": "Sora 2 Pro" }
            ]
          }
        ],
        "matchingRules": [
          {
            "ruleKey": "sora2_standard",
            "label": "Sora 2 标准版",
            "enabled": true,
            "priority": 100,
            "evaluatorKey": "sora2_standard_eval",
            "conditions": {
              "all": [
                { "field": "model", "op": "in", "value": ["sora-2", "sora-2-vip"] }
              ]
            }
          },
          {
            "ruleKey": "sora2_pro",
            "label": "Sora 2 Pro",
            "enabled": true,
            "priority": 100,
            "evaluatorKey": "sora2_pro_eval",
            "conditions": {
              "all": [
                { "field": "model", "op": "eq", "value": "sora-2-pro" }
              ]
            }
          }
        ],
        "evaluators": {
          "sora2_standard_eval": { "type": "fixed", "credits": 200, "priceYuan": 2 },
          "sora2_pro_eval": { "type": "fixed", "credits": 750, "priceYuan": 7.5 }
        },
        "displayConfig": {
          "specAxes": ["model"],
          "labels": {
            "model.sora-2": "Sora 2",
            "model.sora-2-vip": "Sora 2 VIP",
            "model.sora-2-pro": "Sora 2 Pro"
          },
          "defaultSelections": {
            "model": "sora-2-pro"
          }
        }
      }
    }'::jsonb
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'sora-2',
    'tencent_vod',
    '{
      "creditsPerCall": 750,
      "priceYuan": 7.5,
      "pricing": {
        "version": "v2",
        "dimensions": [
          {
            "key": "model",
            "label": "模型",
            "type": "enum",
            "required": true,
            "options": [
              { "value": "sora-2", "label": "Sora 2" },
              { "value": "sora-2-vip", "label": "Sora 2 VIP" },
              { "value": "sora-2-pro", "label": "Sora 2 Pro" }
            ]
          }
        ],
        "matchingRules": [
          {
            "ruleKey": "sora2_standard",
            "label": "Sora 2 标准版",
            "enabled": true,
            "priority": 100,
            "evaluatorKey": "sora2_standard_eval",
            "conditions": {
              "all": [
                { "field": "model", "op": "in", "value": ["sora-2", "sora-2-vip"] }
              ]
            }
          },
          {
            "ruleKey": "sora2_pro",
            "label": "Sora 2 Pro",
            "enabled": true,
            "priority": 100,
            "evaluatorKey": "sora2_pro_eval",
            "conditions": {
              "all": [
                { "field": "model", "op": "eq", "value": "sora-2-pro" }
              ]
            }
          }
        ],
        "evaluators": {
          "sora2_standard_eval": { "type": "fixed", "credits": 200, "priceYuan": 2 },
          "sora2_pro_eval": { "type": "fixed", "credits": 750, "priceYuan": 7.5 }
        },
        "displayConfig": {
          "specAxes": ["model"],
          "labels": {
            "model.sora-2": "Sora 2",
            "model.sora-2-vip": "Sora 2 VIP",
            "model.sora-2-pro": "Sora 2 Pro"
          },
          "defaultSelections": {
            "model": "sora-2-pro"
          }
        }
      }
    }'::jsonb
  );

  RETURN next_config;
END;
$fn$;

UPDATE "SystemSetting"
SET "value" = apply_missing_managed_model_pricing_defaults("value"::jsonb)::text
WHERE "key" = 'model_provider_mapping_v2';

DROP FUNCTION IF EXISTS apply_missing_managed_model_pricing_defaults(jsonb);
DROP FUNCTION IF EXISTS patch_managed_model_vendor(jsonb, text, text, jsonb, jsonb);

COMMIT;
