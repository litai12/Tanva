BEGIN;

-- Canvas VOD models are sold in the normal time band only. Also align Kling
-- 3.0 native 4K and Vidu Q3/Q3-Pro with Tencent VOD's current list prices.
CREATE OR REPLACE FUNCTION patch_canvas_vod_normal_pricing(config jsonb)
RETURNS jsonb
LANGUAGE sql
AS $fn$
  WITH source AS (
    SELECT COALESCE(config, '{}'::jsonb) AS cfg
  ),
  rebuilt_models AS (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN model_item->>'modelKey' IN ('kling-3.0', 'vidu-q3') THEN
            jsonb_set(
              model_item,
              '{vendors}',
              (
                SELECT COALESCE(
                  jsonb_agg(
                    CASE
                      WHEN vendor_item->>'vendorKey' = 'tencent_vod'
                           AND model_item->>'modelKey' = 'kling-3.0' THEN
                        jsonb_set(
                          jsonb_set(
                            vendor_item,
                            '{pricing,evaluators,kling30_tencent_silent_4k_eval,unitPriceYuan}',
                            '3'::jsonb,
                            false
                          ),
                          '{pricing,evaluators,kling30_tencent_audio_4k_eval,unitPriceYuan}',
                          '3'::jsonb,
                          false
                        )
                      WHEN vendor_item->>'vendorKey' = 'tencent_vod'
                           AND model_item->>'modelKey' = 'vidu-q3' THEN
                        jsonb_set(
                          vendor_item,
                          '{pricing}',
                          $pricing$
                          {
                            "version":"v2",
                            "dimensions":[
                              {"key":"viduModelVariant","label":"Vidu 型号","type":"enum","required":true,"options":[{"value":"q3","label":"Q3 参考生"},{"value":"q3-pro","label":"Q3 Pro"},{"value":"q3-mix","label":"Q3 Mix"}]},
                              {"key":"resolution","label":"分辨率","type":"enum","required":true,"options":[{"value":"480P","label":"480P / 540P"},{"value":"540P","label":"480P / 540P"},{"value":"720P","label":"720P"},{"value":"1080P","label":"1080P"},{"value":"2K","label":"2K"},{"value":"4K","label":"4K"}]},
                              {"key":"duration","label":"时长（秒）","type":"number","required":true}
                            ],
                            "matchingRules":[
                              {"ruleKey":"vidu_q3_ref_540","label":"Q3 参考生 540P","enabled":true,"priority":110,"evaluatorKey":"vidu_q3_ref_540_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3"},{"field":"resolution","op":"in","value":["480P","540P"]}]}},
                              {"ruleKey":"vidu_q3_ref_720","label":"Q3 参考生 720P","enabled":true,"priority":110,"evaluatorKey":"vidu_q3_ref_720_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3"},{"field":"resolution","op":"eq","value":"720P"}]}},
                              {"ruleKey":"vidu_q3_ref_1080","label":"Q3 参考生 1080P","enabled":true,"priority":110,"evaluatorKey":"vidu_q3_ref_1080_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3"},{"field":"resolution","op":"eq","value":"1080P"}]}},
                              {"ruleKey":"vidu_q3_ref_2k","label":"Q3 参考生 2K","enabled":true,"priority":110,"evaluatorKey":"vidu_q3_ref_2k_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3"},{"field":"resolution","op":"eq","value":"2K"}]}},
                              {"ruleKey":"vidu_q3_ref_4k","label":"Q3 参考生 4K","enabled":true,"priority":110,"evaluatorKey":"vidu_q3_ref_4k_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3"},{"field":"resolution","op":"eq","value":"4K"}]}},
                              {"ruleKey":"vidu_q3_pro_540","label":"Q3 Pro 540P","enabled":true,"priority":100,"evaluatorKey":"vidu_q3_pro_540_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-pro"},{"field":"resolution","op":"in","value":["480P","540P"]}]}},
                              {"ruleKey":"vidu_q3_pro_720","label":"Q3 Pro 720P","enabled":true,"priority":100,"evaluatorKey":"vidu_q3_pro_720_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-pro"},{"field":"resolution","op":"eq","value":"720P"}]}},
                              {"ruleKey":"vidu_q3_pro_1080","label":"Q3 Pro 1080P","enabled":true,"priority":100,"evaluatorKey":"vidu_q3_pro_1080_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-pro"},{"field":"resolution","op":"eq","value":"1080P"}]}},
                              {"ruleKey":"vidu_q3_pro_2k","label":"Q3 Pro 2K","enabled":true,"priority":100,"evaluatorKey":"vidu_q3_pro_2k_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-pro"},{"field":"resolution","op":"eq","value":"2K"}]}},
                              {"ruleKey":"vidu_q3_pro_4k","label":"Q3 Pro 4K","enabled":true,"priority":100,"evaluatorKey":"vidu_q3_pro_4k_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-pro"},{"field":"resolution","op":"eq","value":"4K"}]}},
                              {"ruleKey":"vidu_q3_mix_720","label":"Q3 Mix 720P","enabled":true,"priority":80,"evaluatorKey":"vidu_q3_mix_720_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-mix"},{"field":"resolution","op":"eq","value":"720P"}]}},
                              {"ruleKey":"vidu_q3_mix_1080","label":"Q3 Mix 1080P","enabled":true,"priority":80,"evaluatorKey":"vidu_q3_mix_1080_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-mix"},{"field":"resolution","op":"eq","value":"1080P"}]}}
                            ],
                            "evaluators":{
                              "vidu_q3_ref_540_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.313},
                              "vidu_q3_ref_720_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.625},
                              "vidu_q3_ref_1080_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.782},
                              "vidu_q3_ref_2k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.939},
                              "vidu_q3_ref_4k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.127},
                              "vidu_q3_pro_540_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.313},
                              "vidu_q3_pro_720_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.782},
                              "vidu_q3_pro_1080_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.938},
                              "vidu_q3_pro_2k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.126},
                              "vidu_q3_pro_4k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.351},
                              "vidu_q3_mix_720_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.782},
                              "vidu_q3_mix_1080_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.938}
                            },
                            "displayConfig":{
                              "specAxes":["viduModelVariant","resolution","duration"],
                              "labels":{"viduModelVariant.q3":"Q3 参考生","viduModelVariant.q3-pro":"Q3 Pro","viduModelVariant.q3-mix":"Q3 Mix","resolution.480P":"480P / 540P","resolution.540P":"480P / 540P","resolution.720P":"720P","resolution.1080P":"1080P","resolution.2K":"2K","resolution.4K":"4K"},
                              "defaultSelections":{"viduModelVariant":"q3-pro","resolution":"720P","duration":5},
                              "presets":[
                                {"viduModelVariant":"q3-pro","resolution":"720P","duration":5},
                                {"viduModelVariant":"q3","resolution":"720P","duration":5},
                                {"viduModelVariant":"q3-mix","resolution":"1080P","duration":5}
                              ]
                            }
                          }
                          $pricing$::jsonb,
                          true
                        )
                      ELSE vendor_item
                    END
                    ORDER BY vendor_item->>'vendorKey'
                  ),
                  '[]'::jsonb
                )
                FROM jsonb_array_elements(COALESCE(model_item->'vendors', '[]'::jsonb)) vendor_item
              ),
              true
            )
          ELSE model_item
        END
        ORDER BY model_item->>'modelKey'
      ),
      '[]'::jsonb
    ) AS models
    FROM source, jsonb_array_elements(COALESCE(source.cfg->'models', '[]'::jsonb)) model_item
  )
  SELECT jsonb_set(source.cfg, '{models}', rebuilt_models.models, true)
  FROM source, rebuilt_models;
