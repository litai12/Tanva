-- Seed happyhorse-1.0-r2v 模型到 SystemSetting.model_provider_mapping_v2，并回填 happyhorseR2V NodeConfig 的 managedRoutes 元数据。
--
-- 定价（按用户给的卖价）：
--   720P:  ¥1.2/秒（120 credits/秒）
--   1080P: ¥2.0/秒（200 credits/秒）
--   时长支持 3~15 秒整数。线性评估器：unitField = durationSec, unitPriceYuan × 时长。
--
-- 与 wan-2.6-r2v 同走 dashscope/legacy 链路；本 migration 只新增模型条目，不改其它任何模型。

BEGIN;

-- ─────────────────────────────────────────────
-- Step 1: 工具函数（与历史 migration 同名重建一次，兼容单独执行场景）
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION replace_managed_model(config jsonb, target_model jsonb)
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
  rebuilt AS (
    SELECT
      COALESCE(
        jsonb_agg(
          CASE
            WHEN model_item->>'modelKey' = target_model->>'modelKey' THEN target_model
            ELSE model_item
          END
        ),
        '[]'::jsonb
      ) AS models,
      COALESCE(bool_or(model_item->>'modelKey' = target_model->>'modelKey'), false) AS found
    FROM current_models, jsonb_array_elements(current_models.models) AS model_item
  )
  SELECT jsonb_set(
    (SELECT cfg FROM source),
    '{models}',
    CASE
      WHEN rebuilt.found THEN rebuilt.models
      ELSE rebuilt.models || jsonb_build_array(target_model)
    END,
    true
  )
  FROM rebuilt;
$fn$;

-- ─────────────────────────────────────────────
-- Step 2: 注入 happyhorse-1.0-r2v 模型条目
-- ─────────────────────────────────────────────

UPDATE "SystemSetting"
SET "value" = replace_managed_model(
  "value"::jsonb,
  $hh${
    "modelKey": "happyhorse-1.0-r2v",
    "modelName": "HappyHorse 1.0 R2V",
    "taskType": "video",
    "enabled": true,
    "defaultVendor": "dashscope",
    "vendors": [
      {
        "vendorKey": "dashscope",
        "platformKey": "dashscope",
        "label": "DashScope",
        "enabled": true,
        "route": "legacy",
        "provider": "dashscope",
        "modelName": "HappyHorse",
        "modelVersion": "1.0-r2v",
        "creditsPerCall": 600,
        "priceYuan": 6,
        "pricing": {
          "version": "v2",
          "defaults": { "credits": 600, "priceYuan": 6 },
          "dimensions": [
            {
              "key": "resolution",
              "label": "分辨率",
              "type": "enum",
              "required": true,
              "options": [
                { "value": "720P", "label": "720P" },
                { "value": "1080P", "label": "1080P" }
              ]
            },
            {
              "key": "durationSec",
              "label": "时长（秒）",
              "type": "number",
              "required": true,
              "description": "按秒线性计费（3~15 秒整数）"
            }
          ],
          "matchingRules": [
            {
              "ruleKey": "happyhorse_720p_linear",
              "label": "HappyHorse 720P 按秒计费",
              "enabled": true,
              "priority": 100,
              "evaluatorKey": "happyhorse_720p_linear_eval",
              "conditions": {
                "all": [
                  { "field": "resolution", "op": "eq", "value": "720P" }
                ],
                "any": []
              }
            },
            {
              "ruleKey": "happyhorse_1080p_linear",
              "label": "HappyHorse 1080P 按秒计费",
              "enabled": true,
              "priority": 110,
              "evaluatorKey": "happyhorse_1080p_linear_eval",
              "conditions": {
                "all": [
                  { "field": "resolution", "op": "eq", "value": "1080P" }
                ],
                "any": []
              }
            }
          ],
          "evaluators": {
            "happyhorse_720p_linear_eval":  { "type": "linear", "unitField": "durationSec", "unitPriceYuan": 1.2 },
            "happyhorse_1080p_linear_eval": { "type": "linear", "unitField": "durationSec", "unitPriceYuan": 2.0 }
          },
          "displayConfig": {
            "specAxes": ["resolution", "durationSec"],
            "labels": {
              "resolution.720P": "720P",
              "resolution.1080P": "1080P",
              "durationSec.5":  "5 秒",
              "durationSec.10": "10 秒",
              "durationSec.15": "15 秒"
            },
            "defaultSelections": {
              "resolution": "720P",
              "durationSec": 5
            },
            "presets": [
              { "resolution": "720P",  "durationSec": 3 },
              { "resolution": "720P",  "durationSec": 5 },
              { "resolution": "720P",  "durationSec": 10 },
              { "resolution": "720P",  "durationSec": 15 },
              { "resolution": "1080P", "durationSec": 3 },
              { "resolution": "1080P", "durationSec": 5 },
              { "resolution": "1080P", "durationSec": 10 },
              { "resolution": "1080P", "durationSec": 15 }
            ]
          }
        },
        "metadata": {
          "specPricing": {
            "defaults": { "credits": 600, "priceYuan": 6 },
            "rules": [
              { "when": { "resolution": "720P",  "durationSec": 5 },  "price": { "credits": 600,  "priceYuan": 6 } },
              { "when": { "resolution": "720P",  "durationSec": 10 }, "price": { "credits": 1200, "priceYuan": 12 } },
              { "when": { "resolution": "1080P", "durationSec": 5 },  "price": { "credits": 1000, "priceYuan": 10 } },
              { "when": { "resolution": "1080P", "durationSec": 10 }, "price": { "credits": 2000, "priceYuan": 20 } }
            ]
          }
        }
      }
    ],
    "metadata": {
      "vendorTaskKind": "dashscope_video_generation",
      "upstreamDomain": "dashscope.aliyuncs.com",
      "upstreamModelId": "happyhorse-1.0-r2v"
    }
  }$hh$::jsonb
)::text
WHERE "key" = 'model_provider_mapping_v2';

