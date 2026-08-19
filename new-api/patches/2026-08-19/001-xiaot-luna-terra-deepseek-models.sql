-- Keep the XiaoT facade on exactly the three product-supported brains:
--   xiaot-agent-gpt-5-6-luna       -> gpt-5.6-luna
--   xiaot-agent-gpt-5-6-terra      -> gpt-5.6-terra
--   xiaot-agent-deepseek-v4-flash  -> deepseek-v4-flash
--
-- PostgreSQL, data-only and idempotent. Existing credentials, base URL,
-- channel priority and weight are preserved. Facade abilities are enabled for
-- the default, auto, vip and svip token groups. Restart new-api after applying the
-- patch so its channel cache observes the updated abilities.

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  channel_count integer;
BEGIN
  SELECT count(*)
  INTO channel_count
  FROM channels
  WHERE name = 'xiaot-agent'
    AND type = 1;

  IF channel_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one xiaot-agent type=1 channel, found %',
      channel_count;
  END IF;
END
$$;

UPDATE channels
SET
  models = concat_ws(',',
    'xiaot-agent',
    'xiaot-agent-gpt-5-6-luna',
    'xiaot-agent-gpt-5-6-terra',
    'xiaot-agent-deepseek-v4-flash'
  ),
  model_mapping = (
    COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb)
    - 'xiaot-agent-claude-4-8'
    - 'xiaot-agent-claude-4-7'
    - 'xiaot-agent-claude-4-6'
    - 'xiaot-agent-gpt-5-4'
    - 'xiaot-agent-gpt-5-5'
    - 'xiaot-agent-gpt-5-6-sol'
    || '{
      "xiaot-agent-gpt-5-6-luna":"gpt-5.6-luna",
      "xiaot-agent-gpt-5-6-terra":"gpt-5.6-terra",
      "xiaot-agent-deepseek-v4-flash":"deepseek-v4-flash"
    }'::jsonb
  )::text
WHERE name = 'xiaot-agent'
  AND type = 1;

DELETE FROM abilities AS ability
USING channels AS channel
WHERE ability.channel_id = channel.id
  AND channel.name = 'xiaot-agent'
  AND channel.type = 1
  AND ability.model IN (
    'xiaot-agent-claude-4-8',
    'xiaot-agent-claude-4-7',
    'xiaot-agent-claude-4-6',
    'xiaot-agent-gpt-5-4',
    'xiaot-agent-gpt-5-5',
    'xiaot-agent-gpt-5-6-sol'
  );

WITH xiaot_models(model_name) AS (VALUES
  ('xiaot-agent'),
  ('xiaot-agent-gpt-5-6-luna'),
  ('xiaot-agent-gpt-5-6-terra'),
  ('xiaot-agent-deepseek-v4-flash')
), target_groups(group_name) AS (VALUES
  ('default'),
  ('auto'),
  ('vip'),
  ('svip')
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT
  target_groups.group_name,
  xiaot_models.model_name,
  channel.id,
  (channel.status = 1),
  COALESCE(channel.priority, 0),
  COALESCE(channel.weight, 0),
  channel.tag
FROM channels AS channel
CROSS JOIN xiaot_models
CROSS JOIN target_groups
WHERE channel.name = 'xiaot-agent'
  AND channel.type = 1
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET
  enabled = EXCLUDED.enabled,
  priority = EXCLUDED.priority,
  weight = EXCLUDED.weight,
  tag = EXCLUDED.tag;

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{
    "xiaot-agent":0.01,
    "xiaot-agent-gpt-5-6-luna":0.01,
    "xiaot-agent-gpt-5-6-terra":0.01,
    "xiaot-agent-deepseek-v4-flash":0.01
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, ''), '{}')::jsonb
  - 'xiaot-agent-gpt-5-4'
  - 'xiaot-agent-gpt-5-5'
  - 'xiaot-agent-gpt-5-6-sol'
  || EXCLUDED.value::jsonb
)::text;

COMMIT;

\echo '----- XiaoT three-brain facade channel -----'
SELECT id, name, type, status, models, model_mapping
FROM channels
WHERE name = 'xiaot-agent'
  AND type = 1;

\echo '----- XiaoT facade abilities -----'
SELECT ability."group", ability.model, ability.enabled
FROM abilities AS ability
JOIN channels AS channel ON channel.id = ability.channel_id
WHERE channel.name = 'xiaot-agent'
  AND channel.type = 1
ORDER BY ability.model, ability."group";

\echo '----- XiaoT facade nominal ModelPrice -----'
SELECT
  value::jsonb -> 'xiaot-agent-gpt-5-6-luna' AS xiaot_luna,
  value::jsonb -> 'xiaot-agent-gpt-5-6-terra' AS xiaot_terra,
  value::jsonb -> 'xiaot-agent-deepseek-v4-flash' AS xiaot_deepseek
FROM options
WHERE key = 'ModelPrice';
