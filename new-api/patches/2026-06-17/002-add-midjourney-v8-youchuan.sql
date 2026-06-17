-- 002-add-midjourney-v8-youchuan.sql
-- Purpose: add Midjourney V8 to the managed Youchuan Midjourney channel.
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- Keep V8 priced like the existing Midjourney V7/Niji managed calls.
UPDATE options
SET value = (
  COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
  || '{"midjourney-v8": 0.5}'::jsonb
)::text
WHERE key = 'ModelPrice';

-- Add the model to managed Youchuan channel membership without disturbing keys/status.
UPDATE channels
SET models = CASE
  WHEN models IS NULL OR models = '' THEN 'midjourney-v8'
  WHEN models LIKE '%midjourney-v8%' THEN models
  ELSE models || ',midjourney-v8'
END
WHERE name = 'youchuan' AND type = 64;

-- Route V8 to the same managed Youchuan channels/groups as V7.
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT a."group", 'midjourney-v8', a.channel_id, a.enabled, a.priority, a.weight, a.tag
FROM abilities AS a
WHERE a.model = 'midjourney-v7'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = EXCLUDED.enabled,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

\echo '----- midjourney-v8 ModelPrice -----'
SELECT value::jsonb ->> 'midjourney-v8' AS price
FROM options
WHERE key = 'ModelPrice';

\echo '----- youchuan managed channel contains midjourney-v8 -----'
SELECT id, name, type, status, "group", models
FROM channels
WHERE name = 'youchuan' AND type = 64;

\echo '----- midjourney-v8 abilities -----'
SELECT a."group", a.model, a.channel_id, a.enabled, c.type
FROM abilities AS a
JOIN channels AS c ON c.id = a.channel_id
WHERE a.model = 'midjourney-v8'
ORDER BY a."group", a.channel_id;

COMMIT;
