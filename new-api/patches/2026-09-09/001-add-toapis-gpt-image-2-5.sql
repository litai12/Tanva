-- PostgreSQL, idempotent. Register independent ToAPIs image models.
-- Base price is copied from gpt-image-2; resolution multipliers remain 1/1.5/2.
\set ON_ERROR_STOP on
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM models WHERE model_name = 'gpt-image-2' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'gpt-image-2 catalog row is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM channels WHERE type = 59 AND
    lower(regexp_replace(base_url, '/+$', '')) IN ('https://toapis.com', 'https://toapis.xyz')) THEN
    RAISE EXCEPTION 'An existing ToAPIs channel is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM options WHERE key = 'ModelPrice' AND value::jsonb ? 'gpt-image-2') THEN
    RAISE EXCEPTION 'gpt-image-2 ModelPrice is required';
  END IF;
END $$;

CREATE TEMP TABLE gpt25_models (model_name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO gpt25_models VALUES ('gpt-image-2.5-flare'), ('gpt-image-2.5-sunburst');

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule, capabilities, params_def
)
SELECT v.model_name, v.model_name || ' via ToAPIs', m.icon, 'toapis,image',
  m.vendor_id, m.endpoints, 'image', 1, 0,
  EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint,
  m.name_rule, m.capabilities, m.params_def
FROM models m CROSS JOIN gpt25_models v
WHERE m.model_name = 'gpt-image-2' AND m.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM models e WHERE e.model_name = v.model_name AND e.deleted_at IS NULL);

UPDATE channels c SET models = (
  SELECT string_agg(DISTINCT name, ',' ORDER BY name)
  FROM (
    SELECT trim(value) AS name FROM unnest(string_to_array(COALESCE(c.models, ''), ',')) value
    UNION ALL SELECT model_name FROM gpt25_models
  ) names WHERE name <> ''
)
WHERE c.type = 59 AND lower(regexp_replace(c.base_url, '/+$', ''))
  IN ('https://toapis.com', 'https://toapis.xyz');

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT trim(g.grp), v.model_name, c.id, c.status = 1,
  COALESCE(c.priority, 0), COALESCE(c.weight, 0), COALESCE(NULLIF(c.tag, ''), 'toapis')
FROM channels c CROSS JOIN unnest(string_to_array(c."group", ',')) g(grp)
CROSS JOIN gpt25_models v
WHERE c.type = 59 AND lower(regexp_replace(c.base_url, '/+$', ''))
  IN ('https://toapis.com', 'https://toapis.xyz') AND trim(g.grp) <> ''
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled, priority = EXCLUDED.priority, weight = EXCLUDED.weight, tag = EXCLUDED.tag;

UPDATE options SET value = (value::jsonb || jsonb_build_object(
  'gpt-image-2.5-flare', value::jsonb -> 'gpt-image-2',
  'gpt-image-2.5-sunburst', value::jsonb -> 'gpt-image-2'
))::text WHERE key = 'ModelPrice';
COMMIT;
