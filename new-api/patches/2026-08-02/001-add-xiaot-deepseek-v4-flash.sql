-- Add DeepSeek V4 Flash to the dedicated XiaoT facade channel while keeping
-- all currently supported GPT XiaoT variants available.
--
-- Client-facing model names intentionally use the xiaot-agent-* namespace so
-- Tanva requests cannot be distributed to ordinary GPT/DeepSeek channels and
-- bypass the TapCanvas XiaoT facade. The channel translates only at its final
-- upstream hop:
--   xiaot-agent-gpt-5-4             -> gpt-5.4
--   xiaot-agent-gpt-5-5             -> gpt-5.5
--   xiaot-agent-gpt-5-6-luna        -> gpt-5.6-luna
--   xiaot-agent-deepseek-v4-flash   -> deepseek-v4-flash
--
-- Gateway ModelPrice remains a nominal per-call bookkeeping value. Tanva user
-- chat billing is fixed at 2 credits per completed XiaoT turn; generation and
-- analysis host tools are billed independently by their own APIs.
--
-- PostgreSQL, data-only, idempotent. Existing XiaoT credentials, base URL and
-- channel tuning are preserved.

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
    'xiaot-agent-gpt-5-4',
    'xiaot-agent-gpt-5-5',
    'xiaot-agent-gpt-5-6-luna',
    'xiaot-agent-deepseek-v4-flash'
  ),
  model_mapping = (
    COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb)
    - 'xiaot-agent-claude-4-8'
    - 'xiaot-agent-claude-4-7'
    - 'xiaot-agent-claude-4-6'
    - 'xiaot-agent-gpt-5-6-sol'
    - 'xiaot-agent-gpt-5-6-terra'
    || '{
      "xiaot-agent-gpt-5-4":"gpt-5.4",
      "xiaot-agent-gpt-5-5":"gpt-5.5",
      "xiaot-agent-gpt-5-6-luna":"gpt-5.6-luna",
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
    'xiaot-agent-gpt-5-6-sol',
    'xiaot-agent-gpt-5-6-terra'
  );

WITH xiaot_models(model_name) AS (VALUES
  ('xiaot-agent'),
  ('xiaot-agent-gpt-5-4'),
  ('xiaot-agent-gpt-5-5'),
  ('xiaot-agent-gpt-5-6-luna'),
  ('xiaot-agent-deepseek-v4-flash')
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT
  'default',
  xiaot_models.model_name,
  channel.id,
  (channel.status = 1),
  COALESCE(channel.priority, 0),
  COALESCE(channel.weight, 0),
  channel.tag
FROM channels AS channel
CROSS JOIN xiaot_models
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
    "xiaot-agent-gpt-5-4":0.01,
    "xiaot-agent-gpt-5-5":0.01,
    "xiaot-agent-gpt-5-6-luna":0.01,
    "xiaot-agent-deepseek-v4-flash":0.01
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (
  COALESCE(NULLIF(options.value, ''), '{}')::jsonb
  || EXCLUDED.value::jsonb
)::text;

COMMIT;

\echo '----- XiaoT facade channel -----'
SELECT id, name, type, status, models, model_mapping
FROM channels
WHERE name = 'xiaot-agent'
  AND type = 1;

\echo '----- XiaoT facade abilities -----'
SELECT ability.model, ability.enabled
FROM abilities AS ability
JOIN channels AS channel ON channel.id = ability.channel_id
WHERE channel.name = 'xiaot-agent'
  AND channel.type = 1
ORDER BY ability.model;

\echo '----- XiaoT facade nominal ModelPrice -----'
SELECT
  value::jsonb -> 'xiaot-agent-gpt-5-4' AS xiaot_54,
  value::jsonb -> 'xiaot-agent-gpt-5-5' AS xiaot_55,
  value::jsonb -> 'xiaot-agent-gpt-5-6-luna' AS xiaot_56_luna,
  value::jsonb -> 'xiaot-agent-deepseek-v4-flash' AS xiaot_deepseek_v4_flash
FROM options
WHERE key = 'ModelPrice';
