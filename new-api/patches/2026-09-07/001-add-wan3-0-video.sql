-- PostgreSQL deployment patch for backend/docker-compose.yml.
-- MySQL/SQLite fallback: go run ./cmd/register-wan30 -driver mysql|sqlite -apply.
-- Keep in sync with cmd/register-wan30: existing enabled Ali Wan2.7 routes only.
\set ON_ERROR_STOP on
BEGIN;

-- Do not record this patch as applied before a usable source channel exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM abilities a JOIN channels c ON c.id = a.channel_id
    WHERE c.type = 17 AND c.status = 1
      AND a.model = 'wan2.7-i2v' AND a.enabled = true
  ) THEN
    RAISE EXCEPTION 'Wan3.0 registration requires an enabled type=17 Wan2.7 channel; configure it and rerun new-api-patch';
  END IF;
END $$;

INSERT INTO models (
  model_name, description, tags, endpoints, kind, status, sync_official,
  created_time, updated_time, name_rule, capabilities, params_def
)
SELECT
  'wan3.0-video', 'Wan3.0 text-to-video; standard price x 1.5',
  'dashscope,video', '/v1/videos', 'video', 1, 1,
  EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0, '[]',
  '[{"key":"duration","type":"integer","label":"时长","options":[{"value":5},{"value":10},{"value":15},{"value":20},{"value":25},{"value":30}]},{"key":"resolution","type":"string","label":"分辨率","enum":["480P","720P","1080P"]},{"key":"ratio","type":"string","enum":["adaptive"]}]'
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = 'wan3.0-video' AND deleted_at IS NULL
);

UPDATE channels c
SET models = concat_ws(',', NULLIF(trim(both ',' FROM COALESCE(c.models, '')), ''), 'wan3.0-video')
WHERE c.type = 17 AND c.status = 1
  AND EXISTS (
    SELECT 1 FROM abilities a WHERE a.channel_id = c.id
      AND a.model = 'wan2.7-i2v' AND a.enabled = true
  )
  AND NOT EXISTS (
    SELECT 1 FROM unnest(string_to_array(COALESCE(c.models, ''), ',')) AS names(name)
    WHERE trim(name) = 'wan3.0-video'
  );

-- Inherit source groups, priority, weight and tag; preserve existing manual state.
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT a."group", 'wan3.0-video', a.channel_id, a.enabled, a.priority, a.weight, a.tag
FROM abilities a JOIN channels c ON c.id = a.channel_id
WHERE c.type = 17 AND c.status = 1
  AND a.model = 'wan2.7-i2v' AND a.enabled = true
ON CONFLICT ("group", model, channel_id) DO NOTHING;

-- Per-second base price, NOT the five-second price or token ModelRatio.
-- Ali adaptor multiplies duration and resolution factor 1 / 2 / 4.
INSERT INTO options (key, value)
VALUES ('ModelPrice', '{"wan3.0-video":0.45}')
ON CONFLICT (key) DO UPDATE
SET value = (COALESCE(NULLIF(options.value, ''), '{}')::jsonb || EXCLUDED.value::jsonb)::text;

COMMIT;
