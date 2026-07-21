-- Register every video generation model documented by ToAPIs as of 2026-07-18.
-- Source index: https://docs.toapis.com/llms.txt
-- Endpoint: POST /v1/videos/generations; poll GET /v1/videos/generations/{id}.
-- Excludes operation-only endpoints (remix, extend, persona/avatar management).
-- PostgreSQL, data-only, idempotent. Existing model specs/prices are preserved.

\set ON_ERROR_STOP on
BEGIN;

WITH video_models(model_name) AS (VALUES
  ('doubao-seedance-1-5-pro'),
  ('doubao-seedance-1-0-pro-fast'),
  ('doubao-seedance-1-0-pro-quality'),
  ('gemini_omni_flash'),
  ('grok-video-1.5-preview'),
  ('grok-video-3'),
  ('happyhorse-1.1'),
  ('kling-v2-6'),
  ('kling-3.0-turbo'),
  ('kling-v3-omni'),
  ('kling-v3'),
  ('kling-video-o1'),
  ('MiniMax-Hailuo-2.3'),
  ('MiniMax-Hailuo-2.3-Fast'),
  ('MiniMax-Hailuo-02'),
  ('seedance-2'),
  ('seedance-2-fast'),
  ('seedance-2-mini'),
  ('sora-2-official'),
  ('sora-2-vvip'),
  ('Veo3.1-fast-official'),
  ('Veo3.1-quality-official'),
  ('veo3.1-fast'),
  ('veo3.1-lite'),
  ('veo3.1-quality'),
  ('viduq3'),
  ('viduq3-pro'),
  ('viduq3-turbo'),
  ('wan2.6-flash'),
  ('wan2.6')
)
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule, capabilities, params_def
)
SELECT
  vm.model_name,
  'ToAPIs async video generation model ' || vm.model_name,
  NULL, 'toapis,video', NULL, '/v1/videos/generations', 'video', 1,
  0, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0,
  '["reference_images","first_last_frame","reference_video"]',
  '[{"key":"duration","type":"integer","label":"时长"},{"key":"size","type":"string","label":"画幅"},{"key":"resolution","type":"string","label":"分辨率"}]'
FROM video_models vm
WHERE NOT EXISTS (
  SELECT 1 FROM models m WHERE m.model_name = vm.model_name AND m.deleted_at IS NULL
);

WITH video_models(model_name) AS (VALUES
  ('doubao-seedance-1-5-pro'),('doubao-seedance-1-0-pro-fast'),
  ('doubao-seedance-1-0-pro-quality'),('gemini_omni_flash'),
  ('grok-video-1.5-preview'),('grok-video-3'),('happyhorse-1.1'),
  ('kling-v2-6'),('kling-3.0-turbo'),('kling-v3-omni'),('kling-v3'),
  ('kling-video-o1'),('MiniMax-Hailuo-2.3'),('MiniMax-Hailuo-2.3-Fast'),
  ('MiniMax-Hailuo-02'),('seedance-2'),('seedance-2-fast'),('seedance-2-mini'),
  ('sora-2-official'),('sora-2-vvip'),('Veo3.1-fast-official'),
  ('Veo3.1-quality-official'),('veo3.1-fast'),('veo3.1-lite'),('veo3.1-quality'),
  ('viduq3'),('viduq3-pro'),('viduq3-turbo'),('wan2.6-flash'),('wan2.6')
)
UPDATE models m
SET kind = 'video', status = 1, updated_time = EXTRACT(EPOCH FROM NOW())::bigint,
    capabilities = COALESCE(NULLIF(m.capabilities, ''), '["reference_images"]'),
    params_def = COALESCE(NULLIF(m.params_def, ''),
      '[{"key":"duration","type":"integer","label":"时长"},{"key":"size","type":"string","label":"画幅"},{"key":"resolution","type":"string","label":"分辨率"}]')
FROM video_models vm
WHERE m.model_name = vm.model_name AND m.deleted_at IS NULL;

WITH video_models(model_name) AS (VALUES
  ('doubao-seedance-1-5-pro'),('doubao-seedance-1-0-pro-fast'),
  ('doubao-seedance-1-0-pro-quality'),('gemini_omni_flash'),
  ('grok-video-1.5-preview'),('grok-video-3'),('happyhorse-1.1'),
  ('kling-v2-6'),('kling-3.0-turbo'),('kling-v3-omni'),('kling-v3'),
  ('kling-video-o1'),('MiniMax-Hailuo-2.3'),('MiniMax-Hailuo-2.3-Fast'),
  ('MiniMax-Hailuo-02'),('seedance-2'),('seedance-2-fast'),('seedance-2-mini'),
  ('sora-2-official'),('sora-2-vvip'),('Veo3.1-fast-official'),
  ('Veo3.1-quality-official'),('veo3.1-fast'),('veo3.1-lite'),('veo3.1-quality'),
  ('viduq3'),('viduq3-pro'),('viduq3-turbo'),('wan2.6-flash'),('wan2.6')
)
UPDATE channels c
SET models = (
  SELECT string_agg(DISTINCT model_name, ',' ORDER BY model_name)
  FROM (
    SELECT trim(x) AS model_name FROM unnest(string_to_array(COALESCE(c.models, ''), ',')) x
    UNION ALL
    SELECT vm.model_name FROM video_models vm
  ) all_models
  WHERE model_name <> ''
)
WHERE c.type = 59 AND lower(regexp_replace(c.base_url, '/+$', '')) = 'https://toapis.com';

WITH video_models(model_name) AS (VALUES
  ('doubao-seedance-1-5-pro'),('doubao-seedance-1-0-pro-fast'),
  ('doubao-seedance-1-0-pro-quality'),('gemini_omni_flash'),
  ('grok-video-1.5-preview'),('grok-video-3'),('happyhorse-1.1'),
  ('kling-v2-6'),('kling-3.0-turbo'),('kling-v3-omni'),('kling-v3'),
  ('kling-video-o1'),('MiniMax-Hailuo-2.3'),('MiniMax-Hailuo-2.3-Fast'),
  ('MiniMax-Hailuo-02'),('seedance-2'),('seedance-2-fast'),('seedance-2-mini'),
  ('sora-2-official'),('sora-2-vvip'),('Veo3.1-fast-official'),
  ('Veo3.1-quality-official'),('veo3.1-fast'),('veo3.1-lite'),('veo3.1-quality'),
  ('viduq3'),('viduq3-pro'),('viduq3-turbo'),('wan2.6-flash'),('wan2.6')
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT trim(g.grp), vm.model_name, c.id, true,
       COALESCE(c.priority, 0), COALESCE(c.weight, 0), COALESCE(NULLIF(c.tag, ''), 'toapis')
FROM channels c
CROSS JOIN unnest(string_to_array(c."group", ',')) g(grp)
CROSS JOIN video_models vm
WHERE c.type = 59
  AND lower(regexp_replace(c.base_url, '/+$', '')) = 'https://toapis.com'
  AND trim(g.grp) <> ''
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled, priority = EXCLUDED.priority,
    weight = EXCLUDED.weight, tag = EXCLUDED.tag;

COMMIT;
