-- 001-fix-apimart-video-abilities-multigroup.sql
-- Fix for a silent no-op in 2026-06-02/001-add-vidu-kling26-seedance15-video-channels.sql
--
-- Bug: that patch's Step 5 created abilities with
--     JOIN channels AS c ON ... AND c."group" = 'default'
--   an EXACT string match on the group column. On a single-group apimart
--   channel (group = 'default') it worked; but a channel that also serves
--   another group has group = 'default,vip', so `c."group" = 'default'` does
--   not match, the JOIN returns zero rows, and the INSERT...SELECT inserts
--   NOTHING. No error is raised, so the migration is still recorded as applied
--   in schema_migrations while leaving apimart with no abilities for the
--   vidu / kling-v2-6 models it registered.
--
-- Symptom: "No available channel for model vidu-q3 under group default
--   (distributor)" even though channels.models contains vidu-q3 and the
--   migration shows as applied.
--
-- Fix: rebuild the missing abilities for the apimart channel across EVERY
--   group listed in its `group` column (split on comma), mirroring new-api's
--   own Channel.AddAbilities behavior. Guarded by channels.models LIKE so we
--   only add abilities the channel actually advertises. Idempotent.
--
-- IMPORTANT: MEMORY_CACHE_ENABLED=true — restart new-api (or reload channels in
--   the admin console) AFTER applying, or the in-memory ability map stays stale.
--
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT trim(g.grp), m.model, c.id, true,
       COALESCE(c.priority, 0), COALESCE(c.weight, 0), c.tag
FROM channels AS c
CROSS JOIN unnest(string_to_array(c."group", ',')) AS g(grp)
CROSS JOIN (VALUES
  ('vidu-q3'),
  ('vidu-q2'),
  ('vidu-q2-apimart'),
  ('kling-v2-6'),
  ('kling-v2-6-apimart')
) AS m(model)
WHERE c.name = 'apimart'
  AND c.type = 59
  AND trim(g.grp) <> ''
  AND c.models LIKE '%' || m.model || '%'
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled;

COMMIT;
