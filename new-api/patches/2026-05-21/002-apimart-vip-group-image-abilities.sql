-- 002-apimart-vip-group-image-abilities.sql
-- Purpose: add 'vip' group abilities for all apimart image/video models so
--          that requests made with NEW_API_KEY_VIP can be routed through the
--          apimart channel (type 59).
--
-- Background: The NEW_API_KEY_VIP token belongs to a 'vip' group user in
-- new-api. The abilities table only had entries for 'default' and 'auto'
-- groups (seeded in 008-add-apimart-channel.sql). When the VIP key is used
-- (stable route or vendorKey='new_api'), new-api looks up the model in the
-- 'vip' group and finds nothing → 供应商不可用.
--
-- This patch mirrors every image/video model + alias that already exists in
-- the 'default' group for apimart into the 'vip' group.
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

WITH image_video_models(model_name) AS (VALUES
  -- image models (real id)
  ('gpt-image-2'),
  ('gemini-2.5-flash-image-preview'),
  ('gemini-3-pro-image-preview'),
  ('gemini-3.1-flash-image-preview'),
  -- image models (apimart alias)
  ('gpt-image-2-apimart'),
  ('gemini-2.5-flash-image-preview-apimart'),
  ('gemini-3-pro-image-preview-apimart'),
  ('gemini-3.1-flash-image-preview-apimart'),
  -- video models (real id)
  ('veo3.1-fast'),
  ('kling-v3'),
  ('doubao-seedance-2.0'),
  ('doubao-seedance-2.0-fast'),
  -- video models (apimart alias)
  ('veo3.1-fast-apimart'),
  ('kling-v3-apimart'),
  ('doubao-seedance-2.0-apimart'),
  ('doubao-seedance-2.0-fast-apimart')
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT
  'vip',
  m.model_name,
  c.id,
  true,
  0,
  0,
  'apimart'
FROM image_video_models AS m
JOIN channels AS c
  ON c.name = 'apimart'
 AND c.type = 59
 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled  = EXCLUDED.enabled,
    priority = EXCLUDED.priority,
    weight   = EXCLUDED.weight,
    tag      = EXCLUDED.tag;

-- Verify
\echo ''
\echo '----- APIMart vip-group image/video abilities -----'
SELECT a."group", a.model, a.enabled
FROM abilities AS a
JOIN channels AS c ON c.id = a.channel_id
WHERE c.name = 'apimart'
  AND c.type = 59
  AND a."group" = 'vip'
ORDER BY a.model;

COMMIT;
