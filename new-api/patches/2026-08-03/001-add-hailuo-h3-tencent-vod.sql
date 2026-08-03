-- Register MiniMax Hailuo H3 on the Tencent VOD task channel.
-- Pricing SSOT: new-api ModelRatio hailuo-h3=45 (2K RMB 1.20/s retail);
-- the adaptor applies 1.25x for 4K and includes reference-video duration plus
-- RMB 0.30 for every unique image beyond the first five.
-- PostgreSQL, data-only, idempotent. Deployment only; do not run locally.

BEGIN;

INSERT INTO models (
  model_name, description, tags, endpoints, kind, status, sync_official,
  created_time, updated_time, name_rule, capabilities, params_def
)
SELECT
  'hailuo-h3', 'MiniMax Hailuo H3 via Tencent VOD', 'hailuo,minimax,video',
  '/v1/videos', 'video', 1, 0,
  EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0,
  '["text_to_video","first_frame","first_last_frame","reference_images","reference_video","reference_audio"]',
  $json$[
    {"key":"duration","type":"integer","label":"时长","default":4,"min":4,"max":15,"step":1},
    {"key":"size","type":"enum","label":"画幅","default":"16:9","options":[{"value":"16:9","label":"16:9"},{"value":"9:16","label":"9:16"},{"value":"1:1","label":"1:1"},{"value":"4:3","label":"4:3"},{"value":"3:4","label":"3:4"},{"value":"21:9","label":"21:9"}]},
    {"key":"resolution","type":"enum","label":"分辨率","default":"2K","options":[{"value":"2K","label":"2K"},{"value":"4K","label":"4K"}]},
    {"key":"mode","type":"enum","label":"模式","default":"reference","options":[{"value":"text","label":"文生视频"},{"value":"first_frame","label":"首帧"},{"value":"start_end","label":"首尾帧"},{"value":"reference","label":"全能参考"}]},
    {"key":"billing","type":"object","metadata":{"currency":"credits","outputAndInputVideoPerSecond":{"2K":120,"4K":150},"imageFreeCount":5,"extraImageCredits":30,"audioCredits":0}},
    {"key":"inputs","type":"object","metadata":{"maxImages":9,"maxVideos":3,"maxAudios":3,"maxMixedMedia":12,"videoDurationMin":2,"videoDurationMax":15}}
  ]$json$
WHERE NOT EXISTS (SELECT 1 FROM models WHERE model_name = 'hailuo-h3' AND deleted_at IS NULL);

UPDATE models SET
  description = 'MiniMax Hailuo H3 via Tencent VOD', tags = 'hailuo,minimax,video',
  endpoints = '/v1/videos', kind = 'video', status = 1,
  capabilities = '["text_to_video","first_frame","first_last_frame","reference_images","reference_video","reference_audio"]',
  params_def = $json$[
    {"key":"duration","type":"integer","label":"时长","default":4,"min":4,"max":15,"step":1},
    {"key":"size","type":"enum","label":"画幅","default":"16:9","options":[{"value":"16:9","label":"16:9"},{"value":"9:16","label":"9:16"},{"value":"1:1","label":"1:1"},{"value":"4:3","label":"4:3"},{"value":"3:4","label":"3:4"},{"value":"21:9","label":"21:9"}]},
    {"key":"resolution","type":"enum","label":"分辨率","default":"2K","options":[{"value":"2K","label":"2K"},{"value":"4K","label":"4K"}]},
    {"key":"mode","type":"enum","label":"模式","default":"reference","options":[{"value":"text","label":"文生视频"},{"value":"first_frame","label":"首帧"},{"value":"start_end","label":"首尾帧"},{"value":"reference","label":"全能参考"}]},
    {"key":"billing","type":"object","metadata":{"currency":"credits","outputAndInputVideoPerSecond":{"2K":120,"4K":150},"imageFreeCount":5,"extraImageCredits":30,"audioCredits":0}},
    {"key":"inputs","type":"object","metadata":{"maxImages":9,"maxVideos":3,"maxAudios":3,"maxMixedMedia":12,"videoDurationMin":2,"videoDurationMax":15}}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'hailuo-h3' AND deleted_at IS NULL;

UPDATE channels
SET models = array_to_string(
  ARRAY(
    SELECT DISTINCT value
    FROM unnest(string_to_array(COALESCE(models, ''), ',') || ARRAY['hailuo-h3']) AS u(value)
    WHERE btrim(value) <> ''
  ),
  ','
)
WHERE name = 'tencent-vod' AND type = 67 AND "group" = 'default';

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.ability_group, 'hailuo-h3', c.id, true, 0, 0, 'tencent-vod'
FROM channels c
CROSS JOIN (VALUES ('default'), ('auto')) AS g(ability_group)
WHERE c.name = 'tencent-vod' AND c.type = 67 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE SET enabled = EXCLUDED.enabled;

INSERT INTO options (key, value)
VALUES ('ModelRatio', jsonb_build_object('hailuo-h3', 45)::text)
ON CONFLICT (key) DO UPDATE
SET value = (COALESCE(options.value, '{}')::jsonb || jsonb_build_object('hailuo-h3', 45))::text;

COMMIT;