-- ─────────────────────────────────────────────
-- Step 3: 回填 happyhorseR2V NodeConfig 的 managedRoutes 元数据
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION build_node_managed_payload_hh(config jsonb, target_model_key text)
RETURNS jsonb
LANGUAGE sql
AS $fn$
  WITH model_item AS (
    SELECT elem AS model
    FROM jsonb_array_elements(COALESCE(config->'models', '[]'::jsonb)) elem
    WHERE elem->>'modelKey' = target_model_key
    LIMIT 1
  ),
  selected_vendor AS (
    SELECT vend AS vendor
    FROM model_item, jsonb_array_elements(COALESCE(model_item.model->'vendors', '[]'::jsonb)) vend
    WHERE vend->>'vendorKey' = COALESCE(NULLIF(model_item.model->>'defaultVendor', ''), vend->>'vendorKey')
    LIMIT 1
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM model_item) THEN
      jsonb_strip_nulls(
        jsonb_build_object(
          'managedModelKey', target_model_key,
          'managedRoutes', jsonb_build_object(
            'modelKey', (SELECT model->>'modelKey' FROM model_item),
            'defaultVendor', (SELECT model->>'defaultVendor' FROM model_item),
            'vendors', COALESCE((SELECT model->'vendors' FROM model_item), '[]'::jsonb)
          ),
          'defaultDataPatch', jsonb_strip_nulls(
            jsonb_build_object(
              'managedModelKey', target_model_key,
              'vendorKey', (SELECT vendor->>'vendorKey' FROM selected_vendor),
              'platformKey', COALESCE(
                NULLIF((SELECT vendor->>'platformKey' FROM selected_vendor), ''),
                (SELECT vendor->>'vendorKey' FROM selected_vendor)
              ),
              'creditsPerCall', (
                SELECT CASE
                  WHEN jsonb_typeof(vendor->'creditsPerCall') = 'number' THEN vendor->'creditsPerCall'
                  ELSE NULL
                END
                FROM selected_vendor
              )
            )
          )
        )
      )
    ELSE NULL
  END;
$fn$;

WITH setting AS (
  SELECT "value"::jsonb AS cfg
  FROM "SystemSetting"
  WHERE "key" = 'model_provider_mapping_v2'
)
UPDATE "NodeConfig" AS n
SET "metadata" = jsonb_set(
  COALESCE(n."metadata"::jsonb, '{}'::jsonb) ||
    jsonb_build_object(
      'managedModelKey', payload->'managedModelKey',
      'managedRoutes', payload->'managedRoutes'
    ),
  '{defaultData}',
  COALESCE(n."metadata"::jsonb->'defaultData', '{}'::jsonb) ||
    COALESCE(payload->'defaultDataPatch', '{}'::jsonb),
  true
)
FROM setting,
LATERAL build_node_managed_payload_hh(setting.cfg, 'happyhorse-1.0-r2v') AS payload
WHERE n."nodeKey" = 'happyhorseR2V'
  AND payload IS NOT NULL;

-- ─────────────────────────────────────────────
-- Step 4: 清理工具函数
-- ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS build_node_managed_payload_hh(jsonb, text);
DROP FUNCTION IF EXISTS replace_managed_model(jsonb, jsonb);

COMMIT;
