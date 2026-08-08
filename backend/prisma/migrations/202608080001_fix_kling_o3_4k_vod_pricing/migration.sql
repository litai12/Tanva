BEGIN;

-- Tencent VOD's current Kling 3.0-Omni 4K list price is RMB 3.00/s for
-- text/image generation, with or without generated audio. Keep the reference
-- video 4K prices unchanged (RMB 2.00/s silent, RMB 2.40/s with audio).
CREATE OR REPLACE FUNCTION patch_kling_o3_vod_4k_pricing(config jsonb)
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
          WHEN model_item->>'modelKey' = 'kling-o3' THEN
            jsonb_set(
              model_item,
              '{vendors}',
              (
                SELECT COALESCE(
                  jsonb_agg(
                    CASE
                      WHEN vendor_item->>'vendorKey' = 'tencent_vod' THEN
                        jsonb_set(
                          jsonb_set(
                            vendor_item,
                            '{pricing,evaluators,klingo3_tencent_text_silent_4k_eval,unitPriceYuan}',
                            '3'::jsonb,
                            false
                          ),
                          '{pricing,evaluators,klingo3_tencent_text_audio_4k_eval,unitPriceYuan}',
                          '3'::jsonb,
                          false
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
    FROM source, jsonb_array_elements(COALESCE(source.cfg->'models', '[]'::jsonb)) model_item
  )
  SELECT jsonb_set(source.cfg, '{models}', rebuilt_models.models, true)
  FROM source, rebuilt_models;
$fn$;

UPDATE "SystemSetting"
SET "value" = patch_kling_o3_vod_4k_pricing("value"::jsonb)::text,
    "updatedAt" = NOW()
WHERE "key" = 'model_provider_mapping_v2';

-- NodeConfig keeps a materialized copy for the public canvas configuration.
-- Refresh it from the authoritative managed-model registry in the same
-- transaction so pricing preview and the node UI cannot disagree.
WITH setting AS (
  SELECT "value"::jsonb AS cfg
  FROM "SystemSetting"
  WHERE "key" = 'model_provider_mapping_v2'
),
model_item AS (
  SELECT model
  FROM setting,
       LATERAL jsonb_array_elements(COALESCE(setting.cfg->'models', '[]'::jsonb)) model
  WHERE model->>'modelKey' = 'kling-o3'
  LIMIT 1
),
vendor_item AS (
  SELECT vendor
  FROM model_item,
       LATERAL jsonb_array_elements(COALESCE(model_item.model->'vendors', '[]'::jsonb)) vendor
  WHERE vendor->>'vendorKey' = 'tencent_vod'
  LIMIT 1
)
UPDATE "NodeConfig" AS node
SET "metadata" = jsonb_set(
      jsonb_set(
        COALESCE(node."metadata"::jsonb, '{}'::jsonb),
        '{managedRoutes}',
        jsonb_build_object(
          'modelKey', model_item.model->>'modelKey',
          'defaultVendor', model_item.model->>'defaultVendor',
          'vendors', COALESCE(model_item.model->'vendors', '[]'::jsonb)
        ),
        true
      ),
      '{defaultData}',
      COALESCE(node."metadata"::jsonb->'defaultData', '{}'::jsonb)
        || jsonb_build_object('pricing', vendor_item.vendor->'pricing'),
      true
    ),
    "updatedAt" = NOW()
FROM model_item, vendor_item
WHERE node."nodeKey" = 'klingO1Video';

DROP FUNCTION IF EXISTS patch_kling_o3_vod_4k_pricing(jsonb);

COMMIT;
