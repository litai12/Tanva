BEGIN;

CREATE OR REPLACE FUNCTION replace_managed_vendor_pricing(
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

CREATE OR REPLACE FUNCTION build_node_managed_payload(config jsonb, target_model_key text)
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

UPDATE "SystemSetting"
SET "value" = replace_managed_vendor_pricing(
  "value"::jsonb,
  'seedance-1.5',
  'seedance_api',
  $${
            "version":"v2",
            "dimensions":[
              {"key":"hasAudio","label":"声音","type":"boolean","required":true,"options":[{"value":false,"label":"无声"},{"value":true,"label":"有声"}]},
              {"key":"resolution","label":"分辨率","type":"enum","required":true,"options":[{"value":"480P","label":"480P"},{"value":"720P","label":"720P"},{"value":"1080P","label":"1080P"},{"value":"2K","label":"2K"},{"value":"4K","label":"4K"}]},
              {"key":"duration","label":"时长（秒）","type":"number","required":true}
            ],
            "matchingRules":[
              {"ruleKey":"seedance15_silent_480p","label":"Seedance 1.5 无声 480P","enabled":true,"priority":100,"evaluatorKey":"seedance15_silent_480p_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"480P"}]}},
              {"ruleKey":"seedance15_silent_720p","label":"Seedance 1.5 无声 720P","enabled":true,"priority":100,"evaluatorKey":"seedance15_silent_720p_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"720P"}]}},
              {"ruleKey":"seedance15_silent_1080p","label":"Seedance 1.5 无声 1080P","enabled":true,"priority":100,"evaluatorKey":"seedance15_silent_1080p_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"1080P"}]}},
              {"ruleKey":"seedance15_silent_2k","label":"Seedance 1.5 无声 2K","enabled":true,"priority":100,"evaluatorKey":"seedance15_silent_2k_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"2K"}]}},
              {"ruleKey":"seedance15_silent_4k","label":"Seedance 1.5 无声 4K","enabled":true,"priority":100,"evaluatorKey":"seedance15_silent_4k_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"4K"}]}},
              {"ruleKey":"seedance15_audio_480p","label":"Seedance 1.5 有声 480P","enabled":true,"priority":90,"evaluatorKey":"seedance15_audio_480p_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"480P"}]}},
              {"ruleKey":"seedance15_audio_720p","label":"Seedance 1.5 有声 720P","enabled":true,"priority":90,"evaluatorKey":"seedance15_audio_720p_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"720P"}]}},
              {"ruleKey":"seedance15_audio_1080p","label":"Seedance 1.5 有声 1080P","enabled":true,"priority":90,"evaluatorKey":"seedance15_audio_1080p_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"1080P"}]}},
              {"ruleKey":"seedance15_audio_2k","label":"Seedance 1.5 有声 2K","enabled":true,"priority":90,"evaluatorKey":"seedance15_audio_2k_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"2K"}]}},
              {"ruleKey":"seedance15_audio_4k","label":"Seedance 1.5 有声 4K","enabled":true,"priority":90,"evaluatorKey":"seedance15_audio_4k_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"4K"}]}}
            ],
            "evaluators":{
              "seedance15_silent_480p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.08},
              "seedance15_silent_720p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.172},
              "seedance15_silent_1080p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.388},
              "seedance15_silent_2k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.691},
              "seedance15_silent_4k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.552},
              "seedance15_audio_480p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.16},
              "seedance15_audio_720p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.346},
              "seedance15_audio_1080p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.778},
              "seedance15_audio_2k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.382},
              "seedance15_audio_4k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":3.11}
            },
            "displayConfig":{
              "specAxes":["hasAudio","resolution","duration"],
              "labels":{"hasAudio.false":"无声","hasAudio.true":"有声","resolution.480P":"480P","resolution.720P":"720P","resolution.1080P":"1080P","resolution.2K":"2K","resolution.4K":"4K"},
              "defaultSelections":{"hasAudio":false,"resolution":"720P","duration":5},
              "presets":[
                {"hasAudio":false,"resolution":"720P","duration":5},
                {"hasAudio":true,"resolution":"720P","duration":5},
                {"hasAudio":false,"resolution":"1080P","duration":5},
                {"hasAudio":true,"resolution":"1080P","duration":5}
              ]
            }
  }$$::jsonb
)::text
WHERE "key" = 'model_provider_mapping_v2';

UPDATE "SystemSetting"
SET "value" = replace_managed_vendor_pricing(
  "value"::jsonb,
  'seedance-1.5',
  'tencent_vod',
  $${
          "version":"v2",
          "dimensions":[
            {"key":"hasAudio","label":"声音","type":"boolean","required":true,"options":[{"value":false,"label":"无声"},{"value":true,"label":"有声"}]},
            {"key":"resolution","label":"分辨率","type":"enum","required":true,"options":[{"value":"480P","label":"480P"},{"value":"720P","label":"720P"},{"value":"1080P","label":"1080P"},{"value":"2K","label":"2K"},{"value":"4K","label":"4K"}]},
            {"key":"duration","label":"时长（秒）","type":"number","required":true}
          ],
          "matchingRules":[
            {"ruleKey":"seedance15_tencent_silent_480p","label":"Seedance 1.5 无声 480P","enabled":true,"priority":100,"evaluatorKey":"seedance15_tencent_silent_480p_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"480P"}]}},
            {"ruleKey":"seedance15_tencent_silent_720p","label":"Seedance 1.5 无声 720P","enabled":true,"priority":100,"evaluatorKey":"seedance15_tencent_silent_720p_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"720P"}]}},
            {"ruleKey":"seedance15_tencent_silent_1080p","label":"Seedance 1.5 无声 1080P","enabled":true,"priority":100,"evaluatorKey":"seedance15_tencent_silent_1080p_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"1080P"}]}},
            {"ruleKey":"seedance15_tencent_silent_2k","label":"Seedance 1.5 无声 2K","enabled":true,"priority":100,"evaluatorKey":"seedance15_tencent_silent_2k_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"2K"}]}},
            {"ruleKey":"seedance15_tencent_silent_4k","label":"Seedance 1.5 无声 4K","enabled":true,"priority":100,"evaluatorKey":"seedance15_tencent_silent_4k_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"4K"}]}},
            {"ruleKey":"seedance15_tencent_audio_480p","label":"Seedance 1.5 有声 480P","enabled":true,"priority":90,"evaluatorKey":"seedance15_tencent_audio_480p_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"480P"}]}},
            {"ruleKey":"seedance15_tencent_audio_720p","label":"Seedance 1.5 有声 720P","enabled":true,"priority":90,"evaluatorKey":"seedance15_tencent_audio_720p_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"720P"}]}},
            {"ruleKey":"seedance15_tencent_audio_1080p","label":"Seedance 1.5 有声 1080P","enabled":true,"priority":90,"evaluatorKey":"seedance15_tencent_audio_1080p_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"1080P"}]}},
            {"ruleKey":"seedance15_tencent_audio_2k","label":"Seedance 1.5 有声 2K","enabled":true,"priority":90,"evaluatorKey":"seedance15_tencent_audio_2k_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"2K"}]}},
            {"ruleKey":"seedance15_tencent_audio_4k","label":"Seedance 1.5 有声 4K","enabled":true,"priority":90,"evaluatorKey":"seedance15_tencent_audio_4k_eval","conditions":{"all":[{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"4K"}]}}
          ],
          "evaluators":{
            "seedance15_tencent_silent_480p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.08},
            "seedance15_tencent_silent_720p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.172},
            "seedance15_tencent_silent_1080p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.388},
            "seedance15_tencent_silent_2k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.691},
            "seedance15_tencent_silent_4k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.552},
            "seedance15_tencent_audio_480p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.16},
            "seedance15_tencent_audio_720p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.346},
            "seedance15_tencent_audio_1080p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.778},
            "seedance15_tencent_audio_2k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.382},
            "seedance15_tencent_audio_4k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":3.11}
          },
          "displayConfig":{
            "specAxes":["hasAudio","resolution","duration"],
            "labels":{"hasAudio.false":"无声","hasAudio.true":"有声","resolution.480P":"480P","resolution.720P":"720P","resolution.1080P":"1080P","resolution.2K":"2K","resolution.4K":"4K"},
            "defaultSelections":{"hasAudio":false,"resolution":"720P","duration":5},
            "presets":[
              {"hasAudio":false,"resolution":"720P","duration":5},
              {"hasAudio":true,"resolution":"720P","duration":5},
              {"hasAudio":false,"resolution":"1080P","duration":5},
              {"hasAudio":true,"resolution":"1080P","duration":5}
            ]
          }
  }$$::jsonb
)::text
WHERE "key" = 'model_provider_mapping_v2';

UPDATE "SystemSetting"
SET "value" = replace_managed_vendor_pricing(
  "value"::jsonb,
  'seedance-2.0',
  'seedance_api',
  $${
        "version":"v2",
        "dimensions":[
          {"key":"seedanceModel","label":"Seedance 型号","type":"enum","required":true,"options":[{"value":"seedance-2.0","label":"Seedance 2.0"},{"value":"seedance-2.0-fast","label":"Seedance 2.0 Fast"}]},
          {"key":"inputType","label":"输入类型","type":"enum","required":true,"options":[{"value":"text","label":"文生视频"},{"value":"image","label":"图生视频"},{"value":"image_audio","label":"图片+音频"}]},
          {"key":"resolution","label":"分辨率","type":"enum","required":true,"options":[{"value":"480P","label":"480P"},{"value":"720P","label":"720P"}]},
          {"key":"duration","label":"时长（秒）","type":"number","required":true}
        ],
        "matchingRules":[
          {"ruleKey":"seedance20_fast_480p","label":"Seedance 2.0 Fast 480P","enabled":true,"priority":120,"evaluatorKey":"seedance20_fast_480p_eval","conditions":{"all":[{"field":"seedanceModel","op":"eq","value":"seedance-2.0-fast"},{"field":"inputType","op":"in","value":["text","image","image_audio"]},{"field":"resolution","op":"eq","value":"480P"}]}},
          {"ruleKey":"seedance20_fast_720p","label":"Seedance 2.0 Fast 720P","enabled":true,"priority":120,"evaluatorKey":"seedance20_fast_720p_eval","conditions":{"all":[{"field":"seedanceModel","op":"eq","value":"seedance-2.0-fast"},{"field":"inputType","op":"in","value":["text","image","image_audio"]},{"field":"resolution","op":"eq","value":"720P"}]}},
          {"ruleKey":"seedance20_480p","label":"Seedance 2.0 480P","enabled":true,"priority":110,"evaluatorKey":"seedance20_480p_eval","conditions":{"all":[{"field":"seedanceModel","op":"eq","value":"seedance-2.0"},{"field":"inputType","op":"in","value":["text","image","image_audio"]},{"field":"resolution","op":"eq","value":"480P"}]}},
          {"ruleKey":"seedance20_720p","label":"Seedance 2.0 720P","enabled":true,"priority":110,"evaluatorKey":"seedance20_720p_eval","conditions":{"all":[{"field":"seedanceModel","op":"eq","value":"seedance-2.0"},{"field":"inputType","op":"in","value":["text","image","image_audio"]},{"field":"resolution","op":"eq","value":"720P"}]}}
        ],
        "evaluators":{
          "seedance20_fast_480p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.372},
          "seedance20_fast_720p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.8},
          "seedance20_480p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.462},
          "seedance20_720p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.994}
        },
        "displayConfig":{
          "specAxes":["seedanceModel","inputType","resolution","duration"],
          "labels":{"seedanceModel.seedance-2.0":"Seedance 2.0","seedanceModel.seedance-2.0-fast":"Seedance 2.0 Fast","inputType.text":"文生视频","inputType.image":"图生视频","inputType.image_audio":"图片+音频","resolution.480P":"480P","resolution.720P":"720P"},
          "defaultSelections":{"seedanceModel":"seedance-2.0","inputType":"text","resolution":"720P","duration":5},
          "presets":[
            {"seedanceModel":"seedance-2.0","inputType":"text","resolution":"720P","duration":5},
            {"seedanceModel":"seedance-2.0","inputType":"image","resolution":"720P","duration":5},
            {"seedanceModel":"seedance-2.0-fast","inputType":"text","resolution":"480P","duration":5},
            {"seedanceModel":"seedance-2.0-fast","inputType":"image_audio","resolution":"720P","duration":5}
          ]
        }
  }$$::jsonb
)::text
WHERE "key" = 'model_provider_mapping_v2';

UPDATE "SystemSetting"
SET "value" = replace_managed_vendor_pricing(
  "value"::jsonb,
  'vidu-q2',
  'tencent_vod',
  $${
      "version":"v2",
      "dimensions":[
        {"key":"viduModel","label":"Vidu 型号","type":"enum","required":true,"options":[{"value":"q2","label":"Q2"},{"value":"q2-pro","label":"Q2 Pro"}]},
        {"key":"inputType","label":"输入类型","type":"enum","required":true,"options":[{"value":"text","label":"文生视频"},{"value":"image","label":"图生视频"},{"value":"video","label":"参考视频"}]},
        {"key":"resolution","label":"分辨率","type":"enum","required":true,"options":[{"value":"540P","label":"540P"},{"value":"720P","label":"720P"},{"value":"1080P","label":"1080P"},{"value":"2K","label":"2K"},{"value":"4K","label":"4K"}]},
        {"key":"duration","label":"时长（秒）","type":"number","required":true}
      ],
      "matchingRules":[
        {"ruleKey":"viduq2_text_720p","label":"Q2 文生 720P","enabled":true,"priority":120,"evaluatorKey":"viduq2_text_720p_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2"},{"field":"inputType","op":"eq","value":"text"},{"field":"resolution","op":"eq","value":"720P"}]}},
        {"ruleKey":"viduq2_text_1080p","label":"Q2 文生 1080P","enabled":true,"priority":120,"evaluatorKey":"viduq2_text_1080p_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2"},{"field":"inputType","op":"eq","value":"text"},{"field":"resolution","op":"eq","value":"1080P"}]}},
        {"ruleKey":"viduq2_text_2k","label":"Q2 文生 2K","enabled":true,"priority":120,"evaluatorKey":"viduq2_text_2k_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2"},{"field":"inputType","op":"eq","value":"text"},{"field":"resolution","op":"eq","value":"2K"}]}},
        {"ruleKey":"viduq2_text_4k","label":"Q2 文生 4K","enabled":true,"priority":120,"evaluatorKey":"viduq2_text_4k_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2"},{"field":"inputType","op":"eq","value":"text"},{"field":"resolution","op":"eq","value":"4K"}]}},
        {"ruleKey":"viduq2_video_540p","label":"Q2 参考生 540P","enabled":true,"priority":110,"evaluatorKey":"viduq2_video_540p_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2"},{"field":"inputType","op":"eq","value":"video"},{"field":"resolution","op":"eq","value":"540P"}]}},
        {"ruleKey":"viduq2_video_720p","label":"Q2 参考生 720P","enabled":true,"priority":110,"evaluatorKey":"viduq2_video_720p_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2"},{"field":"inputType","op":"eq","value":"video"},{"field":"resolution","op":"eq","value":"720P"}]}},
        {"ruleKey":"viduq2_video_1080p","label":"Q2 参考生 1080P","enabled":true,"priority":110,"evaluatorKey":"viduq2_video_1080p_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2"},{"field":"inputType","op":"eq","value":"video"},{"field":"resolution","op":"eq","value":"1080P"}]}},
        {"ruleKey":"viduq2_video_2k","label":"Q2 参考生 2K","enabled":true,"priority":110,"evaluatorKey":"viduq2_video_2k_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2"},{"field":"inputType","op":"eq","value":"video"},{"field":"resolution","op":"eq","value":"2K"}]}},
        {"ruleKey":"viduq2_video_4k","label":"Q2 参考生 4K","enabled":true,"priority":110,"evaluatorKey":"viduq2_video_4k_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2"},{"field":"inputType","op":"eq","value":"video"},{"field":"resolution","op":"eq","value":"4K"}]}},
        {"ruleKey":"viduq2pro_image_720p","label":"Q2 Pro 图生 720P","enabled":true,"priority":100,"evaluatorKey":"viduq2pro_image_720p_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2-pro"},{"field":"inputType","op":"eq","value":"image"},{"field":"resolution","op":"eq","value":"720P"}]}},
        {"ruleKey":"viduq2pro_image_1080p","label":"Q2 Pro 图生 1080P","enabled":true,"priority":100,"evaluatorKey":"viduq2pro_image_1080p_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2-pro"},{"field":"inputType","op":"eq","value":"image"},{"field":"resolution","op":"eq","value":"1080P"}]}},
        {"ruleKey":"viduq2pro_image_2k","label":"Q2 Pro 图生 2K","enabled":true,"priority":100,"evaluatorKey":"viduq2pro_image_2k_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2-pro"},{"field":"inputType","op":"eq","value":"image"},{"field":"resolution","op":"eq","value":"2K"}]}},
        {"ruleKey":"viduq2pro_image_4k","label":"Q2 Pro 图生 4K","enabled":true,"priority":100,"evaluatorKey":"viduq2pro_image_4k_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2-pro"},{"field":"inputType","op":"eq","value":"image"},{"field":"resolution","op":"eq","value":"4K"}]}},
        {"ruleKey":"viduq2pro_video_540p","label":"Q2 Pro 参考生 540P","enabled":true,"priority":90,"evaluatorKey":"viduq2pro_video_540p_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2-pro"},{"field":"inputType","op":"eq","value":"video"},{"field":"resolution","op":"eq","value":"540P"}]}},
        {"ruleKey":"viduq2pro_video_720p","label":"Q2 Pro 参考生 720P","enabled":true,"priority":90,"evaluatorKey":"viduq2pro_video_720p_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2-pro"},{"field":"inputType","op":"eq","value":"video"},{"field":"resolution","op":"eq","value":"720P"}]}},
        {"ruleKey":"viduq2pro_video_1080p","label":"Q2 Pro 参考生 1080P","enabled":true,"priority":90,"evaluatorKey":"viduq2pro_video_1080p_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2-pro"},{"field":"inputType","op":"eq","value":"video"},{"field":"resolution","op":"eq","value":"1080P"}]}},
        {"ruleKey":"viduq2pro_video_2k","label":"Q2 Pro 参考生 2K","enabled":true,"priority":90,"evaluatorKey":"viduq2pro_video_2k_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2-pro"},{"field":"inputType","op":"eq","value":"video"},{"field":"resolution","op":"eq","value":"2K"}]}},
        {"ruleKey":"viduq2pro_video_4k","label":"Q2 Pro 参考生 4K","enabled":true,"priority":90,"evaluatorKey":"viduq2pro_video_4k_eval","conditions":{"all":[{"field":"viduModel","op":"eq","value":"q2-pro"},{"field":"inputType","op":"eq","value":"video"},{"field":"resolution","op":"eq","value":"4K"}]}}
      ],
      "evaluators":{
        "viduq2_text_720p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.32},
        "viduq2_text_1080p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.47},
        "viduq2_text_2k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.7},
        "viduq2_text_4k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.05},
        "viduq2_video_540p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.24},
        "viduq2_video_720p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.32},
        "viduq2_video_1080p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.82},
        "viduq2_video_2k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.23},
        "viduq2_video_4k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.845},
        "viduq2pro_image_720p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.35},
        "viduq2pro_image_1080p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.7},
        "viduq2pro_image_2k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1},
        "viduq2pro_image_4k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.5},
        "viduq2pro_video_540p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.27},
        "viduq2pro_video_720p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.35},
        "viduq2pro_video_1080p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.9},
        "viduq2pro_video_2k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.35},
        "viduq2pro_video_4k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":2.025}
      },
      "displayConfig":{
        "specAxes":["viduModel","inputType","resolution","duration"],
        "labels":{"viduModel.q2":"Q2","viduModel.q2-pro":"Q2 Pro","inputType.text":"文生视频","inputType.image":"图生视频","inputType.video":"参考视频","resolution.540P":"540P","resolution.720P":"720P","resolution.1080P":"1080P","resolution.2K":"2K","resolution.4K":"4K"},
        "defaultSelections":{"viduModel":"q2","inputType":"text","resolution":"720P","duration":5},
        "presets":[
          {"viduModel":"q2","inputType":"text","resolution":"720P","duration":5},
          {"viduModel":"q2","inputType":"video","resolution":"1080P","duration":5},
          {"viduModel":"q2-pro","inputType":"image","resolution":"720P","duration":5},
          {"viduModel":"q2-pro","inputType":"video","resolution":"1080P","duration":5}
        ]
      }
  }$$::jsonb
)::text
WHERE "key" = 'model_provider_mapping_v2';

