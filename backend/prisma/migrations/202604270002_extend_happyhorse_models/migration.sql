-- 在 SystemSetting.model_provider_mapping_v2 中追加 happyhorse 家族另外 3 个模型条目：
--   - happyhorse-1.0-t2v          文生视频
--   - happyhorse-1.0-i2v          首帧生视频（仅支持 1 张 first_frame 图）
--   - happyhorse-1.0-video-edit   视频改写（视频 + 参考图）
--
-- 全部沿用与 happyhorse-1.0-r2v 同样的按秒×分辨率定价（720P ¥1.2/s、1080P ¥2.0/s），
-- 即 unitField=durationSec 的线性评估器。

BEGIN;

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

-- 共享定价 jsonb（4 个模型共用同一份评估器配置）
CREATE OR REPLACE FUNCTION build_happyhorse_pricing()
RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT $hh${
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
          "all": [{ "field": "resolution", "op": "eq", "value": "720P" }],
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
          "all": [{ "field": "resolution", "op": "eq", "value": "1080P" }],
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
        "resolution.1080P": "1080P"
      },
      "defaultSelections": { "resolution": "720P", "durationSec": 5 }
    }
  }$hh$::jsonb;
$fn$;

CREATE OR REPLACE FUNCTION build_happyhorse_model_entry(
  model_key text,
  model_name text,
  model_version text
)
RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT jsonb_build_object(
    'modelKey', model_key,
    'modelName', model_name,
    'taskType', 'video',
    'enabled', true,
    'defaultVendor', 'dashscope',
    'vendors', jsonb_build_array(
      jsonb_build_object(
        'vendorKey', 'dashscope',
        'platformKey', 'dashscope',
        'label', 'DashScope',
        'enabled', true,
        'route', 'legacy',
        'provider', 'dashscope',
        'modelName', 'HappyHorse',
        'modelVersion', model_version,
        'creditsPerCall', 600,
        'priceYuan', 6,
        'pricing', build_happyhorse_pricing(),
        'metadata', jsonb_build_object(
          'specPricing',
          jsonb_build_object(
            'defaults', jsonb_build_object('credits', 600, 'priceYuan', 6),
            'rules', jsonb_build_array(
              jsonb_build_object('when', jsonb_build_object('resolution', '720P',  'durationSec', 5),  'price', jsonb_build_object('credits', 600,  'priceYuan', 6)),
              jsonb_build_object('when', jsonb_build_object('resolution', '720P',  'durationSec', 10), 'price', jsonb_build_object('credits', 1200, 'priceYuan', 12)),
              jsonb_build_object('when', jsonb_build_object('resolution', '1080P', 'durationSec', 5),  'price', jsonb_build_object('credits', 1000, 'priceYuan', 10)),
              jsonb_build_object('when', jsonb_build_object('resolution', '1080P', 'durationSec', 10), 'price', jsonb_build_object('credits', 2000, 'priceYuan', 20))
            )
          )
        )
      )
    ),
    'metadata', jsonb_build_object(
      'vendorTaskKind', 'dashscope_video_generation',
      'upstreamDomain', 'dashscope.aliyuncs.com',
      'upstreamModelId', model_key
    )
  );
$fn$;

UPDATE "SystemSetting"
SET "value" = replace_managed_model(
  replace_managed_model(
    replace_managed_model(
      "value"::jsonb,
      build_happyhorse_model_entry('happyhorse-1.0-t2v', 'HappyHorse 1.0 T2V', '1.0-t2v')
    ),
    build_happyhorse_model_entry('happyhorse-1.0-i2v', 'HappyHorse 1.0 I2V', '1.0-i2v')
  ),
  build_happyhorse_model_entry('happyhorse-1.0-video-edit', 'HappyHorse 1.0 Video Edit', '1.0-video-edit')
)::text
WHERE "key" = 'model_provider_mapping_v2';

DROP FUNCTION IF EXISTS build_happyhorse_model_entry(text, text, text);
DROP FUNCTION IF EXISTS build_happyhorse_pricing();
DROP FUNCTION IF EXISTS replace_managed_model(jsonb, jsonb);

COMMIT;
