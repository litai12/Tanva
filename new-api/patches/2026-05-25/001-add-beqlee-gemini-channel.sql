-- 001-add-beqlee-gemini-channel.sql
-- Purpose: add a direct official Gemini channel (type 24) via the beqlee CF proxy
--   (generativelanguage.beqlee.icu → generativelanguage.googleapis.com).
--
-- Models covered:
--   gemini-3-pro-image-preview        (nano-banana-pro base model)
--   gemini-3.1-flash-image-preview    (nanobanana2 base model)
--   gemini-3-pro-image-preview-ultra  (极速线路 pro tier)
--   gemini-3.1-flash-image-preview-ultra (极速线路 ultra tier)
--
-- Key: PLACEHOLDER_BEQLEE_GEMINI_KEY — fill in via admin console after apply.
-- Auth: x-goog-api-key header (set automatically by Gemini adaptor).
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: upsert channel ────────────────────────────────────────────────────

INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag,
  setting, param_override, header_override
)
SELECT
  'beqlee-gemini',
  24,
  'default',
  'gemini-3-pro-image-preview,gemini-3.1-flash-image-preview,gemini-3-pro-image-preview-ultra,gemini-3.1-flash-image-preview-ultra',
  NULL,
  1,
  'https://generativelanguage.beqlee.icu',
  'PLACEHOLDER_BEQLEE_GEMINI_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0,
  10, 100, 'beqlee-gemini',
  NULL, NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'beqlee-gemini' AND type = 24 AND "group" = 'default'
);

-- Sync models/base_url on re-runs; leave key/status/priority untouched.
UPDATE channels
SET models   = 'gemini-3-pro-image-preview,gemini-3.1-flash-image-preview,gemini-3-pro-image-preview-ultra,gemini-3.1-flash-image-preview-ultra',
    base_url = 'https://generativelanguage.beqlee.icu'
WHERE name = 'beqlee-gemini' AND type = 24 AND "group" = 'default';

-- ── Step 2: seed abilities ────────────────────────────────────────────────────

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.grp, m.model, c.id, true, 10, 100, 'beqlee-gemini'
FROM (VALUES
  ('gemini-3-pro-image-preview'),
  ('gemini-3.1-flash-image-preview'),
  ('gemini-3-pro-image-preview-ultra'),
  ('gemini-3.1-flash-image-preview-ultra')
) AS m(model)
CROSS JOIN (VALUES ('default'), ('auto')) AS g(grp)
JOIN channels AS c
  ON c.name = 'beqlee-gemini' AND c.type = 24 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled  = true,
      priority = EXCLUDED.priority,
      weight   = EXCLUDED.weight,
      tag      = EXCLUDED.tag;

\echo '----- beqlee-gemini channel after patch -----'
SELECT name, type, status, base_url,
       LEFT(models, 120) AS models_preview
FROM channels
WHERE name = 'beqlee-gemini' AND type = 24;

\echo '----- abilities seeded -----'
SELECT a."group", a.model, a.enabled, a.priority
FROM abilities AS a
JOIN channels AS c ON c.id = a.channel_id
WHERE c.name = 'beqlee-gemini' AND c.type = 24
ORDER BY a."group", a.model;

COMMIT;
