-- 001-map-gemini-31-pro-to-preview.sql
-- Purpose: keep the legacy gemini-3.1-pro facade routable while sending the
--          APIMart-supported gemini-3.1-pro-preview upstream model ID.
--
-- Background:
--   gemini-3.1-pro was manually seeded as a standalone APIMart model, but the
--   channel had no mapping for it. Production therefore forwarded the facade
--   name literally; all observed calls failed with HTTP 503. The preview ID is
--   the canonical model already used successfully by the same channel.
--
-- Scope: PostgreSQL only, data-only, idempotent. Restart new-api after applying
--        when MEMORY_CACHE_ENABLED=true so cached channel mappings are reloaded.

\set ON_ERROR_STOP on

BEGIN;

UPDATE channels
SET model_mapping = (
  COALESCE(NULLIF(model_mapping, '')::jsonb, '{}'::jsonb)
  || '{
    "gemini-3.1-pro": "gemini-3.1-pro-preview",
    "gemini-3.1-pro-apimart": "gemini-3.1-pro-preview"
  }'::jsonb
)::text
WHERE name = 'apimart'
  AND type = 59;

UPDATE models
SET description = CASE model_name
      WHEN 'gemini-3.1-pro'
        THEN 'Legacy Gemini 3.1 Pro facade; APIMart routes to gemini-3.1-pro-preview'
      WHEN 'gemini-3.1-pro-apimart'
        THEN 'Legacy APIMart alias; routes to gemini-3.1-pro-preview'
      ELSE description
    END,
    updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name IN ('gemini-3.1-pro', 'gemini-3.1-pro-apimart')
  AND deleted_at IS NULL;

\echo ''
\echo '----- Gemini 3.1 Pro compatibility mapping -----'
SELECT id, name,
       model_mapping::jsonb ->> 'gemini-3.1-pro' AS legacy_model_target,
       model_mapping::jsonb ->> 'gemini-3.1-pro-apimart' AS legacy_alias_target
FROM channels
WHERE name = 'apimart'
  AND type = 59;

COMMIT;
