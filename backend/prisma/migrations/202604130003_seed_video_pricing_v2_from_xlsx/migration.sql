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

INSERT INTO "SystemSetting" ("id", "key", "value", "description", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'model_provider_mapping_v2',
  '{"version":"v2","platforms":[{"platformKey":"legacy","platformName":"旧链路(Kapon)","enabled":true,"route":"legacy","description":"保留当前默认老链路，未切厂商时回退使用"},{"platformKey":"tencent_vod","platformName":"腾讯 VOD","enabled":true,"route":"tencent_vod","description":"腾讯云 VOD AIGC 视频生成","metadata":{"service":"tencent_vod","endpoint":"https://vod.tencentcloudapi.com/","upstreamDomain":"vod.tencentcloudapi.com","apiVersion":"2018-07-17","createTask":{"method":"POST","action":"CreateAigcVideoTask","url":"https://vod.tencentcloudapi.com/"},"queryTask":{"method":"POST","action":"DescribeTaskDetail","url":"https://vod.tencentcloudapi.com/"},"polling":{"strategy":"describe_task_detail","successStatuses":["FINISH","SUCCESS","SUCCEEDED","COMPLETED"],"processingStatuses":["WAITING","PROCESSING","RUNNING","QUEUED","PENDING"],"failedStatuses":["FAIL","FAILED","ERROR","CANCELED","CANCELLED"]},"responseMapping":{"taskId":["Response.TaskId"],"status":["Response.Status","Response.TaskStatus"],"fileId":["Response.FileId","Response.MediaInfo.FileId"],"fileUrl":["Response.FileUrl","Response.MediaUrl","Response.PlayUrl"],"message":["Response.Message","Response.Error.Message"],"requestId":["Response.RequestId"]}}},{"platformKey":"vidu_api","platformName":"Vidu API","enabled":true,"route":"legacy","provider":"vidu","description":"Vidu 官方或兼容 API 渠道"},{"platformKey":"sora2_api","platformName":"Sora 2 API","enabled":true,"route":"legacy","provider":"sora2","description":"Sora 2 视频生成渠道占位"},{"platformKey":"seedance_api","platformName":"Seedance API","enabled":true,"route":"legacy","provider":"doubao","description":"Seedance 视频生成渠道占位"}],"models":[]}',
  '统一模型管理 v2',
  NOW(),
  NOW()
)
ON CONFLICT ("key") DO NOTHING;

