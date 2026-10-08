-- PostgreSQL data-only scope patch; run after 001-add-lluban-chat-channel.sql.
-- Other channels retain media, keys, mappings, prices, counters and history.
-- Remove chat from channels.models as well as abilities so an ordinary channel
-- save/rebuild cannot recreate those routes. Pure chat channels become disabled.
-- Explicit model kinds take precedence over legacy tags/names. An OpenAI endpoint
-- is not evidence of chat: image/video/audio providers also use that protocol.
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('tanva:lluban-chat-channel'));

-- The runner invokes this same preflight with lluban_scope_check_only set before
-- deciding to defer. Direct/manual execution has the same atomic safety check.
DO $preflight$
DECLARE
  c channels%ROWTYPE;
  cfg jsonb;
  prices jsonb;
  multiplier jsonb;
  names text[];
  groups text[];
  model_name_value text;
  group_value text;
BEGIN
  IF (SELECT count(*) FROM channels WHERE name='lluban-chat') <> 1 THEN
    RAISE EXCEPTION 'Lluban chat must be configured before restricting other chat routes';
  END IF;
  SELECT * INTO STRICT c FROM channels WHERE name='lluban-chat' FOR UPDATE;
  IF c.type IS DISTINCT FROM 1 OR c.status IS DISTINCT FROM 1
      OR c.base_url IS DISTINCT FROM 'https://tt-api.lluban.com'
      OR length(btrim(COALESCE(c.key,'')))=0 THEN
    RAISE EXCEPTION 'Lluban chat channel is not enabled and configured';
  END IF;
  cfg := COALESCE(NULLIF(c.setting,''),'{}')::jsonb;
  -- Compatibility for the original 001 contract and its single-multiplier successor.
  prices := COALESCE(cfg->'text_base_per_million_cny',cfg->'text_cost_per_million_cny');
  multiplier := COALESCE(cfg->'text_price_multiplier',cfg->'text_sale_multiplier');
  IF jsonb_typeof(prices) IS DISTINCT FROM 'object'
      OR jsonb_typeof(multiplier) IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Lluban chat pricing contract is missing';
  END IF;
  IF (multiplier#>>'{}')::numeric <= 0 THEN
    RAISE EXCEPTION 'Lluban chat pricing multiplier must be positive';
  END IF;
  SELECT array_agg(DISTINCT btrim(n)) INTO names
    FROM regexp_split_to_table(COALESCE(c.models,''),',') n WHERE btrim(n)<>'';
  SELECT array_agg(DISTINCT btrim(g)) INTO groups
    FROM regexp_split_to_table(COALESCE(c."group",''),',') g WHERE btrim(g)<>'';
  IF COALESCE(cardinality(names),0)=0 OR COALESCE(cardinality(groups),0)=0 THEN
    RAISE EXCEPTION 'Lluban chat needs a nonempty model list and groups';
  END IF;
  IF EXISTS (SELECT 1 FROM models WHERE model_name=ANY(names)
      AND lower(btrim(COALESCE(kind,''))) NOT IN ('','chat','text')) THEN
    RAISE EXCEPTION 'Lluban chat model has conflicting non-chat metadata';
  END IF;
  FOREACH model_name_value IN ARRAY names LOOP
    IF jsonb_typeof(prices->model_name_value->'input') IS DISTINCT FROM 'number'
        OR jsonb_typeof(prices->model_name_value->'output') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Lluban chat model has incomplete token pricing';
    END IF;
    IF (prices->model_name_value->>'input')::numeric <= 0
        OR (prices->model_name_value->>'output')::numeric <= 0 THEN
      RAISE EXCEPTION 'Lluban chat model needs positive input/output token pricing';
    END IF;
    FOREACH group_value IN ARRAY groups LOOP
      IF NOT EXISTS (SELECT 1 FROM abilities a WHERE a.channel_id=c.id
          AND a.model=model_name_value AND a."group"=group_value AND a.enabled) THEN
        RAISE EXCEPTION 'Lluban chat model has no enabled route in a configured group';
      END IF;
    END LOOP;
  END LOOP;
END $preflight$;
\if :{?lluban_scope_check_only}
ROLLBACK;
\quit
\endif

CREATE TEMP TABLE lluban_legacy_chat_names (model_name text PRIMARY KEY) ON COMMIT DROP;
-- Exact names verified as text/chat in repository data patches:
-- 2026-04-22/002+008, 04-29/003, 05-14/007, 05-21/001+006,
-- 06-10/003, 07-13/001, 07-19/001, 07-23/001, 07-24/001,
-- 07-31/002, 08-02/001, 08-19/001, 09-08/001 and 10-05/001.
-- Additional legacy DeepSeek text IDs are explicit in backend/src/ai/text-models.ts;
-- the two right aliases are in scripts/sql/sync-tanvas-right-text-channel.sql.
-- Newly imported 001 models are added below from the channel's priced catalog.
INSERT INTO lluban_legacy_chat_names VALUES
 ('gpt-5.2'),('gpt-5.2-high'),('gpt-5.2-low'),('gpt-5.2-medium'),('gpt-5.2-xhigh'),
 ('gpt-5.3-codex'),('gpt-5.3-codex-high'),('gpt-5.3-codex-low'),
 ('gpt-5.3-codex-medium'),('gpt-5.3-codex-xhigh'),
 ('gpt-5.4'),('gpt-5.4-high'),('gpt-5.4-mini'),('gpt-5.5'),
 ('gemini-2.5-pro'),('gemini-2.5-flash'),('gemini-3-flash-preview'),
 ('gemini-3.1-pro'),('gemini-3.1-pro-preview'),('gemini-3.5-flash'),
 ('deepseek-v3.2'),('deepseek-v4-flash-260425'),('deepseek-v4-pro-260425'),
 ('deepseek-v4-flash'),('deepseek-v4.1-flash'),('deepseek-flash'),
 ('deepseek-chat'),('deepseek-reasoner'),('deepseek-v4-flash-vision-exp'),('deepseek-v4-pro'),
 ('doubao-seed-2-0-pro-260215'),('doubao-seed-2-0-mini-260428'),
 ('tanvas-right-gpt-5.6-luna'),('tanvas-right-gpt-5.6-terra'),
 ('xiaot-agent'),('xiaot-agent-gpt-5-4'),('xiaot-agent-gpt-5-5'),
 ('xiaot-agent-gpt-5-6-sol'),('xiaot-agent-gpt-5-6-luna'),
 ('xiaot-agent-gpt-5-6-terra'),('xiaot-agent-deepseek-v4-flash');
INSERT INTO lluban_legacy_chat_names
SELECT priced.model_name FROM channels c CROSS JOIN LATERAL jsonb_object_keys(
  COALESCE(c.setting::jsonb->'text_base_per_million_cny',c.setting::jsonb->'text_cost_per_million_cny')) priced(model_name)
WHERE c.name='lluban-chat' ON CONFLICT DO NOTHING;

-- Match the existing metadata precedence and the five generic canonical suffixes
-- in model/canonical_model.go. Explicit media kinds/legacy media tags are retained,
-- including models using /v1/chat/completions for image generation.
CREATE OR REPLACE FUNCTION pg_temp.lluban_kind(name text) RETURNS text LANGUAGE plpgsql AS $kind$
DECLARE
  m record;
  kind_value text;
  canonical text;
BEGIN
  SELECT kind,tags INTO m FROM models
  WHERE model_name=name AND COALESCE(name_rule,0)=0
  ORDER BY deleted_at NULLS FIRST,id DESC LIMIT 1;
  IF FOUND THEN
    kind_value := lower(btrim(COALESCE(m.kind,'')));
    IF kind_value='text' THEN RETURN 'chat'; END IF;
    IF kind_value<>'' THEN RETURN kind_value; END IF;
    IF COALESCE(m.tags,'') ~* '(^|,)[[:space:]]*(tapcanvas:kind=)?(image|video|audio|embedding|3d)[[:space:]]*(,|$)' THEN
      RETURN 'media';
    END IF;
    IF COALESCE(m.tags,'') ~* '(^|,)[[:space:]]*(tapcanvas:kind=)?(chat|text)[[:space:]]*(,|$)' THEN
      RETURN 'chat';
    END IF;
  END IF;
  SELECT kind,tags INTO m FROM models WHERE deleted_at IS NULL AND name_rule IN (1,2,3)
    AND CASE name_rule WHEN 1 THEN left(name,length(model_name))=model_name
      WHEN 2 THEN strpos(name,model_name)>0 WHEN 3 THEN right(name,length(model_name))=model_name END
  ORDER BY CASE name_rule WHEN 1 THEN 1 WHEN 3 THEN 2 ELSE 3 END,id LIMIT 1;
  IF FOUND THEN
    kind_value := lower(btrim(COALESCE(m.kind,'')));
    IF kind_value='text' THEN RETURN 'chat'; END IF;
    IF kind_value<>'' THEN RETURN kind_value; END IF;
  END IF;
  canonical := regexp_replace(name,'-(apimart|suchuang|all|official|rightcodes)$','');
  IF canonical<>name THEN RETURN pg_temp.lluban_kind(canonical); END IF;
  IF EXISTS (SELECT 1 FROM lluban_legacy_chat_names WHERE model_name=name) THEN RETURN 'chat'; END IF;
  RETURN '';
END $kind$;

CREATE TEMP TABLE lluban_other_chat_routes (channel_id integer,model text,
  PRIMARY KEY(channel_id,model)) ON COMMIT DROP;
-- Resolve per-channel mappings, including multi-hop aliases; a visited-name array
-- terminates cycles. A declared media kind stops traversal and wins over mappings.
WITH RECURSIVE routes AS (
  SELECT c.id channel_id,btrim(n) model FROM channels c
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(c.models,''),',') n
    WHERE c.id<>(SELECT id FROM channels WHERE name='lluban-chat') AND btrim(n)<>''
  UNION SELECT channel_id,btrim(model) FROM abilities
    WHERE channel_id<>(SELECT id FROM channels WHERE name='lluban-chat') AND btrim(model)<>''
), walk AS (
  SELECT r.*,r.model candidate,ARRAY[r.model] seen,pg_temp.lluban_kind(r.model) kind FROM routes r
  UNION ALL
  SELECT w.channel_id,w.model,btrim(mapping.target),w.seen||btrim(mapping.target),pg_temp.lluban_kind(btrim(mapping.target))
  FROM walk w JOIN channels c ON c.id=w.channel_id
  CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(c.model_mapping,''),'{}')::jsonb->>w.candidate target) mapping
  WHERE w.kind='' AND COALESCE(btrim(mapping.target),'')<>'' AND NOT btrim(mapping.target)=ANY(w.seen)
)
INSERT INTO lluban_other_chat_routes SELECT DISTINCT channel_id,model FROM walk WHERE kind='chat';

