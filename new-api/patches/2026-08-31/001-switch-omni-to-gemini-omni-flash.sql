-- Switch Tanva's Omni canvas product to ToAPIs gemini-omni-flash.
--
-- ToAPIs endpoint:
--   POST /v1/videos/generations
--   GET  /v1/videos/generations/{task_id}
--
-- The ModelPrice value is the 720P 4/6-second retail base (RMB 1.05 cost x1.5).
-- The APIMart/ToAPIs adaptor applies a request-time ratio for the other
-- resolution/duration cells, so new-api pre-charge matches Tanva's matrix.
-- PostgreSQL, data-only, idempotent.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule, capabilities, params_def
)
SELECT
  'gemini_omni_flash',
  'ToAPIs Gemini Omni Flash video generation',
  NULL, 'toapis,video,omni', NULL, '/v1/videos/generations', 'video', 1,
  0, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0,
  '["reference_images","reference_video"]',
  '[{"key":"duration","type":"integer","label":"时长","options":[4,6,10]},{"key":"resolution","type":"string","label":"分辨率","options":["720P","1080P"]},{"key":"aspect_ratio","type":"string","label":"画幅"}]'
WHERE NOT EXISTS (
  SELECT 1 FROM models
  WHERE model_name = 'gemini_omni_flash' AND deleted_at IS NULL
);

UPDATE models
SET description = 'ToAPIs Gemini Omni Flash video generation',
    tags = 'toapis,video,omni',
    endpoints = '/v1/videos/generations',
    kind = 'video',
    status = 1,
    capabilities = '["reference_images","reference_video"]',
    params_def = '[{"key":"duration","type":"integer","label":"时长","options":[4,6,10]},{"key":"resolution","type":"string","label":"分辨率","options":["720P","1080P"]},{"key":"aspect_ratio","type":"string","label":"画幅"}]',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'gemini_omni_flash' AND deleted_at IS NULL;

UPDATE channels c
SET models = (
  SELECT string_agg(DISTINCT model_name, ',' ORDER BY model_name)
  FROM (
    SELECT trim(x) AS model_name
    FROM unnest(string_to_array(COALESCE(c.models, ''), ',')) x
    UNION ALL
    SELECT 'gemini_omni_flash'
  ) all_models
  WHERE model_name <> ''
)
WHERE c.type = 59
  AND lower(regexp_replace(c.base_url, '/+$', '')) IN ('https://toapis.com', 'https://toapis.xyz');

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT trim(g.grp), 'gemini_omni_flash', c.id, true,
       COALESCE(c.priority, 0), COALESCE(c.weight, 0),
       COALESCE(NULLIF(c.tag, ''), 'toapis')
FROM channels c
CROSS JOIN unnest(string_to_array(c."group", ',')) g(grp)
WHERE c.type = 59
  AND lower(regexp_replace(c.base_url, '/+$', '')) IN ('https://toapis.com', 'https://toapis.xyz')
  AND trim(g.grp) <> ''
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = true,
    priority = EXCLUDED.priority,
    weight = EXCLUDED.weight,
    tag = EXCLUDED.tag;

INSERT INTO options (key, value)
VALUES ('ModelPrice', '{"gemini_omni_flash":1.575}')
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, ''), '{}')::jsonb
  || EXCLUDED.value::jsonb
)::text;

COMMIT;

\echo '----- Gemini Omni Flash ToAPIs route -----'
SELECT m.model_name, m.kind, m.status, c.name AS channel_name, a."group", a.enabled
FROM models m
LEFT JOIN abilities a ON a.model = m.model_name
LEFT JOIN channels c ON c.id = a.channel_id
WHERE m.model_name = 'gemini_omni_flash'
  AND m.deleted_at IS NULL
ORDER BY c.name, a."group";

\echo '----- Gemini Omni Flash base ModelPrice -----'
SELECT value::jsonb -> 'gemini_omni_flash' AS base_price
FROM options
WHERE key = 'ModelPrice';
