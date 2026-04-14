BEGIN;

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
LATERAL build_node_managed_payload(setting.cfg, 'wan-2.6') AS payload
WHERE n."nodeKey" = 'wan26'
  AND payload IS NOT NULL;

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
LATERAL build_node_managed_payload(setting.cfg, 'wan-2.6-r2v') AS payload
WHERE n."nodeKey" = 'wan2R2V'
  AND payload IS NOT NULL;

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
LATERAL build_node_managed_payload(setting.cfg, 'wan-2.7') AS payload
WHERE n."nodeKey" = 'wan27Video'
  AND payload IS NOT NULL;

DROP FUNCTION IF EXISTS build_node_managed_payload(jsonb, text);

COMMIT;
