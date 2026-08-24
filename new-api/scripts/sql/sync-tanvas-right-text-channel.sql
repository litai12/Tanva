-- Sync the Tanvas business-text Right channel without storing its secret in Git.
--
-- Required environment variable:
--   RIGHT_KEY=<key copied from the trusted 4455 `right` channel>
--
-- Example:
--   docker exec -i -e RIGHT_KEY="$RIGHT_KEY" tanva-new-api-postgres \
--     psql -U new_api -d new_api -v ON_ERROR_STOP=on \
--     < new-api/scripts/sql/sync-tanvas-right-text-channel.sql
--
-- `https://rightapi.ai/codex` intentionally has no trailing `/v1`: the type 60
-- adapter appends `/v1/chat/completions`. The dedicated `tanvas-right-*` model
-- names prevent unrelated canonical GPT traffic from being rerouted.

\getenv right_key RIGHT_KEY
\set ON_ERROR_STOP on

BEGIN;

UPDATE channels
SET type = 60,
    key = :'right_key',
    "group" = 'default',
    status = 1,
    models = 'gpt-5.6-luna,gpt-5.6-terra,tanvas-right-gpt-5.6-luna,tanvas-right-gpt-5.6-terra',
    model_mapping = '{"tanvas-right-gpt-5.6-luna":"gpt-5.6-luna","tanvas-right-gpt-5.6-terra":"gpt-5.6-terra"}',
    base_url = 'https://rightapi.ai/codex',
    priority = 19,
    weight = 1,
    tag = 'right',
    auto_ban = 0,
    setting = '{"force_format":false,"thinking_to_content":false,"proxy":"","pass_through_body_enabled":false,"system_prompt":"","system_prompt_override":false,"oauth_key_concurrency":0,"oauth_key_cooldown_seconds":0,"price_ratio":0,"codex_use_worker":false,"default_protocol":{"protocol":"rightcode"},"model_protocols":{}}'
WHERE name = 'right';

INSERT INTO channels (
  type, key, test_model, status, name, weight, created_time, base_url, models,
  "group", model_mapping, priority, auto_ban, tag, setting
)
SELECT
  60,
  :'right_key',
  '',
  1,
  'right',
  1,
  EXTRACT(EPOCH FROM NOW())::bigint,
  'https://rightapi.ai/codex',
  'gpt-5.6-luna,gpt-5.6-terra,tanvas-right-gpt-5.6-luna,tanvas-right-gpt-5.6-terra',
  'default',
  '{"tanvas-right-gpt-5.6-luna":"gpt-5.6-luna","tanvas-right-gpt-5.6-terra":"gpt-5.6-terra"}',
  19,
  0,
  'right',
  '{"force_format":false,"thinking_to_content":false,"proxy":"","pass_through_body_enabled":false,"system_prompt":"","system_prompt_override":false,"oauth_key_concurrency":0,"oauth_key_cooldown_seconds":0,"price_ratio":0,"codex_use_worker":false,"default_protocol":{"protocol":"rightcode"},"model_protocols":{}}'
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'right');

WITH target AS (
  SELECT min(id) AS channel_id FROM channels WHERE name = 'right'
), desired(model) AS (
  VALUES
    ('gpt-5.6-luna'),
    ('gpt-5.6-terra'),
    ('tanvas-right-gpt-5.6-luna'),
    ('tanvas-right-gpt-5.6-terra')
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT 'default', desired.model, target.channel_id, true, 19, 1, 'right'
FROM desired CROSS JOIN target
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = true,
    priority = 19,
    weight = 1,
    tag = 'right';

UPDATE abilities
SET enabled = false
WHERE channel_id = (SELECT min(id) FROM channels WHERE name = 'right')
  AND model NOT IN (
    'gpt-5.6-luna',
    'gpt-5.6-terra',
    'tanvas-right-gpt-5.6-luna',
    'tanvas-right-gpt-5.6-terra'
  );

INSERT INTO options (key, value)
VALUES
  ('ModelRatio', '{"gpt-5.6-luna":1.0,"gpt-5.6-terra":2.5,"tanvas-right-gpt-5.6-luna":1.0,"tanvas-right-gpt-5.6-terra":2.5}'),
  ('CompletionRatio', '{"gpt-5.6-luna":6.0,"gpt-5.6-terra":6.0,"tanvas-right-gpt-5.6-luna":6.0,"tanvas-right-gpt-5.6-terra":6.0}'),
  ('CacheRatio', '{"gpt-5.6-luna":0.0,"gpt-5.6-terra":0.0,"tanvas-right-gpt-5.6-luna":0.0,"tanvas-right-gpt-5.6-terra":0.0}'),
  ('CreateCacheRatio', '{"gpt-5.6-luna":0.1,"gpt-5.6-terra":0.1,"tanvas-right-gpt-5.6-luna":0.1,"tanvas-right-gpt-5.6-terra":0.1}')
ON CONFLICT (key) DO UPDATE
SET value = (COALESCE(options.value, '{}')::jsonb || EXCLUDED.value::jsonb)::text;

COMMIT;

SELECT id, name, type, status, base_url, models, model_mapping, priority,
       weight, tag, auto_ban, length(key) AS key_length
FROM channels
WHERE name = 'right';

SELECT "group", model, enabled, priority, weight, tag
FROM abilities
WHERE channel_id = (SELECT min(id) FROM channels WHERE name = 'right')
ORDER BY model;
