-- 001-fix-vidu-q3-channel-default.sql
-- Purpose:
--   Fix production `No available channel for model vidu-q3 under group default (distributor)`.
--
-- Scope:
--   - Ensure required video models exist and are marked as `kind='video'`
--   - Ensure `kapon-vidu` channel exists and advertises `vidu-q2,vidu-q3`
--   - Ensure `default` group abilities exist for `vidu-q2` and `vidu-q3`
--   - Ensure ModelPrice contains vidu-q2 / vidu-q3 fallback pricing
--
-- Notes:
--   - PostgreSQL only
--   - Idempotent / safe to re-run
--   - Reuses the existing `kapon` (type=59) key when present
--   - After applying, restart new-api or reload channels/abilities if memory cache is enabled

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT n.model_name, 'Tanva video model ' || n.model_name, NULL, NULL,
       (SELECT vendor_id FROM models WHERE model_name = 'vidu-q3' AND deleted_at IS NULL LIMIT 1),
       NULL, 'video', 1, 0,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM (VALUES ('vidu-q2'), ('vidu-q3'), ('viduq2-pro'), ('viduq3-pro')) AS n(model_name)
WHERE NOT EXISTS (
  SELECT 1 FROM models m WHERE m.model_name = n.model_name AND m.deleted_at IS NULL
);

UPDATE models
SET kind = 'video',
    status = 1,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE deleted_at IS NULL
  AND model_name IN ('vidu-q2', 'vidu-q3', 'viduq2-pro', 'viduq3-pro');

INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override
)
SELECT 'kapon-vidu', 52, 'default',
  'vidu-q2,vidu-q3',
  '{"vidu-q2":"viduq2-pro","vidu-q3":"viduq3-pro"}',
  1, 'https://models.kapon.cloud/vidu',
  (SELECT key FROM channels WHERE name = 'kapon' AND type = 59 LIMIT 1),
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 1200, 0, 'kapon-vidu', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'kapon-vidu' AND type = 52);

UPDATE channels AS c
SET "group" = CASE
      WHEN c."group" IS NULL OR btrim(c."group") = '' THEN 'default'
      WHEN c."group" LIKE '%default%' THEN c."group"
      ELSE c."group" || ',default'
    END,
    models = 'vidu-q2,vidu-q3',
    model_mapping = '{"vidu-q2":"viduq2-pro","vidu-q3":"viduq3-pro"}',
    status = 1,
    base_url = 'https://models.kapon.cloud/vidu',
    key = COALESCE(
      NULLIF(NULLIF(c.key, ''), 'PLACEHOLDER_KAPON_KEY'),
      (SELECT key FROM channels WHERE name = 'kapon' AND type = 59 LIMIT 1),
      c.key
    )
WHERE c.name = 'kapon-vidu' AND c.type = 52;

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT trim(g.grp), m.model, c.id, true, 1200, COALESCE(c.weight, 0), c.tag
FROM channels c
CROSS JOIN unnest(string_to_array(c."group", ',')) AS g(grp)
CROSS JOIN (VALUES ('vidu-q2'), ('vidu-q3')) AS m(model)
WHERE c.name = 'kapon-vidu'
  AND c.type = 52
  AND trim(g.grp) <> ''
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    priority = EXCLUDED.priority;

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT trim(g.grp), m.model, c.id, true,
       COALESCE(c.priority, 0), COALESCE(c.weight, 0), c.tag
FROM channels AS c
CROSS JOIN unnest(string_to_array(c."group", ',')) AS g(grp)
CROSS JOIN (VALUES ('vidu-q2'), ('vidu-q3')) AS m(model)
WHERE c.name = 'apimart'
  AND c.type = 59
  AND trim(g.grp) <> ''
  AND c.models LIKE '%' || m.model || '%'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled;

INSERT INTO options (key, value) VALUES (
  'ModelPrice', '{"vidu-q2": 6, "vidu-q3": 6, "viduq2-pro": 6, "viduq3-pro": 6}'
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

COMMIT;
