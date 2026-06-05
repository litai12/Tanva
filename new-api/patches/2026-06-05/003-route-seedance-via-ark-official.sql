-- 003-route-seedance-via-ark-official.sql
-- Purpose: make Seedance video route through the ARK 官渠 (direct VolcEngine,
--   type-45 channel, snapshot ids) on every stack, and add Seedance 1.5-pro.
--
-- Context: on the local new_api stack the type-45 ARK channel (ark-doubao) had
--   its seedance abilities DISABLED and seedance video fell through to the
--   apimart reseller (type 59), whose doubao-seedance-2.0 i2v rejects the
--   `ratio` parameter ("InvalidParameter ... ratio ... not valid ... in i2v").
--   ARK official accepts `ratio` in i2v, so routing to ARK fixes that too.
--   1.5-pro had a models row but no channel membership / abilities → unroutable.
--
-- What it does (idempotent, business keys = channel.type + model name):
--   1. enable the ARK 官渠's 2.0 snapshot abilities (type-45 channels).
--   2. ensure the 1.5-pro models row is kind=video, add it to those channels'
--      models, and give it an enabled ability cloned from the 2.0 snapshot.
--   3. disable seedance abilities on reseller channels (type 59) so the
--      distributor picks the ARK 官渠 for the snapshot ids.
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: enable the ARK 官渠 (type 45) 2.0 snapshot abilities ────────────────
UPDATE abilities AS a
SET enabled = true
FROM channels AS c
WHERE a.channel_id = c.id
  AND c.type = 45 AND c.status = 1
  AND a.model IN ('doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128');

-- ── Step 2a: 1.5-pro models row → kind=video (row itself seeded by 2026-06-02/001) ─
UPDATE models
SET kind = 'video', updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'doubao-seedance-1-5-pro-251215' AND deleted_at IS NULL;

-- ── Step 2b: add 1.5-pro to every ARK 官渠's models column ──────────────────────
UPDATE channels AS c
SET models = CASE
      WHEN c.models LIKE '%doubao-seedance-1-5-pro-251215%' THEN c.models
      ELSE c.models || ',doubao-seedance-1-5-pro-251215'
    END
WHERE c.type = 45 AND c.status = 1
  AND c.models LIKE '%doubao-seedance-2-0-260128%';

-- ── Step 2c: 1.5-pro enabled ability cloned from the (now-enabled) 2.0 snapshot ─
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT a."group", 'doubao-seedance-1-5-pro-251215', a.channel_id, true, a.priority, a.weight, a.tag
FROM abilities AS a
JOIN channels AS c ON c.id = a.channel_id
WHERE c.type = 45 AND a.model = 'doubao-seedance-2-0-260128'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = true;

-- ── Step 3: disable seedance on reseller channels (type 59) → force ARK 官渠 ─────
UPDATE abilities AS a
SET enabled = false
FROM channels AS c
WHERE a.channel_id = c.id
  AND c.type = 59
  AND a.model LIKE 'doubao-seedance-2.0%';

-- ── Verify ────────────────────────────────────────────────────────────────────
\echo '----- seedance abilities after patch (ARK enabled, reseller disabled) -----'
SELECT a.model, a.channel_id, c.name, c.type, a.enabled
FROM abilities a JOIN channels c ON c.id = a.channel_id
WHERE a.model LIKE '%seedance%' ORDER BY a.enabled DESC, c.type, a.model;

COMMIT;
