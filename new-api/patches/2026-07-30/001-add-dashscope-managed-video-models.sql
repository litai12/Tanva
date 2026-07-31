-- Register the DashScope video models still used by Tanva's legacy-compatible
-- /api/ai/dashscope/* endpoints. The upstream key belongs to a type=17 new-api
-- channel; this patch intentionally never stores or creates a credential.
-- PostgreSQL, data-only, idempotent.

\set ON_ERROR_STOP on
BEGIN;

WITH video_models(model_name, description, capabilities) AS (VALUES
  ('wan2.6-t2v', 'DashScope Wan 2.6 text-to-video', '[]'),
  ('wan2.6-i2v', 'DashScope Wan 2.6 image-to-video', '["first_frame","audio"]'),
  ('wan2.6-r2v', 'DashScope Wan 2.6 reference-video generation', '["reference_video"]'),
  ('wan2.7-i2v', 'DashScope Wan 2.7 multimodal image-to-video', '["first_frame","last_frame","reference_video","audio"]'),
  ('happyhorse-1.0-t2v', 'DashScope HappyHorse 1.0 text-to-video', '[]'),
  ('happyhorse-1.0-i2v', 'DashScope HappyHorse 1.0 image-to-video', '["first_frame"]'),
  ('happyhorse-1.0-r2v', 'DashScope HappyHorse 1.0 multi-image reference video', '["reference_images"]'),
  ('happyhorse-1.0-video-edit', 'DashScope HappyHorse 1.0 video editing', '["reference_video","reference_images"]')
)
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule, capabilities, params_def
)
SELECT
  vm.model_name,
  vm.description,
  NULL,
  'dashscope,video',
  NULL,
  '/v1/videos',
  'video',
  1,
  1,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0,
  vm.capabilities,
  '[{"key":"duration","type":"integer","label":"时长"},{"key":"size","type":"string","label":"画幅"},{"key":"resolution","type":"string","label":"分辨率"}]'
FROM video_models vm
WHERE NOT EXISTS (
  SELECT 1 FROM models m WHERE m.model_name = vm.model_name AND m.deleted_at IS NULL
);

WITH video_models(model_name) AS (VALUES
  ('wan2.6-t2v'),('wan2.6-i2v'),('wan2.6-r2v'),('wan2.7-i2v'),
  ('happyhorse-1.0-t2v'),('happyhorse-1.0-i2v'),
  ('happyhorse-1.0-r2v'),('happyhorse-1.0-video-edit')
)
UPDATE models m
SET kind = 'video', status = 1, endpoints = '/v1/videos',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM video_models vm
WHERE m.model_name = vm.model_name AND m.deleted_at IS NULL;

WITH video_models(model_name) AS (VALUES
  ('wan2.6-t2v'),('wan2.6-i2v'),('wan2.6-r2v'),('wan2.7-i2v'),
  ('happyhorse-1.0-t2v'),('happyhorse-1.0-i2v'),
  ('happyhorse-1.0-r2v'),('happyhorse-1.0-video-edit')
)
UPDATE channels c
SET models = (
  SELECT string_agg(DISTINCT model_name, ',' ORDER BY model_name)
  FROM (
    SELECT trim(existing_model) AS model_name
    FROM unnest(string_to_array(COALESCE(c.models, ''), ',')) existing_model
    UNION ALL
    SELECT vm.model_name FROM video_models vm
  ) merged_models
  WHERE model_name <> ''
)
WHERE c.type = 17;

WITH video_models(model_name) AS (VALUES
  ('wan2.6-t2v'),('wan2.6-i2v'),('wan2.6-r2v'),('wan2.7-i2v'),
  ('happyhorse-1.0-t2v'),('happyhorse-1.0-i2v'),
  ('happyhorse-1.0-r2v'),('happyhorse-1.0-video-edit')
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT trim(g.grp), vm.model_name, c.id, true,
       COALESCE(c.priority, 0), COALESCE(c.weight, 0), COALESCE(NULLIF(c.tag, ''), 'dashscope')
FROM channels c
CROSS JOIN unnest(string_to_array(COALESCE(NULLIF(c."group", ''), 'default'), ',')) g(grp)
CROSS JOIN video_models vm
WHERE c.type = 17 AND trim(g.grp) <> ''
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled, priority = EXCLUDED.priority,
    weight = EXCLUDED.weight, tag = EXCLUDED.tag;

INSERT INTO options (key, value)
VALUES (
  'ModelRatio',
  '{"wan2.6-t2v":4.0,"wan2.6-i2v":4.0,"wan2.6-r2v":4.0,"wan2.7-i2v":4.0,"happyhorse-1.0-t2v":6.0,"happyhorse-1.0-i2v":6.0,"happyhorse-1.0-r2v":6.0,"happyhorse-1.0-video-edit":6.0}'
)
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, ''), '{}')::jsonb || EXCLUDED.value::jsonb
)::text;

COMMIT;
