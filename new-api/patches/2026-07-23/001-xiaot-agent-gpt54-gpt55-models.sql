-- 001-xiaot-agent-gpt54-gpt55-models.sql
-- Purpose: 小T门面仅暴露 GPT-5.4 / GPT-5.5，并默认由 Tanva 选择 GPT-5.4。
-- Scope: PostgreSQL only, data-only, idempotent. This file is not auto-applied locally.

\set ON_ERROR_STOP on

BEGIN;

UPDATE channels
SET models = 'xiaot-agent,xiaot-agent-gpt-5-4,xiaot-agent-gpt-5-5',
    model_mapping = (
      COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb)
      - 'xiaot-agent-claude-4-8'
      - 'xiaot-agent-claude-4-7'
      - 'xiaot-agent-claude-4-6'
      - 'xiaot-agent-gpt-5-6-sol'
      - 'xiaot-agent-gpt-5-6-terra'
      - 'xiaot-agent-gpt-5-6-luna'
      || '{
        "xiaot-agent-gpt-5-4": "gpt-5.4",
        "xiaot-agent-gpt-5-5": "gpt-5.5"
      }'::jsonb
    )::text
WHERE name = 'xiaot-agent' AND type = 1;

DELETE FROM abilities AS a
USING channels AS c
WHERE a.channel_id = c.id
  AND c.name = 'xiaot-agent'
  AND c.type = 1
  AND a.model IN (
    'xiaot-agent-claude-4-8',
    'xiaot-agent-claude-4-7',
    'xiaot-agent-claude-4-6',
    'xiaot-agent-gpt-5-6-sol',
    'xiaot-agent-gpt-5-6-terra',
    'xiaot-agent-gpt-5-6-luna'
  );

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT 'default', m.model_name, c.id,
       (c.status = 1),
       COALESCE(c.priority, 0),
       COALESCE(c.weight, 0),
       c.tag
FROM channels AS c
CROSS JOIN (VALUES
  ('xiaot-agent-gpt-5-4'),
  ('xiaot-agent-gpt-5-5')
) AS m(model_name)
WHERE c.name = 'xiaot-agent' AND c.type = 1
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = EXCLUDED.enabled,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{
    "xiaot-agent-gpt-5-4": 0.01,
    "xiaot-agent-gpt-5-5": 0.01
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (COALESCE(NULLIF(options.value, '')::jsonb, '{}'::jsonb) || EXCLUDED.value::jsonb)::text;

SELECT id, name, type, status, models, model_mapping
FROM channels
WHERE name = 'xiaot-agent' AND type = 1;

SELECT a.model, a.enabled
FROM abilities AS a
JOIN channels AS c ON c.id = a.channel_id
WHERE c.name = 'xiaot-agent' AND c.type = 1
ORDER BY a.model;

COMMIT;
