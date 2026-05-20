-- 003-add-veo-channel.sql
-- Purpose: register the legacy 147AI (api1.147ai.com) as a channel type-1
--          (OpenAI-compatible) for VEO video-generation models.
--
-- VEO models call POST /v1/chat/completions and embed the video URL in the
-- response content — handled transparently by the type-1 OpenAI adaptor.
--
-- Models:
--   veo3-fast          (video, chat-completions format)
--   veo3-pro           (video, chat-completions format)
--   veo3-pro-frames    (video, chat-completions format, supports reference image)
--
-- Key: PLACEHOLDER_147AI_LEGACY_KEY — fill in via admin console after apply.
--      (same credential as BANANA_API_KEY)
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Seed vendor.
-- ---------------------------------------------------------------------------

WITH vendor_seed(name, description) AS (
  VALUES ('147AI Legacy', '147AI legacy gateway (api1.147ai.com) — VEO video generation via chat-completions')
)
INSERT INTO vendors (name, description, icon, status, created_time, updated_time)
SELECT s.name, s.description, NULL, 1,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint
FROM vendor_seed AS s
WHERE NOT EXISTS (
  SELECT 1 FROM vendors WHERE name = s.name AND deleted_at IS NULL
);

UPDATE vendors
SET description  = '147AI legacy gateway (api1.147ai.com) — VEO video generation via chat-completions',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = '147AI Legacy' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 2: Seed models.
-- ---------------------------------------------------------------------------

WITH base_models(model_name, kind) AS (VALUES
  ('veo3-fast',       'video'),
  ('veo3-pro',        'video'),
  ('veo3-pro-frames', 'video')
)
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT f.model_name,
       '147AI Legacy VEO model — ' || f.model_name,
       NULL, NULL, v.id, NULL, f.kind, 1, 0,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM base_models AS f
CROSS JOIN (SELECT id FROM vendors WHERE name = '147AI Legacy' AND deleted_at IS NULL LIMIT 1) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM models WHERE model_name = f.model_name AND deleted_at IS NULL
);

UPDATE models AS target
SET kind         = f.kind,
    vendor_id    = v.id,
    status       = 1,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
FROM (VALUES
  ('veo3-fast',       'video'),
  ('veo3-pro',        'video'),
  ('veo3-pro-frames', 'video')
) AS f(model_name, kind)
CROSS JOIN (SELECT id FROM vendors WHERE name = '147AI Legacy' AND deleted_at IS NULL LIMIT 1) AS v
WHERE target.model_name = f.model_name
  AND target.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 3: Upsert channel (type 1 = OpenAI-compatible).
-- ---------------------------------------------------------------------------

WITH channel_seed(name, type, channel_group, models, status, base_url, key, priority, weight, tag) AS (
  VALUES (
    '147ai-veo',
    1,
    'default',
    'veo3-fast,veo3-pro,veo3-pro-frames',
    1,
    'https://api1.147ai.com',
    'PLACEHOLDER_147AI_LEGACY_KEY',
    10, 100, '147ai-veo'
  )
)
INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag,
  setting, param_override, header_override
)
SELECT s.name, s.type, s.channel_group, s.models, NULL, s.status, s.base_url, s.key,
       EXTRACT(EPOCH FROM NOW())::bigint, 0, s.priority, s.weight, s.tag,
       NULL, NULL, NULL
FROM channel_seed AS s
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = s.name AND type = s.type AND "group" = s.channel_group
);

UPDATE channels
SET models    = 'veo3-fast,veo3-pro,veo3-pro-frames',
    base_url  = 'https://api1.147ai.com'
WHERE name = '147ai-veo' AND type = 1 AND "group" = 'default';

-- ---------------------------------------------------------------------------
-- Step 4: Seed abilities.
-- ---------------------------------------------------------------------------

WITH models_list(model) AS (VALUES
  ('veo3-fast'), ('veo3-pro'), ('veo3-pro-frames')
),
ability_matrix AS (
  SELECT g.ability_group, m.model
  FROM models_list AS m
  CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT am.ability_group, am.model, c.id, true, 10, 100, '147ai-veo'
FROM ability_matrix AS am
JOIN channels AS c
  ON c.name = '147ai-veo' AND c.type = 1 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = EXCLUDED.enabled,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

-- ---------------------------------------------------------------------------
-- Step 5: Seed ModelPrice (placeholder — VEO pricing TBD).
-- ---------------------------------------------------------------------------

INSERT INTO options (key, value) VALUES (
  'ModelPrice',
  $json${"veo3-fast": 2, "veo3-pro": 5, "veo3-pro-frames": 5}$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

COMMIT;
