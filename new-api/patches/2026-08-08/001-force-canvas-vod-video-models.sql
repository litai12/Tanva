-- Force the currently enabled Tanva canvas VOD models through the Tencent VOD
-- task channel (type 67). Seedance, Wan and HappyHorse are intentionally out of
-- scope. PostgreSQL, data-only, idempotent; deployment only, do not run locally.

BEGIN;

UPDATE channels
SET models = 'vidu-q2,vidu-q3,kling-v2-6,kling-v3,kling-v3-omni,hailuo-h3'
WHERE name = 'tencent-vod' AND type = 67 AND "group" = 'default';

WITH model_seed(model) AS (VALUES
  ('vidu-q2'),
  ('vidu-q3'),
  ('kling-v2-6'),
  ('kling-v3'),
  ('kling-v3-omni'),
  ('hailuo-h3')
),
matrix AS (
  SELECT s.model, g.ability_group
  FROM model_seed AS s
  CROSS JOIN (VALUES ('default'), ('auto'), ('vip')) AS g(ability_group)
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT mx.ability_group, mx.model, c.id, true, 100, 100, 'tencent-vod'
FROM matrix AS mx
JOIN channels AS c
  ON c.name = 'tencent-vod' AND c.type = 67 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = true, priority = EXCLUDED.priority, weight = EXCLUDED.weight,
    tag = EXCLUDED.tag;

-- The same business IDs must not escape to APIMart/Kapon/etc. This is limited
-- to the six canvas models above and leaves every Seedance/Wan ability intact.
UPDATE abilities AS a
SET enabled = false
WHERE a.model IN (
  'vidu-q2', 'vidu-q3', 'kling-v2-6', 'kling-v3', 'kling-v3-omni', 'hailuo-h3'
)
AND a."group" IN ('default', 'auto', 'vip')
AND a.channel_id NOT IN (
  SELECT id FROM channels WHERE name = 'tencent-vod' AND type = 67
);

COMMIT;
