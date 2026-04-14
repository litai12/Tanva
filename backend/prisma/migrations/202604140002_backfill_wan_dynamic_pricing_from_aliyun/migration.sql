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

CREATE OR REPLACE FUNCTION build_wan_linear_pricing(
  generation_modes jsonb
)
RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT jsonb_build_object(
    'version', 'v2',
    'defaults', jsonb_build_object(
      'credits', 400,
      'priceYuan', 4
    ),
    'dimensions', jsonb_build_array(
      jsonb_build_object(
        'key', 'generationMode',
        'label', '生成方式',
        'type', 'enum',
        'required', true,
        'options', (
          SELECT jsonb_agg(
            jsonb_build_object(
              'value', mode_value,
              'label',
                CASE mode_value
                  WHEN 't2v' THEN '文生视频'
                  WHEN 'i2v' THEN '图生视频'
                  WHEN 'r2v' THEN '参考视频'
                  ELSE mode_value
                END
            )
          )
          FROM jsonb_array_elements_text(generation_modes) AS mode_value
        )
      ),
      jsonb_build_object(
        'key', 'resolution',
        'label', '分辨率',
        'type', 'enum',
        'required', true,
        'options', jsonb_build_array(
          jsonb_build_object('value', '720P', 'label', '720P'),
          jsonb_build_object('value', '1080P', 'label', '1080P')
        )
      ),
      jsonb_build_object(
        'key', 'durationSec',
        'label', '时长（秒）',
        'type', 'number',
        'required', true,
        'description', '按秒线性计费'
      )
    ),
    'matchingRules', jsonb_build_array(
      jsonb_build_object(
        'ruleKey', 'wan_720p_linear',
        'label', 'Wan 720P 按秒计费',
        'enabled', true,
        'priority', 100,
        'evaluatorKey', 'wan_720p_linear_eval',
        'conditions', jsonb_build_object(
          'all', jsonb_build_array(
            jsonb_build_object('field', 'generationMode', 'op', 'in', 'value', generation_modes),
            jsonb_build_object('field', 'resolution', 'op', 'eq', 'value', '720P')
          ),
          'any', '[]'::jsonb
        )
      ),
      jsonb_build_object(
        'ruleKey', 'wan_1080p_linear',
        'label', 'Wan 1080P 按秒计费',
        'enabled', true,
        'priority', 110,
        'evaluatorKey', 'wan_1080p_linear_eval',
        'conditions', jsonb_build_object(
          'all', jsonb_build_array(
            jsonb_build_object('field', 'generationMode', 'op', 'in', 'value', generation_modes),
            jsonb_build_object('field', 'resolution', 'op', 'eq', 'value', '1080P')
          ),
          'any', '[]'::jsonb
        )
      )
    ),
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
    ),
    'displayConfig', jsonb_build_object(
      'specAxes', jsonb_build_array('generationMode', 'resolution', 'durationSec'),
      'labels', jsonb_build_object(
        'generationMode.t2v', '文生视频',
        'generationMode.i2v', '图生视频',
        'generationMode.r2v', '参考视频',
        'resolution.720P', '720P',
        'resolution.1080P', '1080P',
        'durationSec.5', '5 秒',
        'durationSec.10', '10 秒',
        'durationSec.15', '15 秒'
      ),
      'defaultSelections', jsonb_build_object(
        'generationMode', COALESCE(generation_modes->>0, 't2v'),
        'resolution', '720P',
        'durationSec', 5
      ),
      'presets', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'generationMode', mode_value,
            'resolution', resolution_value,
            'durationSec', duration_value
          )
        )
        FROM jsonb_array_elements_text(generation_modes) AS mode_value
        CROSS JOIN (VALUES ('720P'), ('1080P')) AS resolutions(resolution_value)
        CROSS JOIN (VALUES (5), (10), (15)) AS durations(duration_value)
      )
    )
  );
$fn$;

CREATE OR REPLACE FUNCTION apply_wan_dynamic_pricing(config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  next_config jsonb := config;
BEGIN
  next_config := patch_managed_model_vendor(
    next_config,
    'wan-2.6',
    'dashscope',
    jsonb_build_object(
      'creditsPerCall', 400,
      'priceYuan', 4,
      'pricing', build_wan_linear_pricing('["t2v","i2v"]'::jsonb)
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
    jsonb_build_object(
      'creditsPerCall', 400,
      'priceYuan', 4,
      'pricing', build_wan_linear_pricing('["r2v"]'::jsonb)
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
    jsonb_build_object(
      'creditsPerCall', 400,
      'priceYuan', 4,
      'pricing', build_wan_linear_pricing('["i2v"]'::jsonb)
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
SET "value" = apply_wan_dynamic_pricing(COALESCE("value"::jsonb, '{}'::jsonb))::text
WHERE "key" = 'model_provider_mapping_v2';

DROP FUNCTION IF EXISTS apply_wan_dynamic_pricing(jsonb);
DROP FUNCTION IF EXISTS build_wan_linear_pricing(jsonb);
DROP FUNCTION IF EXISTS patch_managed_model_vendor(jsonb, text, text, jsonb, jsonb);

COMMIT;
