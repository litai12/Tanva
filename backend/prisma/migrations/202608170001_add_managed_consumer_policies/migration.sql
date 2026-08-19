BEGIN;

-- Consumer operations are separate from catalog pricing: they only alter the
-- credits charged to users (or block a matched spec) at request time.
CREATE OR REPLACE FUNCTION patch_seedance_consumer_policies(config jsonb)
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
          WHEN model_item->>'modelKey' = 'seedance-2.0' THEN
            jsonb_set(
              model_item,
              '{vendors}',
              (
                SELECT COALESCE(
                  jsonb_agg(
                    CASE
                      WHEN vendor_item->>'vendorKey' = 'seedance_api' THEN
                        jsonb_set(
                          vendor_item,
                          '{pricing,consumerPolicies}',
                          $policies$
                          [
                            {
                              "policyKey":"seedance25_1080p_72_campaign",
                              "label":"Seedance 2.5 1080P 限时 7.2 折（72%）",
                              "enabled":true,
                              "priority":200,
                              "startsAt":"2026-08-14T14:00:00+08:00",
                              "endsAt":"2026-09-17T14:00:00+08:00",
                              "conditions":{"all":[
                                {"field":"seedanceModel","op":"eq","value":"seedance-2.5"},
                                {"field":"resolution","op":"eq","value":"1080P"}
                              ],"any":[]},
                              "discount":{"multiplier":0.72}
                            },
                            {
                              "policyKey":"seedance25_4k_unavailable",
                              "label":"Seedance 2.5 4K 暂未开放",
                              "enabled":true,
                              "priority":210,
                              "conditions":{"all":[
                                {"field":"seedanceModel","op":"eq","value":"seedance-2.5"},
                                {"field":"resolution","op":"eq","value":"4K"}
                              ],"any":[]},
                              "availability":{"available":false,"message":"暂未开放"}
                            }
                          ]
                          $policies$::jsonb,
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
    FROM source,
         jsonb_array_elements(COALESCE(source.cfg->'models', '[]'::jsonb)) model_item
  )
  SELECT jsonb_set(source.cfg, '{models}', rebuilt_models.models, true)
  FROM source, rebuilt_models;
$fn$;

UPDATE "SystemSetting"
SET "value" = patch_seedance_consumer_policies("value"::jsonb)::text,
    "updatedAt" = NOW()
WHERE "key" = 'model_provider_mapping_v2';

DROP FUNCTION IF EXISTS patch_seedance_consumer_policies(jsonb);

COMMIT;
