BEGIN;

UPDATE "NodeConfig"
SET
  "creditsPerCall" = 150,
  "priceYuan" = 1.5,
  "metadata" = jsonb_set(
    COALESCE("metadata"::jsonb, '{}'::jsonb),
    '{defaultData}',
    COALESCE("metadata"::jsonb->'defaultData', '{}'::jsonb) ||
      '{
        "managedModelKey":"kling-2.6",
        "vendorKey":"legacy",
        "platformKey":"legacy",
        "creditsPerCall":150
      }'::jsonb,
    true
  ) || '{
    "managedModelKey":"kling-2.6",
    "managedRoutes":{
      "modelKey":"kling-2.6",
      "defaultVendor":"legacy",
      "vendors":[
        {
          "vendorKey":"legacy",
          "platformKey":"legacy",
          "label":"旧链路(Kapon)",
          "provider":"kling-2.6",
          "route":"legacy",
          "modelName":"Kling",
          "modelVersion":"2.6",
          "creditsPerCall":150,
          "priceYuan":1.5,
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
              "defaultSelections":{"sound":"off","mode":"std","duration":5}
            }
          }
        }
      ]
    }
  }'::jsonb
WHERE "nodeKey" = 'kling26Video';

UPDATE "NodeConfig"
SET
  "creditsPerCall" = 300,
  "priceYuan" = 3,
  "metadata" = jsonb_set(
    COALESCE("metadata"::jsonb, '{}'::jsonb),
    '{defaultData}',
    COALESCE("metadata"::jsonb->'defaultData', '{}'::jsonb) ||
      '{
        "managedModelKey":"kling-3.0",
        "vendorKey":"legacy",
        "platformKey":"legacy",
        "creditsPerCall":300
      }'::jsonb,
    true
  ) || '{
    "managedModelKey":"kling-3.0",
    "managedRoutes":{
      "modelKey":"kling-3.0",
      "defaultVendor":"legacy",
      "vendors":[
        {
          "vendorKey":"legacy",
          "platformKey":"legacy",
          "label":"旧链路(Kapon)",
          "provider":"kling-o3",
          "route":"legacy",
          "modelName":"Kling",
          "modelVersion":"3.0",
          "creditsPerCall":300,
          "priceYuan":3,
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
              "defaultSelections":{"sound":"off","mode":"std","duration":5}
            }
          }
        },
        {
          "vendorKey":"tencent_vod",
          "platformKey":"tencent_vod",
          "label":"腾讯 VOD",
          "provider":"kling-o3",
          "route":"tencent_vod",
          "modelName":"Kling",
          "modelVersion":"3.0",
          "creditsPerCall":300,
          "priceYuan":3
        }
      ]
    }
  }'::jsonb
WHERE "nodeKey" = 'kling30Video';

COMMIT;
