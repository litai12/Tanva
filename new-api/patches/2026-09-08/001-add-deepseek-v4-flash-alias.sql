-- Ordinary Tanva text requests use a stable model name. Keep this route
-- separate from the xiaot-agent facade and reuse the configured ARK channel.
BEGIN;

UPDATE channels
SET models = models || ',deepseek-v4-flash',
    model_mapping = (COALESCE(NULLIF(NULLIF(model_mapping, ''), 'null')::jsonb, '{}'::jsonb)
      || '{"deepseek-v4-flash":"deepseek-v4-flash-260425"}'::jsonb)::text
WHERE type = 45
  AND 'deepseek-v4-flash-260425' = ANY(string_to_array(models, ','))
  AND NOT ('deepseek-v4-flash' = ANY(string_to_array(models, ',')));

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT "group", 'deepseek-v4-flash', channel_id, enabled, priority, weight, tag
FROM abilities
WHERE model = 'deepseek-v4-flash-260425'
  AND channel_id IN (SELECT id FROM channels WHERE type = 45
    AND 'deepseek-v4-flash' = ANY(string_to_array(models, ',')))
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled, priority = EXCLUDED.priority,
    weight = EXCLUDED.weight, tag = EXCLUDED.tag;

UPDATE options
SET value = (value::jsonb || jsonb_build_object('deepseek-v4-flash',
  value::jsonb -> 'deepseek-v4-flash-260425'))::text
WHERE key IN ('ModelRatio', 'CompletionRatio', 'CacheRatio', 'CreateCacheRatio', 'ModelPrice')
  AND value::jsonb ? 'deepseek-v4-flash-260425';

COMMIT;
