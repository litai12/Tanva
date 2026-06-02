-- 002-add-tencent-vod-channel.sql
-- Purpose: register the Tencent VOD AIGC video channel (ChannelType 67) so
--   new-api becomes the single decision point for vidu/kling upstream:
--   the distributor picks apimart vs tencent-vod by ability + priority (like
--   image tasks), and BOTH get a full relay log chain + billing.
--
-- The tencent-vod task adaptor (relay/channel/task/tencentvod) proxies
-- create/poll to the Tanva backend's internal endpoints
-- (POST/GET /api/ai/internal/tencent-vod/video), which reuse the existing
-- Tencent VOD AIGC service (TC3 signing + per-model request building).
--   * base_url = the backend base URL (e.g. http://backend:3000)
--   * key      = the shared internal token (backend env TENCENT_VOD_INTERNAL_TOKEN)
-- Both are PLACEHOLDER — operator fills via admin console.
--
-- Scope: Vidu + Kling only. Seedance uses asset:// (VolcEngine-native) image
-- refs that Tencent VOD cannot consume, so Seedance stays on ark-doubao-video.
--
-- Co-exists with apimart: the SAME model ids (vidu-q3 / kling-v2-6 / ...) get
-- abilities on BOTH channels; tencent-vod is seeded at priority 0 (operator
-- raises priority/weight on whichever should win). Model-mapping is NOT set on
-- this channel — the backend endpoint maps the business id to the Tencent
-- provider/version itself.
--
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: upsert the tencent-vod channel (type 67).
-- -----------------------------------------------------------------------------

INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag,
  setting, param_override, header_override
)
SELECT 'tencent-vod', 67, 'default',
  'vidu-q2,vidu-q3,kling-v2-6,kling-v3,kling-v3-omni',
  NULL, 1, 'PLACEHOLDER_BACKEND_BASE_URL', 'PLACEHOLDER_TENCENT_VOD_INTERNAL_TOKEN',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'tencent-vod',
  NULL, NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'tencent-vod' AND type = 67
);

-- Keep the models list in sync on re-runs (key / base_url / priority NOT
-- touched — operator-managed).
UPDATE channels
SET models = 'vidu-q2,vidu-q3,kling-v2-6,kling-v3,kling-v3-omni'
WHERE name = 'tencent-vod' AND type = 67 AND "group" = 'default';

-- -----------------------------------------------------------------------------
-- Step 2: abilities (default + auto) for each model on the tencent-vod channel.
-- -----------------------------------------------------------------------------

WITH model_seed(model) AS (VALUES
  ('vidu-q2'),
  ('vidu-q3'),
  ('kling-v2-6'),
  ('kling-v3'),
  ('kling-v3-omni')
),
matrix AS (
  SELECT s.model, g.ability_group
  FROM model_seed AS s
  CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT mx.ability_group, mx.model, c.id, true, 0, 0, 'tencent-vod'
FROM matrix AS mx
JOIN channels AS c
  ON c.name = 'tencent-vod' AND c.type = 67 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled;

COMMIT;