$fn$;

UPDATE "SystemSetting"
SET "value" = patch_canvas_vod_normal_pricing("value"::jsonb)::text,
    "updatedAt" = NOW()
WHERE "key" = 'model_provider_mapping_v2';

-- Refresh the public node copies from the managed-model registry.
WITH setting AS (
  SELECT "value"::jsonb AS cfg
  FROM "SystemSetting"
  WHERE "key" = 'model_provider_mapping_v2'
), node_model AS (
  SELECT node_key, model
  FROM setting,
       LATERAL jsonb_array_elements(COALESCE(setting.cfg->'models', '[]'::jsonb)) model,
       LATERAL (VALUES
         ('kling26Video', 'kling-2.6'),
         ('kling30Video', 'kling-3.0'),
         ('klingO1Video', 'kling-o3'),
         ('viduVideo', 'vidu-q2'),
         ('viduQ3', 'vidu-q3'),
         ('hailuoVideo', 'hailuo-h3')
       ) AS mapping(node_key, model_key)
  WHERE model->>'modelKey' = mapping.model_key
), vendor_item AS (
  SELECT node_model.node_key, node_model.model, vendor
  FROM node_model,
       LATERAL jsonb_array_elements(COALESCE(node_model.model->'vendors', '[]'::jsonb)) vendor
  WHERE vendor->>'vendorKey' = 'tencent_vod'
)
UPDATE "NodeConfig" AS node
SET "metadata" = jsonb_set(
      jsonb_set(
        COALESCE(node."metadata"::jsonb, '{}'::jsonb),
        '{managedRoutes}',
        jsonb_build_object(
          'modelKey', vendor_item.model->>'modelKey',
          'defaultVendor', 'tencent_vod',
          'vendors', jsonb_build_array(vendor_item.vendor)
        ),
        true
      ),
      '{defaultData}',
      (COALESCE(node."metadata"::jsonb->'defaultData', '{}'::jsonb) - 'offPeak')
        || jsonb_build_object(
          'vendorKey', 'tencent_vod',
          'platformKey', 'tencent_vod',
          'channelTier', 'vip',
          'managedModelKey', vendor_item.model->>'modelKey',
          'pricing', vendor_item.vendor->'pricing'
        ),
      true
    ),
    "updatedAt" = NOW()
