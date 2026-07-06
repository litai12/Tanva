-- Repair VolcEngine Ark DeepSeek v4 model channel and token pricing.
--
-- Why this exists:
-- 2026-06-09/001-add-ark-deepseek-models.sql may already be recorded as applied
-- on a server where its data did not land in the active new-api database. This
-- patch is intentionally idempotent and uses a new filename so production patch
-- runners apply it once.
--
-- DeepSeek v4 is a token-billed text model. Configure ModelRatio and
-- CompletionRatio, not ModelPrice, otherwise relay billing becomes fixed-price.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT n.model_name, 'VolcEngine Ark DeepSeek v4 model ' || n.model_name, NULL, NULL,
       0, NULL, '', 1, 0,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM (VALUES
  ('deepseek-v4-flash-260425'),
  ('deepseek-v4-pro-260425')
) AS n(model_name)
WHERE NOT EXISTS (
  SELECT 1 FROM models m WHERE m.model_name = n.model_name AND m.deleted_at IS NULL
);

UPDATE models
SET status = 1,
    kind = '',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE deleted_at IS NULL
  AND model_name IN ('deepseek-v4-flash-260425', 'deepseek-v4-pro-260425');

INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 45, 'ark-deepseek', 'default',
  'deepseek-v4-flash-260425,deepseek-v4-pro-260425',
  NULL, 1, 'https://ark.cn-beijing.volces.com', 'PLACEHOLDER_ARK_API_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 10, 100, 'ark-deepseek', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'ark-deepseek' AND type = 45);

UPDATE channels
SET
  "group" = 'default',
  models = 'deepseek-v4-flash-260425,deepseek-v4-pro-260425',
  base_url = 'https://ark.cn-beijing.volces.com',
  status = 1,
  tag = 'ark-deepseek'
WHERE name = 'ark-deepseek' AND type = 45;

WITH deepseek_models(model_name) AS (VALUES
  ('deepseek-v4-flash-260425'),
  ('deepseek-v4-pro-260425')
),
ability_matrix AS (
  SELECT g.grp, dm.model_name
  FROM deepseek_models AS dm
  CROSS JOIN (VALUES ('default'), ('auto')) AS g(grp)
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT am.grp, am.model_name, c.id, true, 10, 100, 'ark-deepseek'
FROM ability_matrix AS am
JOIN channels AS c
  ON c.name = 'ark-deepseek'
 AND c.type = 45
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = EXCLUDED.enabled,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

INSERT INTO options (key, value)
VALUES (
  'ModelRatio',
  '{
    "deepseek-v4-flash-260425": 0.684931506849315,
    "deepseek-v4-pro-260425": 0.821917808219178
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (
  EXCLUDED.value::jsonb || COALESCE(NULLIF(options.value, '')::jsonb, '{}'::jsonb)
)::text;

INSERT INTO options (key, value)
VALUES (
  'CompletionRatio',
  '{
    "deepseek-v4-flash-260425": 2,
    "deepseek-v4-pro-260425": 2
  }'
)
ON CONFLICT (key) DO UPDATE
SET value = (
  EXCLUDED.value::jsonb || COALESCE(NULLIF(options.value, '')::jsonb, '{}'::jsonb)
)::text;

\echo '----- Ark DeepSeek channel -----'
SELECT id, name, type, "group", models, status, base_url
FROM channels
WHERE name = 'ark-deepseek' AND type = 45;

\echo '----- Ark DeepSeek models / abilities -----'
SELECT model_name, kind, status
FROM models
WHERE model_name IN ('deepseek-v4-flash-260425', 'deepseek-v4-pro-260425')
ORDER BY model_name;

SELECT a."group", a.model, a.channel_id, a.enabled, a.priority, a.weight, a.tag
FROM abilities a
JOIN channels c ON c.id = a.channel_id
WHERE c.name = 'ark-deepseek'
  AND c.type = 45
  AND a.model IN ('deepseek-v4-flash-260425', 'deepseek-v4-pro-260425')
ORDER BY a."group", a.model;

\echo '----- Ark DeepSeek ModelRatio / CompletionRatio -----'
SELECT
  (SELECT value::jsonb -> 'deepseek-v4-flash-260425' FROM options WHERE key = 'ModelRatio') AS flash_ratio,
  (SELECT value::jsonb -> 'deepseek-v4-pro-260425' FROM options WHERE key = 'ModelRatio') AS pro_ratio,
  (SELECT value::jsonb -> 'deepseek-v4-flash-260425' FROM options WHERE key = 'CompletionRatio') AS flash_completion_ratio,
  (SELECT value::jsonb -> 'deepseek-v4-pro-260425' FROM options WHERE key = 'CompletionRatio') AS pro_completion_ratio;

COMMIT;