UPDATE "SystemSetting"
SET
  "value" = replace_managed_model(
    replace_managed_model(
      replace_managed_model(
        "value"::jsonb,
        $${
          "modelKey":"kling-2.6",
          "modelName":"Kling 2.6",
          "taskType":"video",
          "enabled":true,
          "defaultVendor":"legacy",
          "vendors":[
            {
              "vendorKey":"legacy",
              "platformKey":"legacy",
              "label":"旧链路(Kapon)",
              "enabled":true,
              "route":"legacy",
              "provider":"kling-2.6",
              "modelName":"Kling",
              "modelVersion":"2.6",
              "priceYuan":1.5,
              "creditsPerCall":150,
              "pricing":{
                "version":"v2",
                "dimensions":[
                  {"key":"sound","label":"声音","type":"enum","required":true,"options":[{"value":"off","label":"无"},{"value":"on","label":"有"}]},
                  {"key":"mode","label":"模式","type":"enum","required":true,"options":[{"value":"std","label":"标准（std）"},{"value":"pro","label":"高品质（pro）"}]},
                  {"key":"duration","label":"时长（秒）","type":"enum","required":true,"options":[{"value":5,"label":"5 秒"},{"value":10,"label":"10 秒"}]}
                ],
                "matchingRules":[
                  {"ruleKey":"kling26_off_std_5","label":"Kling 2.6 无声 std 5s","enabled":true,"priority":100,"evaluatorKey":"kling26_off_std_5_eval","conditions":{"all":[{"field":"sound","op":"in","value":[false,"off","false"]},{"field":"mode","op":"eq","value":"std"},{"field":"duration","op":"eq","value":5}]}},
                  {"ruleKey":"kling26_off_std_10","label":"Kling 2.6 无声 std 10s","enabled":true,"priority":100,"evaluatorKey":"kling26_off_std_10_eval","conditions":{"all":[{"field":"sound","op":"in","value":[false,"off","false"]},{"field":"mode","op":"eq","value":"std"},{"field":"duration","op":"eq","value":10}]}},
                  {"ruleKey":"kling26_off_pro_5","label":"Kling 2.6 无声 pro 5s","enabled":true,"priority":100,"evaluatorKey":"kling26_off_pro_5_eval","conditions":{"all":[{"field":"sound","op":"in","value":[false,"off","false"]},{"field":"mode","op":"eq","value":"pro"},{"field":"duration","op":"eq","value":5}]}},
                  {"ruleKey":"kling26_off_pro_10","label":"Kling 2.6 无声 pro 10s","enabled":true,"priority":100,"evaluatorKey":"kling26_off_pro_10_eval","conditions":{"all":[{"field":"sound","op":"in","value":[false,"off","false"]},{"field":"mode","op":"eq","value":"pro"},{"field":"duration","op":"eq","value":10}]}},
                  {"ruleKey":"kling26_on_std_5","label":"Kling 2.6 有声 std 5s","enabled":true,"priority":100,"evaluatorKey":"kling26_on_std_5_eval","conditions":{"all":[{"field":"sound","op":"in","value":[true,"on","true"]},{"field":"mode","op":"eq","value":"std"},{"field":"duration","op":"eq","value":5}]}},
                  {"ruleKey":"kling26_on_std_10","label":"Kling 2.6 有声 std 10s","enabled":true,"priority":100,"evaluatorKey":"kling26_on_std_10_eval","conditions":{"all":[{"field":"sound","op":"in","value":[true,"on","true"]},{"field":"mode","op":"eq","value":"std"},{"field":"duration","op":"eq","value":10}]}},
                  {"ruleKey":"kling26_on_pro_5","label":"Kling 2.6 有声 pro 5s","enabled":true,"priority":100,"evaluatorKey":"kling26_on_pro_5_eval","conditions":{"all":[{"field":"sound","op":"in","value":[true,"on","true"]},{"field":"mode","op":"eq","value":"pro"},{"field":"duration","op":"eq","value":5}]}},
                  {"ruleKey":"kling26_on_pro_10","label":"Kling 2.6 有声 pro 10s","enabled":true,"priority":100,"evaluatorKey":"kling26_on_pro_10_eval","conditions":{"all":[{"field":"sound","op":"in","value":[true,"on","true"]},{"field":"mode","op":"eq","value":"pro"},{"field":"duration","op":"eq","value":10}]}}
                ],
                "evaluators":{
                  "kling26_off_std_5_eval":{"type":"fixed","priceYuan":1.5},
                  "kling26_off_std_10_eval":{"type":"fixed","priceYuan":3},
                  "kling26_off_pro_5_eval":{"type":"fixed","priceYuan":3},
                  "kling26_off_pro_10_eval":{"type":"fixed","priceYuan":5},
                  "kling26_on_std_5_eval":{"type":"fixed","priceYuan":5},
                  "kling26_on_std_10_eval":{"type":"fixed","priceYuan":10},
                  "kling26_on_pro_5_eval":{"type":"fixed","priceYuan":6},
                  "kling26_on_pro_10_eval":{"type":"fixed","priceYuan":12}
                },
                "displayConfig":{
                  "specAxes":["sound","mode","duration"],
                  "labels":{"sound.off":"无","sound.on":"有","mode.std":"标准（std）","mode.pro":"高品质（pro）","duration.5":"5 秒","duration.10":"10 秒"},
                  "defaultSelections":{"sound":"off","mode":"std","duration":5},
                  "presets":[
                    {"sound":"off","mode":"std","duration":5},
                    {"sound":"off","mode":"pro","duration":5},
                    {"sound":"on","mode":"std","duration":5},
                    {"sound":"on","mode":"pro","duration":5},
                    {"sound":"off","mode":"std","duration":10},
                    {"sound":"off","mode":"pro","duration":10},
                    {"sound":"on","mode":"std","duration":10},
                    {"sound":"on","mode":"pro","duration":10}
                  ]
                }
              }
            }
          ]
        }$$::jsonb
      ),
      $${
        "modelKey":"kling-3.0",
        "modelName":"Kling 3.0",
        "taskType":"video",
        "enabled":true,
        "defaultVendor":"legacy",
        "vendors":[
          {
            "vendorKey":"legacy",
            "platformKey":"legacy",
            "label":"旧链路(Kapon)",
            "enabled":true,
            "route":"legacy",
            "provider":"kling-o3",
            "modelName":"Kling",
            "modelVersion":"3.0",
            "priceYuan":3,
            "creditsPerCall":300,
            "pricing":{
              "version":"v2",
              "dimensions":[
                {"key":"sound","label":"声音","type":"enum","required":true,"options":[{"value":"off","label":"无"},{"value":"on","label":"有"}]},
                {"key":"mode","label":"模式","type":"enum","required":true,"options":[{"value":"std","label":"标准（720P）"},{"value":"pro","label":"高品质（1080P）"}]},
                {"key":"duration","label":"时长（秒）","type":"enum","required":true,"options":[{"value":5,"label":"5 秒"},{"value":10,"label":"10 秒"}]}
              ],
              "matchingRules":[
                {"ruleKey":"kling30_off_std_5","label":"Kling 3.0 无声 std 5s","enabled":true,"priority":100,"evaluatorKey":"kling30_off_std_5_eval","conditions":{"all":[{"field":"sound","op":"in","value":[false,"off","false"]},{"field":"mode","op":"eq","value":"std"},{"field":"duration","op":"eq","value":5}]}},
                {"ruleKey":"kling30_off_std_10","label":"Kling 3.0 无声 std 10s","enabled":true,"priority":100,"evaluatorKey":"kling30_off_std_10_eval","conditions":{"all":[{"field":"sound","op":"in","value":[false,"off","false"]},{"field":"mode","op":"eq","value":"std"},{"field":"duration","op":"eq","value":10}]}},
                {"ruleKey":"kling30_off_pro_5","label":"Kling 3.0 无声 pro 5s","enabled":true,"priority":100,"evaluatorKey":"kling30_off_pro_5_eval","conditions":{"all":[{"field":"sound","op":"in","value":[false,"off","false"]},{"field":"mode","op":"eq","value":"pro"},{"field":"duration","op":"eq","value":5}]}},
                {"ruleKey":"kling30_off_pro_10","label":"Kling 3.0 无声 pro 10s","enabled":true,"priority":100,"evaluatorKey":"kling30_off_pro_10_eval","conditions":{"all":[{"field":"sound","op":"in","value":[false,"off","false"]},{"field":"mode","op":"eq","value":"pro"},{"field":"duration","op":"eq","value":10}]}},
                {"ruleKey":"kling30_on_std_5","label":"Kling 3.0 有声 std 5s","enabled":true,"priority":100,"evaluatorKey":"kling30_on_std_5_eval","conditions":{"all":[{"field":"sound","op":"in","value":[true,"on","true"]},{"field":"mode","op":"eq","value":"std"},{"field":"duration","op":"eq","value":5}]}},
                {"ruleKey":"kling30_on_std_10","label":"Kling 3.0 有声 std 10s","enabled":true,"priority":100,"evaluatorKey":"kling30_on_std_10_eval","conditions":{"all":[{"field":"sound","op":"in","value":[true,"on","true"]},{"field":"mode","op":"eq","value":"std"},{"field":"duration","op":"eq","value":10}]}},
                {"ruleKey":"kling30_on_pro_5","label":"Kling 3.0 有声 pro 5s","enabled":true,"priority":100,"evaluatorKey":"kling30_on_pro_5_eval","conditions":{"all":[{"field":"sound","op":"in","value":[true,"on","true"]},{"field":"mode","op":"eq","value":"pro"},{"field":"duration","op":"eq","value":5}]}},
                {"ruleKey":"kling30_on_pro_10","label":"Kling 3.0 有声 pro 10s","enabled":true,"priority":100,"evaluatorKey":"kling30_on_pro_10_eval","conditions":{"all":[{"field":"sound","op":"in","value":[true,"on","true"]},{"field":"mode","op":"eq","value":"pro"},{"field":"duration","op":"eq","value":10}]}}
              ],
              "evaluators":{
                "kling30_off_std_5_eval":{"type":"fixed","priceYuan":3},
                "kling30_off_std_10_eval":{"type":"fixed","priceYuan":6},
                "kling30_off_pro_5_eval":{"type":"fixed","priceYuan":4},
                "kling30_off_pro_10_eval":{"type":"fixed","priceYuan":8},
                "kling30_on_std_5_eval":{"type":"fixed","priceYuan":4.5},
                "kling30_on_std_10_eval":{"type":"fixed","priceYuan":9},
                "kling30_on_pro_5_eval":{"type":"fixed","priceYuan":6},
                "kling30_on_pro_10_eval":{"type":"fixed","priceYuan":12}
              },
              "displayConfig":{
                "specAxes":["sound","mode","duration"],
                "labels":{"sound.off":"无","sound.on":"有","mode.std":"标准（720P）","mode.pro":"高品质（1080P）","duration.5":"5 秒","duration.10":"10 秒"},
                "defaultSelections":{"sound":"off","mode":"std","duration":5},
                "presets":[
                  {"sound":"off","mode":"std","duration":5},
                  {"sound":"off","mode":"pro","duration":5},
                  {"sound":"on","mode":"std","duration":5},
                  {"sound":"on","mode":"pro","duration":5},
                  {"sound":"off","mode":"std","duration":10},
                  {"sound":"off","mode":"pro","duration":10},
                  {"sound":"on","mode":"std","duration":10},
                  {"sound":"on","mode":"pro","duration":10}
                ]
              }
            }
          },
          {
            "vendorKey":"tencent_vod",
            "platformKey":"tencent_vod",
            "label":"腾讯 VOD",
            "enabled":true,
            "route":"tencent_vod",
            "provider":"kling-o3",
            "modelName":"Kling",
            "modelVersion":"3.0",
            "priceYuan":3,
            "creditsPerCall":300
          }
        ]
      }$$::jsonb
    ),
    $${
      "modelKey":"vidu-q3",
      "modelName":"Vidu Q3",
      "taskType":"video",
      "enabled":true,
      "defaultVendor":"vidu_api",
      "vendors":[
        {
          "vendorKey":"vidu_api",
          "platformKey":"vidu_api",
          "label":"Vidu API",
          "enabled":true,
          "route":"legacy",
          "provider":"viduq3-pro",
          "modelName":"Vidu",
          "modelVersion":"Q3",
          "priceYuan":1.25,
          "creditsPerCall":125,
          "pricing":{
            "version":"v2",
            "dimensions":[
              {"key":"viduModelVariant","label":"Vidu 型号","type":"enum","required":true,"options":[{"value":"q3-turbo","label":"Q3 Turbo"},{"value":"q3","label":"Q3"}]},
              {"key":"resolution","label":"分辨率","type":"enum","required":true,"options":[{"value":"540P","label":"540P"},{"value":"720P","label":"720P"},{"value":"1080P","label":"1080P"}]},
              {"key":"duration","label":"时长（秒）","type":"number","required":true}
            ],
            "matchingRules":[
              {"ruleKey":"viduq3_turbo_540p","label":"Q3 Turbo 540P","enabled":true,"priority":100,"evaluatorKey":"viduq3_turbo_540p_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-turbo"},{"field":"resolution","op":"eq","value":"540P"}]}},
              {"ruleKey":"viduq3_turbo_720p","label":"Q3 Turbo 720P","enabled":true,"priority":100,"evaluatorKey":"viduq3_turbo_720p_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-turbo"},{"field":"resolution","op":"eq","value":"720P"}]}},
              {"ruleKey":"viduq3_turbo_1080p","label":"Q3 Turbo 1080P","enabled":true,"priority":100,"evaluatorKey":"viduq3_turbo_1080p_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-turbo"},{"field":"resolution","op":"eq","value":"1080P"}]}},
              {"ruleKey":"viduq3_720p","label":"Q3 720P","enabled":true,"priority":90,"evaluatorKey":"viduq3_720p_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3"},{"field":"resolution","op":"eq","value":"720P"}]}},
              {"ruleKey":"viduq3_1080p","label":"Q3 1080P","enabled":true,"priority":90,"evaluatorKey":"viduq3_1080p_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3"},{"field":"resolution","op":"eq","value":"1080P"}]}}
            ],
            "evaluators":{
              "viduq3_turbo_540p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.25},
              "viduq3_turbo_720p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.375},
              "viduq3_turbo_1080p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.5},
              "viduq3_720p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.9375},
              "viduq3_1080p_eval":{"type":"linear","unitField":"duration","unitPriceYuan":1}
            },
            "displayConfig":{
              "specAxes":["viduModelVariant","resolution","duration"],
              "labels":{"viduModelVariant.q3-turbo":"Q3 Turbo","viduModelVariant.q3":"Q3","resolution.540P":"540P","resolution.720P":"720P","resolution.1080P":"1080P"},
              "defaultSelections":{"viduModelVariant":"q3-turbo","resolution":"540P","duration":5},
              "presets":[
                {"viduModelVariant":"q3-turbo","resolution":"540P","duration":5},
                {"viduModelVariant":"q3-turbo","resolution":"720P","duration":5},
                {"viduModelVariant":"q3-turbo","resolution":"1080P","duration":5},
                {"viduModelVariant":"q3","resolution":"720P","duration":5},
                {"viduModelVariant":"q3","resolution":"1080P","duration":5}
              ]
            }
          }
        },
        {
          "vendorKey":"tencent_vod",
          "platformKey":"tencent_vod",
          "label":"腾讯 VOD",
          "enabled":true,
          "route":"tencent_vod",
          "provider":"vidu",
          "modelName":"Vidu",
          "modelVersion":"q3",
          "priceYuan":0.625,
          "creditsPerCall":63,
          "metadata":{
            "executionBranch":"v2_request_profile",
            "requestProfile":{
              "enabled":true,
              "version":"v2",
              "transport":"tencent_vod_aigc_video",
              "create":{
                "body":{
                  "modelName":"{{vendor.modelName}}",
                  "modelVersion":"{{vendor.modelVersion}}",
                  "prompt":"{{vod.prompt}}",
                  "fileInfos":"{{vod.fileInfos}}",
                  "lastFrameUrl":"{{vod.lastFrameUrl}}",
                  "aspectRatio":"{{vod.aspectRatio}}",
                  "duration":"{{vod.duration}}",
                  "resolution":"{{vod.resolution}}",
                  "storageMode":"{{vod.storageMode}}",
                  "enhancePrompt":"{{vod.enhancePrompt}}"
                },
                "responseMapping":{"taskId":["taskId"],"requestId":["requestId"]}
              },
              "query":{"responseMapping":{"status":["status"],"videoUrl":["videoUrl"],"fileId":["fileId"],"requestId":["requestId"]}}
            }
          },
          "pricing":{
            "version":"v2",
            "dimensions":[
              {"key":"viduModelVariant","label":"Vidu 型号","type":"enum","required":true,"options":[{"value":"q3","label":"Q3 参考生"},{"value":"q3-pro","label":"Q3 Pro"},{"value":"q3-mix","label":"Q3 Mix"}]},
              {"key":"resolution","label":"分辨率","type":"enum","required":true,"options":[{"value":"480P","label":"480P / 540P"},{"value":"540P","label":"480P / 540P"},{"value":"720P","label":"720P"},{"value":"1080P","label":"1080P"},{"value":"2K","label":"2K"},{"value":"4K","label":"4K"}]},
              {"key":"duration","label":"时长（秒）","type":"number","required":true},
              {"key":"offPeak","label":"错峰模式","type":"boolean","required":false}
            ],
            "matchingRules":[
              {"ruleKey":"vidu_q3_ref_offpeak_540","label":"Q3 参考生 错峰 540P","enabled":true,"priority":120,"evaluatorKey":"vidu_q3_ref_offpeak_540_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3"},{"field":"offPeak","op":"eq","value":true},{"field":"resolution","op":"in","value":["480P","540P"]}]}},
              {"ruleKey":"vidu_q3_ref_offpeak_720","label":"Q3 参考生 错峰 720P","enabled":true,"priority":120,"evaluatorKey":"vidu_q3_ref_offpeak_720_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3"},{"field":"offPeak","op":"eq","value":true},{"field":"resolution","op":"eq","value":"720P"}]}},
              {"ruleKey":"vidu_q3_ref_offpeak_1080","label":"Q3 参考生 错峰 1080P","enabled":true,"priority":120,"evaluatorKey":"vidu_q3_ref_offpeak_1080_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3"},{"field":"offPeak","op":"eq","value":true},{"field":"resolution","op":"eq","value":"1080P"}]}},
              {"ruleKey":"vidu_q3_ref_540","label":"Q3 参考生 540P","enabled":true,"priority":110,"evaluatorKey":"vidu_q3_ref_540_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3"},{"field":"resolution","op":"in","value":["480P","540P"]}]}},
              {"ruleKey":"vidu_q3_ref_720","label":"Q3 参考生 720P","enabled":true,"priority":110,"evaluatorKey":"vidu_q3_ref_720_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3"},{"field":"resolution","op":"eq","value":"720P"}]}},
              {"ruleKey":"vidu_q3_ref_1080","label":"Q3 参考生 1080P","enabled":true,"priority":110,"evaluatorKey":"vidu_q3_ref_1080_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3"},{"field":"resolution","op":"eq","value":"1080P"}]}},
              {"ruleKey":"vidu_q3_pro_offpeak_540","label":"Q3 Pro 错峰 540P","enabled":true,"priority":100,"evaluatorKey":"vidu_q3_pro_offpeak_540_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-pro"},{"field":"offPeak","op":"eq","value":true},{"field":"resolution","op":"in","value":["480P","540P"]}]}},
              {"ruleKey":"vidu_q3_pro_offpeak_720","label":"Q3 Pro 错峰 720P","enabled":true,"priority":100,"evaluatorKey":"vidu_q3_pro_offpeak_720_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-pro"},{"field":"offPeak","op":"eq","value":true},{"field":"resolution","op":"eq","value":"720P"}]}},
              {"ruleKey":"vidu_q3_pro_offpeak_1080","label":"Q3 Pro 错峰 1080P","enabled":true,"priority":100,"evaluatorKey":"vidu_q3_pro_offpeak_1080_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-pro"},{"field":"offPeak","op":"eq","value":true},{"field":"resolution","op":"eq","value":"1080P"}]}},
              {"ruleKey":"vidu_q3_pro_540","label":"Q3 Pro 540P","enabled":true,"priority":90,"evaluatorKey":"vidu_q3_pro_540_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-pro"},{"field":"resolution","op":"in","value":["480P","540P"]}]}},
              {"ruleKey":"vidu_q3_pro_720","label":"Q3 Pro 720P","enabled":true,"priority":90,"evaluatorKey":"vidu_q3_pro_720_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-pro"},{"field":"resolution","op":"eq","value":"720P"}]}},
              {"ruleKey":"vidu_q3_pro_1080","label":"Q3 Pro 1080P","enabled":true,"priority":90,"evaluatorKey":"vidu_q3_pro_1080_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-pro"},{"field":"resolution","op":"eq","value":"1080P"}]}},
              {"ruleKey":"vidu_q3_mix_720","label":"Q3 Mix 720P","enabled":true,"priority":80,"evaluatorKey":"vidu_q3_mix_720_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-mix"},{"field":"resolution","op":"eq","value":"720P"}]}},
              {"ruleKey":"vidu_q3_mix_1080","label":"Q3 Mix 1080P","enabled":true,"priority":80,"evaluatorKey":"vidu_q3_mix_1080_eval","conditions":{"all":[{"field":"viduModelVariant","op":"eq","value":"q3-mix"},{"field":"resolution","op":"eq","value":"1080P"}]}}
            ],
            "evaluators":{
              "vidu_q3_ref_offpeak_540_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.157},
              "vidu_q3_ref_offpeak_720_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.313},
              "vidu_q3_ref_offpeak_1080_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.391},
              "vidu_q3_ref_540_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.313},
              "vidu_q3_ref_720_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.625},
              "vidu_q3_ref_1080_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.782},
              "vidu_q3_pro_offpeak_540_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.157},
              "vidu_q3_pro_offpeak_720_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.391},
              "vidu_q3_pro_offpeak_1080_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.469},
              "vidu_q3_pro_540_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.313},
              "vidu_q3_pro_720_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.782},
              "vidu_q3_pro_1080_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.938},
              "vidu_q3_mix_720_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.782},
              "vidu_q3_mix_1080_eval":{"type":"linear","unitField":"duration","unitPriceYuan":0.938}
            },
            "displayConfig":{
              "specAxes":["viduModelVariant","resolution","duration","offPeak"],
              "labels":{"viduModelVariant.q3":"Q3 参考生","viduModelVariant.q3-pro":"Q3 Pro","viduModelVariant.q3-mix":"Q3 Mix","resolution.480P":"480P / 540P","resolution.540P":"480P / 540P","resolution.720P":"720P","resolution.1080P":"1080P","offPeak.true":"错峰","offPeak.false":"常规"},
              "defaultSelections":{"viduModelVariant":"q3","resolution":"720P","duration":5,"offPeak":false},
              "presets":[
                {"viduModelVariant":"q3","resolution":"720P","duration":5,"offPeak":false},
                {"viduModelVariant":"q3","resolution":"720P","duration":5,"offPeak":true},
                {"viduModelVariant":"q3-pro","resolution":"720P","duration":5,"offPeak":false},
                {"viduModelVariant":"q3-pro","resolution":"720P","duration":5,"offPeak":true},
                {"viduModelVariant":"q3-mix","resolution":"1080P","duration":5,"offPeak":false}
              ]
            }
          }
        }
      ]
    }$$::jsonb
  )::text,
  "description" = '统一模型管理 v2',
  "updatedAt" = NOW()
WHERE "key" = 'model_provider_mapping_v2';

DROP FUNCTION replace_managed_model(jsonb, jsonb);

COMMIT;
