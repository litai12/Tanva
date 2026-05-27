-- 006-add-remove-bg-channel.sql
-- Purpose: register the remove.bg proxy channel used by background-removal.service.ts.
--
-- Selected by name in controller/special_proxy.go:
--   "remove-bg" → api.remove.bg  (background removal via X-Api-Key auth)
--
-- Key is PLACEHOLDER — fill in via admin console after apply:
--   PLACEHOLDER_REMOVE_BG_API_KEY → your remove.bg API key
--
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

INSERT INTO channels (
  type, name, key, status, base_url,
  created_time, test_time
)
SELECT
  1,
  'remove-bg',
  'PLACEHOLDER_REMOVE_BG_API_KEY',
  1,
  'https://api.remove.bg',
  EXTRACT(EPOCH FROM NOW())::bigint,
  0
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'remove-bg' AND type = 1
);

COMMIT;
