-- Add routing rows for every public DeepSeek alias. Channel model_mapping is
-- applied after channel selection, so each alias needs its own ability row.

BEGIN;

WITH model_seed(model_name) AS (
  VALUES
    ('deepseek-v4.1-flash'),
    ('deepseek-flash'),
    ('deepseek-chat'),
    ('deepseek-reasoner'),
    ('deepseek-v3.2'),
    ('deepseek-v4-flash'),
    ('deepseek-v4-flash-260425'),
    ('deepseek-v4-flash-vision-exp'),
    ('deepseek-v4-pro'),
    ('deepseek-v4-pro-260425')
), group_seed(ability_group) AS (
  VALUES
    ('default'),
    ('auto'),
    ('vip'),
    ('svip'),
    ('codex')
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT
  groups.ability_group,
  models.model_name,
  channel.id,
  true,
  1000,
  100,
  'deepseek-official'
FROM group_seed AS groups
CROSS JOIN model_seed AS models
JOIN channels AS channel
  ON channel.name = 'deepseek-official'
 AND channel.type = 43
 AND channel."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET
  enabled = EXCLUDED.enabled,
  priority = EXCLUDED.priority,
  weight = EXCLUDED.weight,
  tag = EXCLUDED.tag;

COMMIT;
