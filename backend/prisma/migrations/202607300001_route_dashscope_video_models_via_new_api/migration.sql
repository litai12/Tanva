-- Wan 2.6 / Wan 2.7 / HappyHorse keep their existing managed pricing, but
-- Tanva no longer owns a DashScope credential. Runtime submission goes through
-- new-api; the actual Ali/DashScope key is stored only on the gateway channel.

BEGIN;

CREATE OR REPLACE FUNCTION route_dashscope_video_model_via_new_api(
  config jsonb,
  target_model_key text
)
RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT jsonb_set(
    COALESCE(config, '{}'::jsonb),
    '{models}',
    COALESCE(
      (
        SELECT jsonb_agg(
          CASE
            WHEN model_item->>'modelKey' = target_model_key THEN
              model_item || jsonb_build_object(
                'defaultVendor', 'new_api',
                'vendors', COALESCE(
                  (
                    SELECT jsonb_agg(
                      CASE
                        WHEN vendor_item->>'vendorKey' IN ('dashscope', 'new_api') THEN
                          vendor_item || jsonb_build_object(
                            'vendorKey', 'new_api',
                            'platformKey', 'new_api',
                            'label', 'New API · DashScope',
                            'enabled', true,
                            'route', 'legacy',
                            'provider', 'new-api',
                            'metadata', COALESCE(vendor_item->'metadata', '{}'::jsonb) ||
                              jsonb_build_object(
                                'gateway', 'new-api',
                                'routedProvider', 'dashscope'
                              )
                          )
                        ELSE vendor_item
                      END
                      ORDER BY vendor_ordinality
                    )
                    FROM jsonb_array_elements(COALESCE(model_item->'vendors', '[]'::jsonb))
                      WITH ORDINALITY AS vendor_rows(vendor_item, vendor_ordinality)
                  ),
                  '[]'::jsonb
                ),
                'metadata', COALESCE(model_item->'metadata', '{}'::jsonb) ||
                  jsonb_build_object(
                    'vendorTaskKind', 'new_api_video_generation',
                    'gateway', 'new-api',
                    'routedProvider', 'dashscope',
                    'upstreamDomain', 'dashscope.aliyuncs.com'
                  )
              )
            ELSE model_item
          END
          ORDER BY model_ordinality
        )
        FROM jsonb_array_elements(COALESCE(config->'models', '[]'::jsonb))
          WITH ORDINALITY AS model_rows(model_item, model_ordinality)
      ),
      '[]'::jsonb
    ),
    true
  );
$fn$;

UPDATE "SystemSetting"
SET "value" = route_dashscope_video_model_via_new_api(
  route_dashscope_video_model_via_new_api(
    route_dashscope_video_model_via_new_api(
      route_dashscope_video_model_via_new_api(
        route_dashscope_video_model_via_new_api(
          route_dashscope_video_model_via_new_api(
            route_dashscope_video_model_via_new_api(
              COALESCE(NULLIF("value", ''), '{}')::jsonb,
              'wan-2.6'
            ),
            'wan-2.6-r2v'
          ),
          'wan-2.7'
        ),
        'happyhorse-1.0-t2v'
      ),
      'happyhorse-1.0-i2v'
    ),
    'happyhorse-1.0-r2v'
  ),
  'happyhorse-1.0-video-edit'
)::text
WHERE "key" = 'model_provider_mapping_v2';

WITH setting AS (
  SELECT "value"::jsonb AS config
  FROM "SystemSetting"
  WHERE "key" = 'model_provider_mapping_v2'
),
target_nodes(node_key, model_key) AS (
  VALUES
    ('wan26', 'wan-2.6'),
    ('wan2R2V', 'wan-2.6-r2v'),
    ('wan27Video', 'wan-2.7'),
    ('happyhorseR2V', 'happyhorse-1.0-r2v')
),
managed_models AS (
  SELECT
    target_nodes.node_key,
    target_nodes.model_key,
    model_item
  FROM setting
  CROSS JOIN target_nodes
  CROSS JOIN LATERAL (
    SELECT item AS model_item
    FROM jsonb_array_elements(COALESCE(setting.config->'models', '[]'::jsonb)) AS item
    WHERE item->>'modelKey' = target_nodes.model_key
    LIMIT 1
  ) selected_model
),
route_payloads AS (
  SELECT
    managed_models.node_key,
    managed_models.model_key,
    managed_models.model_item,
    selected_vendor.vendor_item
  FROM managed_models
  CROSS JOIN LATERAL (
    SELECT item AS vendor_item
    FROM jsonb_array_elements(COALESCE(managed_models.model_item->'vendors', '[]'::jsonb)) AS item
    WHERE item->>'vendorKey' = COALESCE(
      NULLIF(managed_models.model_item->>'defaultVendor', ''),
      'new_api'
    )
    LIMIT 1
  ) selected_vendor
)
UPDATE "NodeConfig" AS node
SET "metadata" = jsonb_set(
  COALESCE(node."metadata"::jsonb, '{}'::jsonb) || jsonb_build_object(
    'provider', 'new-api',
    'nodeKind', 'new_api_video_generation',
    'upstreamDomain', 'dashscope.aliyuncs.com',
    'managedModelKey', route_payloads.model_key,
    'managedRoutes', jsonb_build_object(
      'modelKey', route_payloads.model_item->>'modelKey',
      'defaultVendor', route_payloads.model_item->>'defaultVendor',
      'vendors', COALESCE(route_payloads.model_item->'vendors', '[]'::jsonb)
    )
  ),
  '{defaultData}',
  COALESCE(node."metadata"::jsonb->'defaultData', '{}'::jsonb) ||
    jsonb_strip_nulls(
      jsonb_build_object(
        'managedModelKey', route_payloads.model_key,
        'vendorKey', route_payloads.vendor_item->>'vendorKey',
        'platformKey', COALESCE(
          NULLIF(route_payloads.vendor_item->>'platformKey', ''),
          route_payloads.vendor_item->>'vendorKey'
        ),
        'provider', route_payloads.vendor_item->>'provider',
        'channelTier', 'default',
        'channelSelectionExplicit', false,
        'creditsPerCall', route_payloads.vendor_item->'creditsPerCall',
        'pricing', route_payloads.vendor_item->'pricing'
      )
    ),
  true
)
FROM route_payloads
WHERE node."nodeKey" = route_payloads.node_key;

DROP FUNCTION IF EXISTS route_dashscope_video_model_via_new_api(jsonb, text);

COMMIT;
