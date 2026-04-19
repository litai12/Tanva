-- 补充 kling-3.0 tencent_vod 动态定价
-- 官方价格：无声 720P/1080P/2K/4K = 0.6/0.8/1.0/1.2 元/秒
--           有声（无音色）         = 0.9/1.2/1.5/2.0 元/秒

BEGIN;

CREATE OR REPLACE FUNCTION replace_managed_vendor_pricing_k30(
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
    SELECT COALESCE(cfg->'models', '[]'::jsonb) AS models FROM source
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
SET "value" = replace_managed_vendor_pricing_k30(
  "value"::jsonb,
  'kling-3.0',
  'tencent_vod',
  $pricing${
    "version": "v2",
    "dimensions": [
      {
        "key": "hasAudio",
        "label": "声音",
        "type": "boolean",
        "required": true,
        "options": [{"value": false, "label": "无声"}, {"value": true, "label": "有声"}]
      },
      {
        "key": "resolution",
        "label": "分辨率",
        "type": "enum",
        "required": true,
        "options": [
          {"value": "720P",  "label": "720P"},
          {"value": "1080P", "label": "1080P"},
          {"value": "2K",    "label": "2K"},
          {"value": "4K",    "label": "4K"}
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
      {"ruleKey":"kling30_tencent_silent_720p",  "label":"Kling 3.0 无声 720P",  "enabled":true,"priority":100,"evaluatorKey":"kling30_tencent_silent_720p_eval",  "conditions":{"all":[{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"720P"}]}},
      {"ruleKey":"kling30_tencent_silent_1080p", "label":"Kling 3.0 无声 1080P", "enabled":true,"priority":100,"evaluatorKey":"kling30_tencent_silent_1080p_eval", "conditions":{"all":[{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"1080P"}]}},
      {"ruleKey":"kling30_tencent_silent_2k",    "label":"Kling 3.0 无声 2K",    "enabled":true,"priority":100,"evaluatorKey":"kling30_tencent_silent_2k_eval",    "conditions":{"all":[{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"2K"}]}},
      {"ruleKey":"kling30_tencent_silent_4k",    "label":"Kling 3.0 无声 4K",    "enabled":true,"priority":100,"evaluatorKey":"kling30_tencent_silent_4k_eval",    "conditions":{"all":[{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"4K"}]}},
      {"ruleKey":"kling30_tencent_audio_720p",   "label":"Kling 3.0 有声 720P",  "enabled":true,"priority":90, "evaluatorKey":"kling30_tencent_audio_720p_eval",   "conditions":{"all":[{"field":"hasAudio","op":"eq","value":true}, {"field":"resolution","op":"eq","value":"720P"}]}},
      {"ruleKey":"kling30_tencent_audio_1080p",  "label":"Kling 3.0 有声 1080P", "enabled":true,"priority":90, "evaluatorKey":"kling30_tencent_audio_1080p_eval",  "conditions":{"all":[{"field":"hasAudio","op":"eq","value":true}, {"field":"resolution","op":"eq","value":"1080P"}]}},
      {"ruleKey":"kling30_tencent_audio_2k",     "label":"Kling 3.0 有声 2K",    "enabled":true,"priority":90, "evaluatorKey":"kling30_tencent_audio_2k_eval",     "conditions":{"all":[{"field":"hasAudio","op":"eq","value":true}, {"field":"resolution","op":"eq","value":"2K"}]}},
      {"ruleKey":"kling30_tencent_audio_4k",     "label":"Kling 3.0 有声 4K",    "enabled":true,"priority":90, "evaluatorKey":"kling30_tencent_audio_4k_eval",     "conditions":{"all":[{"field":"hasAudio","op":"eq","value":true}, {"field":"resolution","op":"eq","value":"4K"}]}}
    ],
    "evaluators": {
      "kling30_tencent_silent_720p_eval":  {"type":"linear","unitField":"duration","unitPriceYuan":0.6},
      "kling30_tencent_silent_1080p_eval": {"type":"linear","unitField":"duration","unitPriceYuan":0.8},
      "kling30_tencent_silent_2k_eval":    {"type":"linear","unitField":"duration","unitPriceYuan":1.0},
      "kling30_tencent_silent_4k_eval":    {"type":"linear","unitField":"duration","unitPriceYuan":1.2},
      "kling30_tencent_audio_720p_eval":   {"type":"linear","unitField":"duration","unitPriceYuan":0.9},
      "kling30_tencent_audio_1080p_eval":  {"type":"linear","unitField":"duration","unitPriceYuan":1.2},
      "kling30_tencent_audio_2k_eval":     {"type":"linear","unitField":"duration","unitPriceYuan":1.5},
      "kling30_tencent_audio_4k_eval":     {"type":"linear","unitField":"duration","unitPriceYuan":2.0}
    },
    "displayConfig": {
      "specAxes": ["hasAudio", "resolution", "duration"],
      "labels": {
        "hasAudio.false": "无声", "hasAudio.true": "有声",
        "resolution.720P": "720P", "resolution.1080P": "1080P", "resolution.2K": "2K", "resolution.4K": "4K"
      },
      "defaultSelections": {"hasAudio": false, "resolution": "1080P", "duration": 5},
      "presets": [
        {"hasAudio": false, "resolution": "720P",  "duration": 5},
        {"hasAudio": false, "resolution": "1080P", "duration": 5},
        {"hasAudio": true,  "resolution": "720P",  "duration": 5},
        {"hasAudio": true,  "resolution": "1080P", "duration": 5}
      ]
    }
  }$pricing$::jsonb
)::text
WHERE "key" = 'model_provider_mapping_v2';

DROP FUNCTION IF EXISTS replace_managed_vendor_pricing_k30(jsonb, text, text, jsonb);

COMMIT;
