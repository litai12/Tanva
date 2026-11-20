-- Route Tanva's ordinary GPT text traffic through new-api, while keeping the
-- tc-api credential owned by the gateway. The existing xiaot-agent channel is
-- the credential source only; ordinary GPT requests use a separate channel and
-- must never be sent through the xiaot-agent facade models.

\set ON_ERROR_STOP on

BEGIN;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM channels
    WHERE name = 'xiaot-agent'
      AND type = 1
      AND status = 1
      AND COALESCE(key, '') <> ''
  ) THEN
    RAISE EXCEPTION 'enabled xiaot-agent channel with tc-api key is required';
  END IF;
END
$block$;

INSERT INTO models (
  model_name,
  description,
  vendor_id,
  status,
  sync_official,
  created_time,
  updated_time,
  name_rule
)
SELECT
  'gpt-5.6',
  'GPT-5.6 via tc-api managed by new-api',
  source.vendor_id,
  1,
  0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
FROM models AS source
WHERE source.model_name = 'gpt-5.4'
  AND source.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM models AS existing
    WHERE existing.model_name = 'gpt-5.6'
      AND existing.deleted_at IS NULL
  )
LIMIT 1;

UPDATE models
SET status = 1,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('gpt-5.4', 'gpt-5.6')
  AND deleted_at IS NULL;

WITH credential_source AS (
  SELECT key
  FROM channels
  WHERE name = 'xiaot-agent'
    AND type = 1
    AND status = 1
    AND COALESCE(key, '') <> ''
  ORDER BY id DESC
  LIMIT 1
)
INSERT INTO channels (
  type,
  key,
  status,
  name,
  weight,
  created_time,
  test_time,
  response_time,
  base_url,
  other,
  balance,
  balance_updated_time,
  models,
  "group",
  used_quota,
  priority,
  tag
)
SELECT
  1,
  source.key,
  1,
  'tc-api-gpt',
  0,
  EXTRACT(EPOCH FROM NOW())::bigint,
  0,
  0,
  'http://host.docker.internal:8788/agents/llm',
  '',
  0,
  0,
  'gpt-5.4,gpt-5.6',
  'default',
  0,
  100,
  'tc-api-gpt'
FROM credential_source AS source
WHERE NOT EXISTS (
  SELECT 1
  FROM channels
  WHERE name = 'tc-api-gpt'
    AND type = 1
);

WITH credential_source AS (
  SELECT key
  FROM channels
  WHERE name = 'xiaot-agent'
    AND type = 1
    AND status = 1
    AND COALESCE(key, '') <> ''
  ORDER BY id DESC
  LIMIT 1
)
UPDATE channels AS target
SET key = source.key,
    status = 1,
    base_url = 'http://host.docker.internal:8788/agents/llm',
    models = 'gpt-5.4,gpt-5.6',
    "group" = 'default',
    priority = 100,
    weight = 0,
    tag = 'tc-api-gpt'
FROM credential_source AS source
WHERE target.name = 'tc-api-gpt'
  AND target.type = 1;

INSERT INTO abilities (
  "group",
  model,
  channel_id,
  enabled,
  priority,
  weight,
  tag
)
SELECT
  'default',
  model_name,
  channel.id,
  true,
  COALESCE(channel.priority, 0),
  COALESCE(channel.weight, 0),
  channel.tag
FROM channels AS channel
CROSS JOIN (VALUES ('gpt-5.4'), ('gpt-5.6')) AS models(model_name)
WHERE channel.name = 'tc-api-gpt'
  AND channel.type = 1
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    priority = EXCLUDED.priority,
    weight = EXCLUDED.weight,
    tag = EXCLUDED.tag;

UPDATE options
SET value = jsonb_set(
  COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb),
  '{gpt-5.6}',
  COALESCE(NULLIF(value, '')::jsonb -> 'gpt-5.4', '0.46875'::jsonb),
  true
)::text
WHERE key = 'ModelRatio';

UPDATE options
SET value = jsonb_set(
  COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb),
  '{gpt-5.6}',
  '8.0'::jsonb,
  true
)::text
WHERE key = 'CompletionRatio';

UPDATE options
SET value = jsonb_set(
  COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb),
  '{gpt-5.6}',
  COALESCE(NULLIF(value, '')::jsonb -> 'gpt-5.4', '0.1008'::jsonb),
  true
)::text
WHERE key = 'CacheRatio';

COMMIT;

SELECT id, name, type, status, "group", base_url, models, priority
FROM channels
WHERE name = 'tc-api-gpt' AND type = 1;

SELECT ability.model, ability.enabled, ability.priority, channel.name AS channel_name
FROM abilities AS ability
JOIN channels AS channel ON channel.id = ability.channel_id
WHERE channel.name = 'tc-api-gpt'
ORDER BY ability.model;

SELECT key,
       value::jsonb -> 'gpt-5.4' AS gpt54,
       value::jsonb -> 'gpt-5.6' AS gpt56
FROM options
WHERE key IN ('ModelRatio', 'CompletionRatio', 'CacheRatio')
ORDER BY key;
