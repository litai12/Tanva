BEGIN;

CREATE OR REPLACE FUNCTION patch_managed_model_vendor(
  config jsonb,
  target_model_key text,
  target_vendor_key text,
  vendor_patch jsonb,
  metadata_patch jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  next_config jsonb;
BEGIN
  SELECT jsonb_set(
    config,
    '{models}',
    COALESCE(
      (
        SELECT jsonb_agg(
          CASE
            WHEN model_item->>'modelKey' = target_model_key THEN
              jsonb_strip_nulls(
                model_item ||
                CASE
                  WHEN metadata_patch IS NULL THEN '{}'::jsonb
                  ELSE jsonb_build_object(
                    'metadata',
                    COALESCE(model_item->'metadata', '{}'::jsonb) || metadata_patch
                  )
                END ||
                jsonb_build_object(
                  'vendors',
                  COALESCE(
                    (
                      SELECT jsonb_agg(
                        CASE
                          WHEN vendor_item->>'vendorKey' = target_vendor_key THEN
                            jsonb_strip_nulls(vendor_item || vendor_patch)
                          ELSE vendor_item
                        END
                      )
                      FROM jsonb_array_elements(COALESCE(model_item->'vendors', '[]'::jsonb)) AS vendor_item
                    ),
                    '[]'::jsonb
                  )
                )
              )
            ELSE model_item
          END
        )
        FROM jsonb_array_elements(COALESCE(config->'models', '[]'::jsonb)) AS model_item
      ),
      '[]'::jsonb
    ),
    true
  )
  INTO next_config;

  RETURN next_config;
END;
$fn$;

CREATE OR REPLACE FUNCTION apply_wan_pricing_uplift(config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  next_config jsonb := config;
  wan_vendor_patch jsonb := jsonb_build_object(
    'creditsPerCall', 400,
    'priceYuan', 4
  );
BEGIN
  next_config := patch_managed_model_vendor(
    next_config,
    'wan-2.6',
    'dashscope',
    wan_vendor_patch || jsonb_build_object(
      'pricing',
      jsonb_build_object(
        'defaults', jsonb_build_object('credits', 400, 'priceYuan', 4),
        'evaluators', jsonb_build_object(
          'wan_720p_linear_eval', jsonb_build_object(
            'type', 'linear',
            'unitField', 'durationSec',
            'unitPriceYuan', 0.8
          ),
          'wan_1080p_linear_eval', jsonb_build_object(
            'type', 'linear',
            'unitField', 'durationSec',
            'unitPriceYuan', 1.2
          )
        )
      )
    ),
    jsonb_build_object(
      'specPricing',
      jsonb_build_object(
        'defaults', jsonb_build_object('credits', 400, 'priceYuan', 4),
        'rules', jsonb_build_array(
          jsonb_build_object(
            'when', jsonb_build_object('generationMode', 't2v', 'resolution', '720P', 'durationSec', 5),
            'price', jsonb_build_object('credits', 400, 'priceYuan', 4)
          ),
          jsonb_build_object(
            'when', jsonb_build_object('generationMode', 't2v', 'resolution', '1080P', 'durationSec', 5),
            'price', jsonb_build_object('credits', 600, 'priceYuan', 6)
          )
        )
      )
    )
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'wan-2.6-r2v',
    'dashscope',
    wan_vendor_patch || jsonb_build_object(
      'pricing',
      jsonb_build_object(
        'defaults', jsonb_build_object('credits', 400, 'priceYuan', 4),
        'evaluators', jsonb_build_object(
          'wan_720p_linear_eval', jsonb_build_object(
            'type', 'linear',
            'unitField', 'durationSec',
            'unitPriceYuan', 0.8
          ),
          'wan_1080p_linear_eval', jsonb_build_object(
            'type', 'linear',
            'unitField', 'durationSec',
            'unitPriceYuan', 1.2
          )
        )
      )
    ),
    jsonb_build_object(
      'specPricing',
      jsonb_build_object(
        'defaults', jsonb_build_object('credits', 400, 'priceYuan', 4),
        'rules', jsonb_build_array(
          jsonb_build_object(
            'when', jsonb_build_object('generationMode', 'r2v', 'resolution', '720P', 'durationSec', 5),
            'price', jsonb_build_object('credits', 400, 'priceYuan', 4)
          ),
          jsonb_build_object(
            'when', jsonb_build_object('generationMode', 'r2v', 'resolution', '1080P', 'durationSec', 5),
            'price', jsonb_build_object('credits', 600, 'priceYuan', 6)
          )
        )
      )
    )
  );

  next_config := patch_managed_model_vendor(
    next_config,
    'wan-2.7',
    'dashscope',
    wan_vendor_patch || jsonb_build_object(
      'pricing',
      jsonb_build_object(
        'defaults', jsonb_build_object('credits', 400, 'priceYuan', 4),
        'evaluators', jsonb_build_object(
          'wan_720p_linear_eval', jsonb_build_object(
            'type', 'linear',
            'unitField', 'durationSec',
            'unitPriceYuan', 0.8
          ),
          'wan_1080p_linear_eval', jsonb_build_object(
            'type', 'linear',
            'unitField', 'durationSec',
            'unitPriceYuan', 1.2
          )
        )
      )
    ),
    jsonb_build_object(
      'specPricing',
      jsonb_build_object(
        'defaults', jsonb_build_object('credits', 400, 'priceYuan', 4),
        'rules', jsonb_build_array(
          jsonb_build_object(
            'when', jsonb_build_object('generationMode', 'i2v', 'resolution', '720P', 'durationSec', 5),
            'price', jsonb_build_object('credits', 400, 'priceYuan', 4)
          ),
          jsonb_build_object(
            'when', jsonb_build_object('generationMode', 'i2v', 'resolution', '1080P', 'durationSec', 5),
            'price', jsonb_build_object('credits', 600, 'priceYuan', 6)
          )
        )
      )
    )
  );

  RETURN next_config;
END;
$fn$;

UPDATE "SystemSetting"
SET "value" = apply_wan_pricing_uplift(COALESCE("value"::jsonb, '{}'::jsonb))::text
WHERE "key" = 'model_provider_mapping_v2';

DROP FUNCTION IF EXISTS apply_wan_pricing_uplift(jsonb);
DROP FUNCTION IF EXISTS patch_managed_model_vendor(jsonb, text, text, jsonb, jsonb);

COMMIT;
