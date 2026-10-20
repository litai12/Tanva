-- Ark chat upgrade: Pro / Lite / Turbo (user-selected replacement for Mini).
-- Official regular online inference, checked 2026-10-20:
-- https://console.volcengine.com/ark/region:cn-beijing/docs/model-list
-- https://docs.volcengine.com/docs/ark/model-pricing?lang=zh
-- CNY/M input/output/cache: Pro 6/30/1.2, Lite .8/2.7/.16,
-- Turbo 3/15/.6. Preserve the existing official x1.5 retail conversion:
-- ModelRatio = official CNY/M * .75; output/input and cache/input are ratios.
-- All three use flat context pricing, NOT the Seed 2.0 32K/128K tiers.
-- Keep exact 2.0 routes/prices for existing video-understanding nodes and logs.
-- Do not remap an old exact model ID to a different model or affect Seedance.
-- PostgreSQL production data patch; no credentials or billing records changed.
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('tanva:ark-seed-2-1'));

DO $$
BEGIN
  IF (SELECT count(*) FROM channels WHERE name='ark-doubao' AND type=45) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one ark-doubao type=45 channel';
  END IF;
END $$;

CREATE TEMP TABLE ark_seed21_models (
  model_name text PRIMARY KEY, description text, context_tokens integer
) ON COMMIT DROP;
INSERT INTO ark_seed21_models VALUES
 ('doubao-seed-2-1-pro-260915', 'Doubao Seed 2.1 Pro', 1024000),
 ('doubao-seed-2-1-lite-260915', 'Doubao Seed 2.1 Lite', 1024000),
 ('doubao-seed-2-1-turbo-260628', 'Doubao Seed 2.1 Turbo', 256000);

INSERT INTO models (
  model_name, description, tags, endpoints, kind, status, sync_official,
  created_time, updated_time, name_rule, capabilities, params_def
)
SELECT model_name, description, 'volcengine,doubao,multimodal',
 '{"openai":{"path":"/v1/chat/completions","method":"POST"},"openai-response":{"path":"/v1/responses","method":"POST"}}',
 'chat', 1, 0, extract(epoch FROM now())::bigint,
 extract(epoch FROM now())::bigint, 0, '["text","image","video"]',
 '[{"key":"max_completion_tokens","type":"integer","label":"Max completion tokens","default":4096,"max":256000}]'
FROM ark_seed21_models s
WHERE NOT EXISTS (
  SELECT 1 FROM models m WHERE m.model_name=s.model_name AND m.deleted_at IS NULL
);
-- Turbo may already be published by another channel. Add the supported endpoint
-- without overwriting its metadata or the other channel's independent pricing.
UPDATE models m
SET endpoints = (
  '{"openai":{"path":"/v1/chat/completions","method":"POST"},"openai-response":{"path":"/v1/responses","method":"POST"}}'::jsonb
  || CASE WHEN left(ltrim(coalesce(m.endpoints,'')),1)='{' THEN m.endpoints::jsonb
       ELSE '{}'::jsonb END
)::text
WHERE m.deleted_at IS NULL
  AND m.model_name IN (SELECT model_name FROM ark_seed21_models);

UPDATE channels c
SET models=(
  SELECT string_agg(model_name,',' ORDER BY model_name)
  FROM (
    SELECT DISTINCT btrim(value) AS model_name
    FROM unnest(string_to_array(coalesce(c.models,''),',')) value
    WHERE btrim(value)<>''
    UNION SELECT model_name FROM ark_seed21_models
  ) combined
)
WHERE c.name='ark-doubao' AND c.type=45;

INSERT INTO abilities ("group",model,channel_id,enabled,priority,weight,tag)
SELECT DISTINCT btrim(g), s.model_name, c.id, c.status=1,
  coalesce(c.priority,0), coalesce(c.weight,0), c.tag
FROM channels c
CROSS JOIN LATERAL unnest(string_to_array(c."group",',')) g
CROSS JOIN ark_seed21_models s
WHERE c.name='ark-doubao' AND c.type=45 AND btrim(g)<>''
ON CONFLICT ("group",model,channel_id) DO NOTHING;

-- On replay, preserve administrator changes to the new model prices/abilities.
INSERT INTO options (key,value)
SELECT key,value::jsonb::text FROM (VALUES
 ('ModelRatio','{"doubao-seed-2-1-pro-260915":4.5,"doubao-seed-2-1-lite-260915":0.6,"doubao-seed-2-1-turbo-260628":2.25}'),
 ('CompletionRatio','{"doubao-seed-2-1-pro-260915":5,"doubao-seed-2-1-lite-260915":3.375,"doubao-seed-2-1-turbo-260628":5}'),
 ('CacheRatio','{"doubao-seed-2-1-pro-260915":0.2,"doubao-seed-2-1-lite-260915":0.2,"doubao-seed-2-1-turbo-260628":0.2}'),
 ('AudioRatio','{"doubao-seed-2-1-lite-260915":15}')
) AS prices(key,value)
ON CONFLICT (key) DO UPDATE
SET value=(EXCLUDED.value::jsonb || coalesce(nullif(options.value,''),'{}')::jsonb)::text;

-- Never silently leave token pricing shadowed by a legacy fixed-price entry.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM options o, ark_seed21_models s
    WHERE o.key='ModelPrice'
      AND coalesce(nullif(o.value,''),'{}')::jsonb ? s.model_name
  ) THEN
    RAISE EXCEPTION 'Seed 2.1 has a fixed-price override; review before applying';
  END IF;
END $$;
COMMIT;
