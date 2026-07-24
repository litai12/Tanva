-- Add Gemini multimodal chat models used by Tanva Image Chat to ToAPIs.
-- Endpoint: POST /v1/chat/completions (OpenAI-compatible multimodal messages).
-- PostgreSQL, data-only, idempotent. Existing channel tuning and prices survive.

\set ON_ERROR_STOP on
BEGIN;

WITH chat_models(model_name, description) AS (VALUES
  ('gemini-2.5-flash', 'Gemini 2.5 Flash multimodal chat via ToAPIs'),
  ('gemini-3.5-flash', 'Gemini 3.5 Flash multimodal chat via ToAPIs'),
  ('gemini-3.1-pro', 'Gemini 3.1 Pro multimodal chat via ToAPIs')
)
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule, capabilities, params_def
)
SELECT
  cm.model_name, cm.description, NULL, 'toapis,gemini,multimodal', NULL,
  '/v1/chat/completions', 'chat', 1, 0,
  EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, 0,
  '["text","image"]',
  '[{"key":"temperature","type":"number","label":"Temperature"},{"key":"max_tokens","type":"integer","label":"Max tokens"}]'
FROM chat_models cm
WHERE NOT EXISTS (
  SELECT 1 FROM models m WHERE m.model_name = cm.model_name AND m.deleted_at IS NULL
);

WITH chat_models(model_name) AS (VALUES
  ('gemini-2.5-flash'),
  ('gemini-3.5-flash'),
  ('gemini-3.1-pro')
)
UPDATE channels c
SET models = (
  SELECT string_agg(DISTINCT model_name, ',' ORDER BY model_name)
  FROM (
    SELECT trim(value) AS model_name
    FROM unnest(string_to_array(COALESCE(c.models, ''), ',')) value
    UNION ALL
    SELECT cm.model_name FROM chat_models cm
  ) all_models
  WHERE model_name <> ''
)
WHERE c.type = 59
  AND lower(regexp_replace(c.base_url, '/+$', '')) = 'https://toapis.com';

WITH chat_models(model_name) AS (VALUES
  ('gemini-2.5-flash'),
  ('gemini-3.5-flash'),
  ('gemini-3.1-pro')
)
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT trim(g.grp), cm.model_name, c.id, true,
       COALESCE(c.priority, 0), COALESCE(c.weight, 0), COALESCE(NULLIF(c.tag, ''), 'toapis')
FROM channels c
CROSS JOIN unnest(string_to_array(c."group", ',')) g(grp)
CROSS JOIN chat_models cm
WHERE c.type = 59
  AND lower(regexp_replace(c.base_url, '/+$', '')) = 'https://toapis.com'
  AND trim(g.grp) <> ''
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled, tag = EXCLUDED.tag;

-- Tanva Image Chat charges a flat 10 credits = RMB 0.10 per invocation for
-- all three tiers. new-api ModelPrice uses RMB in this deployment, so keep the
-- gateway reservation and Tanva's backend deduction on the same commercial
-- basis. The upstream reference prices as of 2026-07-24 are token-based:
-- 2.5 Flash 12/100, 3.5 Flash 60/360, 3.1 Pro 80/480 credits per 1M in/out.
INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  '{"gemini-2.5-flash":0.1,"gemini-3.5-flash":0.1,"gemini-3.1-pro":0.1}'
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

COMMIT;
