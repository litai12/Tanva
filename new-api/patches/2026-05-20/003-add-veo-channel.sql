-- 003-add-veo-channel.sql
-- Purpose: add VEO video-generation models to the existing '147ai' channel
--          and clean up the old '147ai-veo' channel if it was previously created.
--
-- VEO models use POST /v1/chat/completions (OpenAI chat format) — handled by the
-- magic666/onefourseven adaptor's default branch.
--
-- All 147AI models (image + video) share one channel and one API key:
--   channel: 147ai  (type 63, ChannelType147AI)
--   base_url updated to https://api1.147ai.com (unified endpoint for all models)
--   key: PLACEHOLDER_147AI_KEY (same credential as patch 001)
--
-- Models added here:
--   veo3-fast          (video, chat-completions format)
--   veo3-pro           (video, chat-completions format)
--   veo3-pro-frames    (video, chat-completions format, supports reference image)
--
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Seed VEO models.
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
       '147AI VEO model — ' || f.model_name,
       NULL, NULL, v.id, NULL, f.kind, 1, 0,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0
FROM base_models AS f
CROSS JOIN (SELECT id FROM vendors WHERE name = '147AI' AND deleted_at IS NULL LIMIT 1) AS v
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
CROSS JOIN (SELECT id FROM vendors WHERE name = '147AI' AND deleted_at IS NULL LIMIT 1) AS v
WHERE target.model_name = f.model_name
  AND target.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 2: Update the existing '147ai' channel.
--   - Switch base_url to api1.147ai.com (unified endpoint for image + video)
--   - Append VEO models to the models list
-- ---------------------------------------------------------------------------

UPDATE channels
SET base_url     = 'https://api1.147ai.com',
    models       = 'gemini-3-pro-image-preview,gemini-3.1-flash-image-preview,gpt-image-2,'
                || 'gemini-3-pro-image-preview-147ai,gemini-3.1-flash-image-preview-147ai,gpt-image-2-147ai,'
                || 'veo3-fast,veo3-pro,veo3-pro-frames',
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = '147ai'
  AND type = 63
  AND "group" = 'default'
  AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 3: Register VEO abilities under the '147ai' channel.
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
SELECT am.ability_group, am.model, c.id, true, 10, 100, '147ai'
FROM ability_matrix AS am
JOIN channels AS c
  ON c.name = '147ai' AND c.type = 63 AND c."group" = 'default' AND c.deleted_at IS NULL
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = EXCLUDED.enabled,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

-- ---------------------------------------------------------------------------
-- Step 4: Soft-delete the old '147ai-veo' channel (now redundant).
--   Also clean up its abilities so routing doesn't pick up the deleted channel.
-- ---------------------------------------------------------------------------

UPDATE abilities
SET enabled = false
WHERE channel_id IN (
  SELECT id FROM channels WHERE name = '147ai-veo' AND deleted_at IS NULL
);

UPDATE channels
SET deleted_at   = EXTRACT(EPOCH FROM NOW())::bigint,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE name = '147ai-veo'
  AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 5: Seed ModelPrice for VEO models.
-- ---------------------------------------------------------------------------

INSERT INTO options (key, value) VALUES (
  'ModelPrice',
  $json${"veo3-fast": 2, "veo3-pro": 5, "veo3-pro-frames": 5}$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (EXCLUDED.value::jsonb || options.value::jsonb)::text;

COMMIT;