-- Preserve the exact relative order/spelling of remaining media list entries.
WITH cleaned AS (
  SELECT c.id,COALESCE(string_agg(n,',' ORDER BY ord) FILTER (WHERE r.model IS NULL),'') models
  FROM channels c CROSS JOIN LATERAL regexp_split_to_table(COALESCE(c.models,''),',') WITH ORDINALITY parts(n,ord)
  LEFT JOIN lluban_other_chat_routes r ON r.channel_id=c.id AND r.model=btrim(n)
  WHERE EXISTS (SELECT 1 FROM lluban_other_chat_routes hit WHERE hit.channel_id=c.id)
  GROUP BY c.id
)
UPDATE channels c SET models=cleaned.models,
  status=CASE WHEN c.status=1 AND btrim(cleaned.models,', ')=''
    AND NOT EXISTS (SELECT 1 FROM abilities a WHERE a.channel_id=c.id AND a.enabled
      AND NOT EXISTS (SELECT 1 FROM lluban_other_chat_routes r WHERE r.channel_id=c.id AND r.model=btrim(a.model)))
    THEN 2 ELSE c.status END
FROM cleaned WHERE c.id=cleaned.id AND c.models IS DISTINCT FROM cleaned.models;
UPDATE abilities a SET enabled=false FROM lluban_other_chat_routes r
WHERE a.channel_id=r.channel_id AND btrim(a.model)=r.model AND a.enabled;

-- Readback contains routing names only; no credentials/settings/history are printed.
SELECT count(*) AS disabled_other_chat_routes FROM lluban_other_chat_routes;
SELECT c.name,a.model AS remaining_unclassified_route FROM abilities a JOIN channels c ON c.id=a.channel_id
WHERE c.name<>'lluban-chat' AND a.enabled AND pg_temp.lluban_kind(btrim(a.model))=''
ORDER BY c.name,a.model;
COMMIT;
