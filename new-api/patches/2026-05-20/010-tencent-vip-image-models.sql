-- 010-tencent-vip-image-models.sql
-- Purpose: Add image model names to the tencent channel in the vip group so
--          that new-api routes VIP /v1/images/generations requests to the
--          tencent channel, which then calls Tencent VOD AIGC internally.
--
-- Model names match what the backend sends in the "model" field:
--   gpt-image-2, gemini-2.5-flash-image-preview, gemini-3-pro, gemini-2.5-pro
--
-- Also updates the channel key from 'secretId|secretKey' to
-- 'subAppId|secretId|secretKey' format required by the relay adaptor.
-- Replace PLACEHOLDER_* with real values before deploying.
--
-- Idempotent: uses string_to_array + DISTINCT to avoid duplicate model names.

BEGIN;

-- Add image model names to the tencent VIP channel models list (idempotent).
UPDATE channels
SET models = (
  SELECT string_agg(DISTINCT m, ',')
  FROM unnest(
    string_to_array(
      COALESCE(models, '') || ',gpt-image-2,gemini-2.5-flash-image-preview,gemini-3-pro,gemini-2.5-pro',
      ','
    )
  ) AS m
  WHERE m <> ''
)
WHERE name = 'tencent'
  AND "group" LIKE '%vip%';

-- Ensure the abilities table reflects the new image models for the vip tencent channel.
INSERT INTO abilities (group_name, model, channel_id, enabled, priority, weight)
SELECT
  'vip',
  m.model_name,
  c.id,
  true,
  0,
  100
FROM
  channels c,
  (VALUES
    ('gpt-image-2'),
    ('gemini-2.5-flash-image-preview'),
    ('gemini-3-pro'),
    ('gemini-2.5-pro')
  ) AS m(model_name)
WHERE c.name = 'tencent'
  AND c."group" LIKE '%vip%'
ON CONFLICT DO NOTHING;

COMMIT;