UPDATE "SystemSetting"
SET "value" = replace_managed_vendor_pricing(
  replace_managed_vendor_pricing(
    "value"::jsonb,
    'kling-o3',
    'legacy',
    $${
      "version":"v2",
      "dimensions":[
        {"key":"inputType","label":"输入类型","type":"enum","required":true,"options":[{"value":"text","label":"文生 / 图生"},{"value":"video","label":"参考视频"}]},
        {"key":"hasAudio","label":"声音","type":"boolean","required":true,"options":[{"value":false,"label":"无声"},{"value":true,"label":"有声"}]},
        {"key":"mode","label":"模式","type":"enum","required":true,"options":[{"value":"std","label":"标准"},{"value":"pro","label":"高品质"}]},
        {"key":"duration","label":"时长（秒）","type":"enum","required":true,"options":[{"value":5,"label":"5 秒"},{"value":10,"label":"10 秒"}]}
      ],
      "matchingRules":[
        {"ruleKey":"klingo3_text_silent_std_5","label":"Kling O3 文生/图生 无声 std 5s","enabled":true,"priority":120,"evaluatorKey":"klingo3_text_silent_std_5_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"text"},{"field":"hasAudio","op":"eq","value":false},{"field":"mode","op":"eq","value":"std"},{"field":"duration","op":"eq","value":5}]}},
        {"ruleKey":"klingo3_text_silent_std_10","label":"Kling O3 文生/图生 无声 std 10s","enabled":true,"priority":120,"evaluatorKey":"klingo3_text_silent_std_10_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"text"},{"field":"hasAudio","op":"eq","value":false},{"field":"mode","op":"eq","value":"std"},{"field":"duration","op":"eq","value":10}]}},
        {"ruleKey":"klingo3_text_silent_pro_5","label":"Kling O3 文生/图生 无声 pro 5s","enabled":true,"priority":120,"evaluatorKey":"klingo3_text_silent_pro_5_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"text"},{"field":"hasAudio","op":"eq","value":false},{"field":"mode","op":"eq","value":"pro"},{"field":"duration","op":"eq","value":5}]}},
        {"ruleKey":"klingo3_text_silent_pro_10","label":"Kling O3 文生/图生 无声 pro 10s","enabled":true,"priority":120,"evaluatorKey":"klingo3_text_silent_pro_10_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"text"},{"field":"hasAudio","op":"eq","value":false},{"field":"mode","op":"eq","value":"pro"},{"field":"duration","op":"eq","value":10}]}},
        {"ruleKey":"klingo3_text_audio_std_5","label":"Kling O3 文生/图生 有声 std 5s","enabled":true,"priority":110,"evaluatorKey":"klingo3_text_audio_std_5_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"text"},{"field":"hasAudio","op":"eq","value":true},{"field":"mode","op":"eq","value":"std"},{"field":"duration","op":"eq","value":5}]}},
        {"ruleKey":"klingo3_text_audio_std_10","label":"Kling O3 文生/图生 有声 std 10s","enabled":true,"priority":110,"evaluatorKey":"klingo3_text_audio_std_10_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"text"},{"field":"hasAudio","op":"eq","value":true},{"field":"mode","op":"eq","value":"std"},{"field":"duration","op":"eq","value":10}]}},
        {"ruleKey":"klingo3_text_audio_pro_5","label":"Kling O3 文生/图生 有声 pro 5s","enabled":true,"priority":110,"evaluatorKey":"klingo3_text_audio_pro_5_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"text"},{"field":"hasAudio","op":"eq","value":true},{"field":"mode","op":"eq","value":"pro"},{"field":"duration","op":"eq","value":5}]}},
        {"ruleKey":"klingo3_text_audio_pro_10","label":"Kling O3 文生/图生 有声 pro 10s","enabled":true,"priority":110,"evaluatorKey":"klingo3_text_audio_pro_10_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"text"},{"field":"hasAudio","op":"eq","value":true},{"field":"mode","op":"eq","value":"pro"},{"field":"duration","op":"eq","value":10}]}},
        {"ruleKey":"klingo3_video_silent_std_5","label":"Kling O3 参考视频 无声 std 5s","enabled":true,"priority":100,"evaluatorKey":"klingo3_video_silent_std_5_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"video"},{"field":"hasAudio","op":"eq","value":false},{"field":"mode","op":"eq","value":"std"},{"field":"duration","op":"eq","value":5}]}},
        {"ruleKey":"klingo3_video_silent_std_10","label":"Kling O3 参考视频 无声 std 10s","enabled":true,"priority":100,"evaluatorKey":"klingo3_video_silent_std_10_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"video"},{"field":"hasAudio","op":"eq","value":false},{"field":"mode","op":"eq","value":"std"},{"field":"duration","op":"eq","value":10}]}},
        {"ruleKey":"klingo3_video_silent_pro_5","label":"Kling O3 参考视频 无声 pro 5s","enabled":true,"priority":100,"evaluatorKey":"klingo3_video_silent_pro_5_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"video"},{"field":"hasAudio","op":"eq","value":false},{"field":"mode","op":"eq","value":"pro"},{"field":"duration","op":"eq","value":5}]}},
        {"ruleKey":"klingo3_video_silent_pro_10","label":"Kling O3 参考视频 无声 pro 10s","enabled":true,"priority":100,"evaluatorKey":"klingo3_video_silent_pro_10_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"video"},{"field":"hasAudio","op":"eq","value":false},{"field":"mode","op":"eq","value":"pro"},{"field":"duration","op":"eq","value":10}]}}
      ],
      "evaluators":{
        "klingo3_text_silent_std_5_eval":{"type":"fixed","priceYuan":3},
        "klingo3_text_silent_std_10_eval":{"type":"fixed","priceYuan":6},
        "klingo3_text_silent_pro_5_eval":{"type":"fixed","priceYuan":4},
        "klingo3_text_silent_pro_10_eval":{"type":"fixed","priceYuan":8},
        "klingo3_text_audio_std_5_eval":{"type":"fixed","priceYuan":4},
        "klingo3_text_audio_std_10_eval":{"type":"fixed","priceYuan":8},
        "klingo3_text_audio_pro_5_eval":{"type":"fixed","priceYuan":5},
        "klingo3_text_audio_pro_10_eval":{"type":"fixed","priceYuan":10},
        "klingo3_video_silent_std_5_eval":{"type":"fixed","priceYuan":4.5},
        "klingo3_video_silent_std_10_eval":{"type":"fixed","priceYuan":9},
        "klingo3_video_silent_pro_5_eval":{"type":"fixed","priceYuan":6},
        "klingo3_video_silent_pro_10_eval":{"type":"fixed","priceYuan":12}
      },
      "displayConfig":{
        "specAxes":["inputType","hasAudio","mode","duration"],
        "labels":{"inputType.text":"文生 / 图生","inputType.video":"参考视频","hasAudio.false":"无声","hasAudio.true":"有声","mode.std":"标准","mode.pro":"高品质","duration.5":"5 秒","duration.10":"10 秒"},
        "defaultSelections":{"inputType":"text","hasAudio":false,"mode":"std","duration":5},
        "presets":[
          {"inputType":"text","hasAudio":false,"mode":"std","duration":5},
          {"inputType":"text","hasAudio":true,"mode":"pro","duration":5},
          {"inputType":"video","hasAudio":false,"mode":"std","duration":5},
          {"inputType":"video","hasAudio":false,"mode":"pro","duration":10}
        ]
      }
    }$$::jsonb
  ),
  'kling-o3',
  'tencent_vod',
  $${
    "version":"v2",
    "dimensions":[
      {"key":"inputType","label":"输入类型","type":"enum","required":true,"options":[{"value":"text","label":"文生 / 图生"},{"value":"image","label":"文生 / 图生"},{"value":"video","label":"参考视频"}]},
      {"key":"hasAudio","label":"声音","type":"boolean","required":true,"options":[{"value":false,"label":"无声"},{"value":true,"label":"有声"}]},
      {"key":"resolution","label":"分辨率","type":"enum","required":true,"options":[{"value":"720P","label":"720P"},{"value":"1080P","label":"1080P"},{"value":"2K","label":"2K"},{"value":"4K","label":"4K"}]},
      {"key":"duration","label":"时长（秒）","type":"number","required":true}
    ],
    "matchingRules":[
      {"ruleKey":"klingo3_tencent_text_silent_720p","label":"Kling O3 无参考无声 720P","enabled":true,"priority":120,"evaluatorKey":"klingo3_tencent_text_silent_720p_eval","conditions":{"all":[{"field":"inputType","op":"in","value":["text","image"]},{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"720P"}]}},
      {"ruleKey":"klingo3_tencent_text_silent_1080p","label":"Kling O3 无参考无声 1080P","enabled":true,"priority":120,"evaluatorKey":"klingo3_tencent_text_silent_1080p_eval","conditions":{"all":[{"field":"inputType","op":"in","value":["text","image"]},{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"1080P"}]}},
      {"ruleKey":"klingo3_tencent_text_silent_2k","label":"Kling O3 无参考无声 2K","enabled":true,"priority":120,"evaluatorKey":"klingo3_tencent_text_silent_2k_eval","conditions":{"all":[{"field":"inputType","op":"in","value":["text","image"]},{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"2K"}]}},
      {"ruleKey":"klingo3_tencent_text_silent_4k","label":"Kling O3 无参考无声 4K","enabled":true,"priority":120,"evaluatorKey":"klingo3_tencent_text_silent_4k_eval","conditions":{"all":[{"field":"inputType","op":"in","value":["text","image"]},{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"4K"}]}},
      {"ruleKey":"klingo3_tencent_text_audio_720p","label":"Kling O3 无参考有声 720P","enabled":true,"priority":110,"evaluatorKey":"klingo3_tencent_text_audio_720p_eval","conditions":{"all":[{"field":"inputType","op":"in","value":["text","image"]},{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"720P"}]}},
      {"ruleKey":"klingo3_tencent_text_audio_1080p","label":"Kling O3 无参考有声 1080P","enabled":true,"priority":110,"evaluatorKey":"klingo3_tencent_text_audio_1080p_eval","conditions":{"all":[{"field":"inputType","op":"in","value":["text","image"]},{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"1080P"}]}},
      {"ruleKey":"klingo3_tencent_text_audio_2k","label":"Kling O3 无参考有声 2K","enabled":true,"priority":110,"evaluatorKey":"klingo3_tencent_text_audio_2k_eval","conditions":{"all":[{"field":"inputType","op":"in","value":["text","image"]},{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"2K"}]}},
      {"ruleKey":"klingo3_tencent_text_audio_4k","label":"Kling O3 无参考有声 4K","enabled":true,"priority":110,"evaluatorKey":"klingo3_tencent_text_audio_4k_eval","conditions":{"all":[{"field":"inputType","op":"in","value":["text","image"]},{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"4K"}]}},
      {"ruleKey":"klingo3_tencent_video_silent_720p","label":"Kling O3 有参考无声 720P","enabled":true,"priority":100,"evaluatorKey":"klingo3_tencent_video_silent_720p_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"video"},{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"720P"}]}},
      {"ruleKey":"klingo3_tencent_video_silent_1080p","label":"Kling O3 有参考无声 1080P","enabled":true,"priority":100,"evaluatorKey":"klingo3_tencent_video_silent_1080p_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"video"},{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"1080P"}]}},
      {"ruleKey":"klingo3_tencent_video_silent_2k","label":"Kling O3 有参考无声 2K","enabled":true,"priority":100,"evaluatorKey":"klingo3_tencent_video_silent_2k_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"video"},{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"2K"}]}},
      {"ruleKey":"klingo3_tencent_video_silent_4k","label":"Kling O3 有参考无声 4K","enabled":true,"priority":100,"evaluatorKey":"klingo3_tencent_video_silent_4k_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"video"},{"field":"hasAudio","op":"eq","value":false},{"field":"resolution","op":"eq","value":"4K"}]}},
      {"ruleKey":"klingo3_tencent_video_audio_720p","label":"Kling O3 有参考有声 720P","enabled":true,"priority":90,"evaluatorKey":"klingo3_tencent_video_audio_720p_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"video"},{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"720P"}]}},
      {"ruleKey":"klingo3_tencent_video_audio_1080p","label":"Kling O3 有参考有声 1080P","enabled":true,"priority":90,"evaluatorKey":"klingo3_tencent_video_audio_1080p_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"video"},{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"1080P"}]}},
      {"ruleKey":"klingo3_tencent_video_audio_2k","label":"Kling O3 有参考有声 2K","enabled":true,"priority":90,"evaluatorKey":"klingo3_tencent_video_audio_2k_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"video"},{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"2K"}]}},
      {"ruleKey":"klingo3_tencent_video_audio_4k","label":"Kling O3 有参考有声 4K","enabled":true,"priority":90,"evaluatorKey":"klingo3_tencent_video_audio_4k_eval","conditions":{"all":[{"field":"inputType","op":"eq","value":"video"},{"field":"hasAudio","op":"eq","value":true},{"field":"resolution","op":"eq","value":"4K"}]}}
    ],
    "evaluators":{
      "klingo3_tencent_text_silent_720p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.6},
      "klingo3_tencent_text_silent_1080p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.8},
      "klingo3_tencent_text_silent_2k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1},
      "klingo3_tencent_text_silent_4k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.2},
      "klingo3_tencent_text_audio_720p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.8},
      "klingo3_tencent_text_audio_1080p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1},
      "klingo3_tencent_text_audio_2k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.2},
      "klingo3_tencent_text_audio_4k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.5},
      "klingo3_tencent_video_silent_720p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.9},
      "klingo3_tencent_video_silent_1080p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.2},
      "klingo3_tencent_video_silent_2k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.5},
      "klingo3_tencent_video_silent_4k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":2},
      "klingo3_tencent_video_audio_720p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.1},
      "klingo3_tencent_video_audio_1080p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.4},
      "klingo3_tencent_video_audio_2k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1.8},
      "klingo3_tencent_video_audio_4k_eval":{"type":"linear","unitField":"duration","unitPriceYuan":2.4}
    },
    "displayConfig":{
      "specAxes":["inputType","hasAudio","resolution","duration"],
      "labels":{"inputType.text":"文生 / 图生","inputType.image":"文生 / 图生","inputType.video":"参考视频","hasAudio.false":"无声","hasAudio.true":"有声","resolution.720P":"720P","resolution.1080P":"1080P","resolution.2K":"2K","resolution.4K":"4K"},
      "defaultSelections":{"inputType":"text","hasAudio":false,"resolution":"720P","duration":5},
      "presets":[
        {"inputType":"text","hasAudio":false,"resolution":"720P","duration":5},
        {"inputType":"text","hasAudio":true,"resolution":"1080P","duration":5},
        {"inputType":"video","hasAudio":false,"resolution":"720P","duration":5},
        {"inputType":"video","hasAudio":true,"resolution":"1080P","duration":5}
      ]
    }
  }$$::jsonb
)::text
WHERE "key" = 'model_provider_mapping_v2';

WITH setting AS (
  SELECT "value"::jsonb AS cfg
  FROM "SystemSetting"
  WHERE "key" = 'model_provider_mapping_v2'
),
targets(node_key, model_key) AS (
  VALUES
    ('doubaoVideo', 'seedance-1.5'),
    ('seedance20Video', 'seedance-2.0'),
    ('viduVideo', 'vidu-q2'),
    ('viduQ3', 'vidu-q3'),
    ('klingO1Video', 'kling-o3')
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
FROM setting, targets,
LATERAL build_node_managed_payload(setting.cfg, targets.model_key) AS payload
WHERE n."nodeKey" = targets.node_key
  AND payload IS NOT NULL;

DROP FUNCTION IF EXISTS replace_managed_vendor_pricing(jsonb, text, text, jsonb);
DROP FUNCTION IF EXISTS build_node_managed_payload(jsonb, text);

COMMIT;