FROM vendor_item
WHERE node."nodeKey" = vendor_item.node_key;

-- Hailuo H3 pricing remains owned by new-api's dynamic catalog, so it may not
-- have a vendor record in model_provider_mapping_v2. Its canvas route is still
-- the same Tencent VOD type-67 channel and must be exposed as VOD-only.
UPDATE "NodeConfig" AS node
SET "metadata" = jsonb_set(
      jsonb_set(
        COALESCE(node."metadata"::jsonb, '{}'::jsonb),
        '{managedRoutes}',
        jsonb_build_object(
          'modelKey', 'hailuo-h3',
          'defaultVendor', 'tencent_vod',
          'vendors', jsonb_build_array(
            jsonb_build_object(
              'vendorKey', 'tencent_vod',
              'platformKey', 'tencent_vod',
              'provider', 'hailuo',
              'route', 'new_api',
              'modelName', 'Hailuo',
              'modelVersion', 'H3'
            )
          )
        ),
        true
      ),
      '{defaultData}',
      (COALESCE(node."metadata"::jsonb->'defaultData', '{}'::jsonb) - 'offPeak')
        || jsonb_build_object(
          'vendorKey', 'tencent_vod',
          'platformKey', 'tencent_vod',
          'channelTier', 'vip',
          'channelSelectionExplicit', true,
          'managedModelKey', 'hailuo-h3',
          'generateAudio', true
        ),
      true
    ),
    "updatedAt" = NOW()
WHERE node."nodeKey" = 'hailuoVideo';

DROP FUNCTION IF EXISTS patch_canvas_vod_normal_pricing(jsonb);

COMMIT;
