-- PostgreSQL, idempotent. Register GPT-Image-2.6 ordinary tiers.
-- Public SKUs gpt-image-2.6-flare / gpt-image-2.6-sunburst mirror the 2.5
-- ordinary tiers: same catalog params, same ModelPrice (copied per variant),
-- same 1/1.5/2 resolution multipliers.
--   ToAPIs (type 59, toapis.*): native model names, no mapping.
--   APIMart channel 9: model_mapping -> gpt-image-2.6-ext; the gateway adds
--   version=flare/sunburst from the public SKU (same as 2.5-ext).
-- Sources (2026-11-08): docs.toapis.com/docs/cn/api-reference/images/
-- gpt-image-2.6/generation, docs.apimart.ai/cn/api-reference/images/
-- gpt-image-2.6-ext/generation. Requires matching gateway code.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(20261108, 1);

CREATE TEMP TABLE gpt26_models (model_name text PRIMARY KEY, source_model text, apimart_model text) ON COMMIT DROP;
INSERT INTO gpt26_models VALUES
 ('gpt-image-2.6-flare', 'gpt-image-2.5-flare', 'gpt-image-2.6-ext'),
 ('gpt-image-2.6-sunburst', 'gpt-image-2.5-sunburst', 'gpt-image-2.6-ext');

DO $$
DECLARE ch channels%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM gpt26_models v WHERE NOT EXISTS (
    SELECT 1 FROM models m WHERE m.model_name = v.source_model AND m.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'gpt-image-2.5 flare/sunburst catalog rows are required';
  END IF;
  IF EXISTS (SELECT 1 FROM gpt26_models v WHERE NOT EXISTS (
    SELECT 1 FROM options o WHERE o.key = 'ModelPrice' AND
      jsonb_typeof(o.value::jsonb -> v.source_model) = 'number' AND
      (o.value::jsonb ->> v.source_model)::numeric > 0)) THEN
    RAISE EXCEPTION 'gpt-image-2.5 flare/sunburst ModelPrice is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM channels WHERE type = 59 AND
    lower(regexp_replace(base_url, '/+$', '')) IN ('https://toapis.com', 'https://toapis.xyz', 'https://toapis.cn')) THEN
    RAISE EXCEPTION 'An existing ToAPIs channel is required';
  END IF;
  SELECT * INTO ch FROM channels WHERE id = 9 FOR UPDATE;
  IF NOT FOUND OR ch.type IS DISTINCT FROM 59 OR ch.name IS DISTINCT FROM 'apimart' OR
     COALESCE(lower(regexp_replace(ch.base_url, '/+$', '')), '') NOT IN ('https://api.apimart.ai', 'https://api.aishuch.com') THEN
    RAISE EXCEPTION 'Expected existing APIMart channel 9';
  END IF;
  IF EXISTS (SELECT 1 FROM gpt26_models v WHERE
    COALESCE(NULLIF(ch.model_mapping, ''), '{}')::jsonb ? v.model_name AND
    COALESCE(NULLIF(ch.model_mapping, ''), '{}')::jsonb ->> v.model_name IS DISTINCT FROM v.apimart_model) THEN
    RAISE EXCEPTION 'Conflicting explicit APIMart 2.6 mapping; preserve administrator configuration';
  END IF;
END $$;

-- Catalog: clone each 2.5 ordinary row's params/capabilities.
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule, capabilities, params_def
)
SELECT v.model_name, v.model_name, m.icon, m.tags,
  m.vendor_id, m.endpoints, 'image', 1, 0,
  EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint,
  m.name_rule, m.capabilities, m.params_def
FROM models m JOIN gpt26_models v ON m.model_name = v.source_model
WHERE m.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM models e WHERE e.model_name = v.model_name AND e.deleted_at IS NULL);

-- ToAPIs channels: append native names, keep existing order.
UPDATE channels c SET models = concat_ws(',', NULLIF(c.models, ''), (
  SELECT string_agg(v.model_name, ',' ORDER BY v.model_name) FROM gpt26_models v
  WHERE NOT EXISTS (SELECT 1 FROM unnest(string_to_array(c.models, ',')) e WHERE trim(e) = v.model_name)
))
WHERE c.type = 59 AND lower(regexp_replace(c.base_url, '/+$', ''))
  IN ('https://toapis.com', 'https://toapis.xyz', 'https://toapis.cn')
  AND EXISTS (SELECT 1 FROM gpt26_models v WHERE NOT EXISTS (
    SELECT 1 FROM unnest(string_to_array(c.models, ',')) e WHERE trim(e) = v.model_name));

-- APIMart channel 9: append names and the one-hop Ext mapping.
UPDATE channels c SET models = concat_ws(',', NULLIF(c.models, ''), (
  SELECT string_agg(v.model_name, ',' ORDER BY v.model_name) FROM gpt26_models v
  WHERE NOT EXISTS (SELECT 1 FROM unnest(string_to_array(c.models, ',')) e WHERE trim(e) = v.model_name)
))
WHERE c.id = 9 AND EXISTS (SELECT 1 FROM gpt26_models v WHERE NOT EXISTS (
  SELECT 1 FROM unnest(string_to_array(c.models, ',')) e WHERE trim(e) = v.model_name));

UPDATE channels c SET model_mapping = (COALESCE(NULLIF(c.model_mapping, ''), '{}')::jsonb ||
  (SELECT jsonb_object_agg(model_name, apimart_model) FROM gpt26_models))::text
WHERE c.id = 9 AND NOT (COALESCE(NULLIF(c.model_mapping, ''), '{}')::jsonb @>
  (SELECT jsonb_object_agg(model_name, apimart_model) FROM gpt26_models));

-- Abilities for every group of the target channels. Existing rows untouched.
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT DISTINCT trim(g.grp), v.model_name, c.id, c.status = 1,
  COALESCE(c.priority, 0), COALESCE(c.weight, 0),
  CASE WHEN c.id = 9 THEN c.tag ELSE COALESCE(NULLIF(c.tag, ''), 'toapis') END
FROM channels c CROSS JOIN unnest(string_to_array(c."group", ',')) g(grp)
CROSS JOIN gpt26_models v
WHERE trim(g.grp) <> '' AND (c.id = 9 OR (c.type = 59 AND lower(regexp_replace(c.base_url, '/+$', ''))
  IN ('https://toapis.com', 'https://toapis.xyz', 'https://toapis.cn')))
ON CONFLICT ("group", model, channel_id) DO NOTHING;

-- Retail price: copy the matching 2.5 variant; never overwrite an explicit 2.6 price.
UPDATE options o SET value = (o.value::jsonb || (
  SELECT jsonb_object_agg(v.model_name, o.value::jsonb -> v.source_model)
  FROM gpt26_models v WHERE NOT (o.value::jsonb ? v.model_name)
))::text
WHERE o.key = 'ModelPrice' AND EXISTS (
  SELECT 1 FROM gpt26_models v WHERE NOT (o.value::jsonb ? v.model_name));
COMMIT;
