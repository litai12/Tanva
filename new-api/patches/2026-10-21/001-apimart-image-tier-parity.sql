-- PostgreSQL deployment data patch. Pair existing public ToAPIs image tiers
-- with APIMart's documented equivalent SKUs, without changing retail prices.
-- Sources (2026-10-21): docs.apimart.ai/cn/api-reference/images/
-- gpt-image-2.5-ext/generation, gpt-image-2.5/generation,
-- gemini-nano-banana-2.1/generation. Requires matching gateway code.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(20261021, 9);

CREATE TEMP TABLE apimart_image_pairs (public_model text PRIMARY KEY, upstream_model text) ON COMMIT DROP;
INSERT INTO apimart_image_pairs VALUES
 ('gpt-image-2.5-flare','gpt-image-2.5-ext'),
 ('gpt-image-2.5-sunburst','gpt-image-2.5-ext'),
 ('gpt-image-2.5-flare-vip','gpt-image-2.5-flare'),
 ('gpt-image-2.5-sunburst-vip','gpt-image-2.5-sunburst'),
 ('gemini-nano-banana-2.1','gemini-nano-banana-2.1-ext'),
 ('gemini-nano-banana-2.1-official','gemini-nano-banana-2.1');

DO $$
DECLARE ch channels%ROWTYPE;
BEGIN
 SELECT * INTO ch FROM channels WHERE id=9 FOR UPDATE;
 IF NOT FOUND OR ch.type IS DISTINCT FROM 59 OR ch.name IS DISTINCT FROM 'apimart' OR
    COALESCE(lower(regexp_replace(ch.base_url, '/+$', '')),'') NOT IN ('https://api.apimart.ai','https://api.aishuch.com') THEN
   RAISE EXCEPTION 'Expected existing APIMart channel 9';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM unnest(string_to_array(ch."group", ',')) g WHERE trim(g)<>'') THEN
   RAISE EXCEPTION 'APIMart channel groups required';
 END IF;
 IF EXISTS (SELECT 1 FROM apimart_image_pairs p WHERE NOT EXISTS (
   SELECT 1 FROM models m WHERE m.model_name=p.public_model AND m.deleted_at IS NULL AND m.kind='image'
 )) THEN RAISE EXCEPTION 'Existing public image catalog required'; END IF;
 IF EXISTS (SELECT 1 FROM apimart_image_pairs p WHERE NOT EXISTS (
   SELECT 1 FROM options o WHERE o.key='ModelPrice' AND
     jsonb_typeof(o.value::jsonb->p.public_model)='number' AND
     (o.value::jsonb->>p.public_model)::numeric>0
 )) THEN RAISE EXCEPTION 'Existing public image retail prices required'; END IF;
 IF EXISTS (SELECT 1 FROM apimart_image_pairs p WHERE
   COALESCE(NULLIF(ch.model_mapping,''),'{}')::jsonb ? p.public_model AND
   COALESCE(NULLIF(ch.model_mapping,''),'{}')::jsonb->>p.public_model IS DISTINCT FROM p.upstream_model
 ) THEN RAISE EXCEPTION 'Conflicting explicit APIMart tier mapping; preserve administrator configuration'; END IF;
END $$;

-- Append only missing entries, retaining existing order and all unrelated SKUs.
UPDATE channels c SET models=concat_ws(',',NULLIF(c.models,''),(
 SELECT string_agg(p.public_model,',' ORDER BY p.public_model)
 FROM apimart_image_pairs p WHERE NOT EXISTS (
   SELECT 1 FROM unnest(string_to_array(c.models,',')) existing WHERE trim(existing)=p.public_model
 )
)) WHERE c.id=9 AND EXISTS (
 SELECT 1 FROM apimart_image_pairs p WHERE NOT EXISTS (
   SELECT 1 FROM unnest(string_to_array(c.models,',')) existing WHERE trim(existing)=p.public_model
 ));

UPDATE channels c SET model_mapping=(COALESCE(NULLIF(c.model_mapping,''),'{}')::jsonb ||
 (SELECT jsonb_object_agg(public_model,upstream_model) FROM apimart_image_pairs))::text
WHERE c.id=9 AND NOT (COALESCE(NULLIF(c.model_mapping,''),'{}')::jsonb @>
 (SELECT jsonb_object_agg(public_model,upstream_model) FROM apimart_image_pairs));

INSERT INTO abilities ("group",model,channel_id,enabled,priority,weight,tag)
SELECT DISTINCT trim(g.grp),p.public_model,c.id,
 c.status=1 AND EXISTS (SELECT 1 FROM models m WHERE m.model_name=p.public_model AND m.deleted_at IS NULL AND m.status=1),
 COALESCE(c.priority,0),COALESCE(c.weight,0),c.tag
FROM channels c CROSS JOIN apimart_image_pairs p
CROSS JOIN unnest(string_to_array(c."group",',')) g(grp)
WHERE c.id=9 AND trim(g.grp)<>''
ON CONFLICT ("group",model,channel_id) DO NOTHING;
COMMIT;
