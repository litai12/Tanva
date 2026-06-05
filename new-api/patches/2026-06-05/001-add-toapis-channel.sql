-- 001-add-toapis-channel.sql
-- Purpose: register toapis.com as an APIMart-compatible image channel.
--
-- toapis exposes the SAME unified endpoint + body shape as APIMart
--   POST https://toapis.com/v1/images/generations
--   { model, prompt, size, n, metadata: { resolution, orientation } }
-- (confirmed by the user's gemini-3-pro / gemini-3.1-flash curls), so it reuses
-- the existing APIMart adaptor by sharing ChannelType 59. No Go change, no new
-- adaptor, no new pricing: isApimartChannel() returns true via ChannelType==59,
-- and the image-tier / gpt-image-2 routing keeps working.
--
-- Models (base ids only — all already registered as kind=image):
--   gemini-2.5-flash-image-preview
--   gemini-3.1-flash-image-preview
--   gemini-3-pro-image-preview
--   gpt-image-2
--
-- Pricing: reused as-is. new-api keys pricing by CanonicalModelKey(model_name),
-- and these are the canonical base names, so the existing per-spec image pricing
-- (fixedImagePricingRules in model/pricing.go) applies automatically. We do NOT
-- create vendor-suffixed aliases (e.g. *-toapis): "-toapis" is not a canonical
-- suffix, so an alias would miss the spec pricing — base names are required to
-- reuse "same model key" pricing including specs.
--
-- Routing: seeded as a SAFE, non-preempting backup (priority -1, below
-- apimart's 0) so applying this patch never diverts live traffic. Operator
-- tunes priority/weight in the admin UI; re-runs do NOT clobber that tuning.
--
-- Key: PLACEHOLDER_TOAPIS_KEY — fill in via admin console after apply.
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: upsert channel (type 59 = ChannelTypeApimart, distinct name) ───────

INSERT INTO channels (
  name, type, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag,
  setting, param_override, header_override
)
SELECT
  'toapis',
  59,
  'default',
  'gemini-2.5-flash-image-preview,gemini-3.1-flash-image-preview,gemini-3-pro-image-preview,gpt-image-2',
  '{}',
  1,
  'https://toapis.com',
  'PLACEHOLDER_TOAPIS_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0,
  -1, 0, 'toapis',
  NULL, NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE name = 'toapis' AND type = 59 AND "group" = 'default'
);

-- Re-run: keep models/base_url in sync; leave key/status/priority/weight
-- untouched so admin-UI tuning survives.
UPDATE channels
SET models   = 'gemini-2.5-flash-image-preview,gemini-3.1-flash-image-preview,gemini-3-pro-image-preview,gpt-image-2',
    base_url = 'https://toapis.com'
WHERE name = 'toapis' AND type = 59 AND "group" = 'default';

-- ── Step 2: seed abilities (default + auto groups) ────────────────────────────
-- priority -1 / weight 0 on first insert (safe backup). ON CONFLICT only
-- re-asserts enabled + tag so a re-run never resets admin-tuned priority/weight.

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.grp, m.model, c.id, true, -1, 0, 'toapis'
FROM (VALUES
  ('gemini-2.5-flash-image-preview'),
  ('gemini-3.1-flash-image-preview'),
  ('gemini-3-pro-image-preview'),
  ('gpt-image-2')
) AS m(model)
CROSS JOIN (VALUES ('default'), ('auto')) AS g(grp)
JOIN channels AS c
  ON c.name = 'toapis' AND c.type = 59 AND c."group" = 'default'
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled = true,
      tag     = EXCLUDED.tag;

\echo '----- toapis channel after patch -----'
SELECT name, type, status, base_url, priority, weight,
       LEFT(models, 100) AS models_preview
FROM channels
WHERE name = 'toapis' AND type = 59;

\echo '----- toapis abilities seeded -----'
SELECT a."group", a.model, a.enabled, a.priority, a.weight
FROM abilities AS a
JOIN channels AS c ON c.id = a.channel_id
WHERE c.name = 'toapis' AND c.type = 59
ORDER BY a."group", a.model;

COMMIT;
