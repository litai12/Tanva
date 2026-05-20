-- 010-tencent-vip-image-models.sql
-- Purpose: Add image model names to the tencent channel in the vip group so
--          that new-api routes VIP /v1/images/generations requests to the
--          tencent channel, which then calls Tencent VOD AIGC internally.
--
-- Model names match what the backend sends in the "model" field:
--   gpt-image-2, gemini-2.5-flash-image-preview, gemini-3.1-flash-image-preview,
--   gemini-3-pro, gemini-3-pro-image-preview, gemini-2.5-pro
--
-- Also updates the channel key from 'secretId|secretKey' to
-- 'subAppId|secretId|secretKey' format required by the relay adaptor.
--
-- Idempotent: uses string_to_array + DISTINCT to avoid duplicate model names.

BEGIN;

-- Add image model names to the tencent VIP channel models list (idempotent).
UPDATE channels
SET models = (
  SELECT string_agg(DISTINCT m, ',')
  FROM unnest(
    string_to_array(
      COALESCE(models, '') || ',gpt-image-2,gemini-2.5-flash-image-preview,gemini-3.1-flash-image-preview,gemini-3-pro,gemini-3-pro-image-preview,gemini-2.5-pro',
      ','
    )
  ) AS m
  WHERE m <> ''
)
WHERE name = 'tencent'
  AND "group" LIKE '%vip%';

-- Ensure the abilities table reflects the new image models for the vip tencent channel.
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight)
SELECT
  'vip'::varchar,
  m.model_name,
  c.id,
  true,
  0::bigint,
  100::bigint
FROM
  channels c,
  (VALUES
    ('gpt-image-2'),
    ('gemini-2.5-flash-image-preview'),
    ('gemini-3.1-flash-image-preview'),
    ('gemini-3-pro'),
    ('gemini-3-pro-image-preview'),
    ('gemini-2.5-pro')
  ) AS m(model_name)
WHERE c.name = 'tencent'
  AND c."group" LIKE '%vip%'
ON CONFLICT DO NOTHING;

-- Update channel key to subAppId|secretId|secretKey format (idempotent: only if not already 3-part).
UPDATE channels
SET key = 'PLACEHOLDER_APP_ID|PLACEHOLDER_SECRET_ID|PLACEHOLDER_SECRET_KEY'
WHERE name = 'tencent'
  AND "group" LIKE '%vip%'
  AND key NOT LIKE '%|%|%';

-- Set ModelPrice for tencent VOD image models (1:1 mapping to backend priceYuan, idempotent).
UPDATE options
SET value = (value::jsonb
  || '{"gemini-3-pro": 0.4}'::jsonb
  || '{"gemini-2.5-pro": 0.1}'::jsonb
  || '{"gpt-image-2": 0.4}'::jsonb
  || '{"gemini-2.5-flash-image-preview": 0.2}'::jsonb
  || '{"gemini-3.1-flash-image-preview": 0.3}'::jsonb
  || '{"gemini-3-pro-image-preview": 0.4}'::jsonb
)::text
WHERE key = 'ModelPrice';

-- Update channel type to Tencent (23) and set base_url (idempotent).
UPDATE channels
SET type = 23,
    base_url = 'https://hunyuan.tencentcloudapi.com'
WHERE name = 'tencent'
  AND "group" LIKE '%vip%'
  AND type != 23;

COMMIT;
