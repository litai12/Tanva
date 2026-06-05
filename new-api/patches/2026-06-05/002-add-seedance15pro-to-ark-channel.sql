-- 002-add-seedance15pro-to-ark-channel.sql
-- Purpose: wire Seedance 1.5-pro 图生视频 (snapshot id doubao-seedance-1-5-pro-251215)
--   onto the SAME ARK 官渠 that already serves Seedance 2.0, so the Tanva backend's
--   /v1/videos request (which always sends the snapshot id) can route.
--
-- Background / why the earlier patch missed it:
--   2026-06-02/001 added this model to a channel named 'ark-doubao' (type 54).
--   In production that channel does not exist — the live ARK 官渠 is the type-45
--   channel that carries the enabled doubao-seedance-2-0-260128 ability
--   (named 'ark' here, 'ark-doubao' on the other stack). So that UPDATE matched
--   0 rows and 1.5 ended up with NO abilities (unroutable) while still marked
--   applied. This patch fixes it by keying off the 2.0 snapshot ability instead
--   of a hard-coded channel name, so it is correct on every stack.
--
-- What it does (mirrors how 2.0 官渠 is wired):
--   1. models row for the snapshot id (kind=video), copied from the 2.0 row.
--   2. params_def (Seedance 1.5-pro spec: duration 4-12, 6 ratios incl 21:9, 480/720/1080p).
--   3. append the snapshot id to channels.models of every channel that has an
--      ENABLED doubao-seedance-2-0-260128 ability (the ARK 官渠).
--   4. clone the 2.0 snapshot abilities to 1.5 (same group/enabled/priority/weight/tag).
--   5. flat ModelPrice fallback = 15 (matches the existing doubao-seedance-1-5-pro
--      tier). Real billing stays on the Tanva backend per existing 1.5 pricing.
--
-- Scope: PostgreSQL only, data-only, idempotent. Business key: the 2.0 snapshot ability.

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: models row (kind=video), copied from the working 2.0 snapshot row ──
INSERT INTO models (
  model_name, description, icon, tags, vendor_id, endpoints, kind, status,
  sync_official, created_time, updated_time, name_rule
)
SELECT 'doubao-seedance-1-5-pro-251215',
       'Tanva video model doubao-seedance-1-5-pro-251215',
       m.icon, m.tags, m.vendor_id, m.endpoints, 'video', m.status, m.sync_official,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, m.name_rule
FROM models AS m
WHERE m.model_name = 'doubao-seedance-2-0-260128' AND m.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM models AS x
    WHERE x.model_name = 'doubao-seedance-1-5-pro-251215' AND x.deleted_at IS NULL
  );

-- Force kind=video on re-runs (a pricing-only row may pre-exist with empty kind,
-- which would break apimart.SubmitPath / GetModelKind on shared paths).
UPDATE models
SET kind = 'video', updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'doubao-seedance-1-5-pro-251215' AND deleted_at IS NULL;

-- ── Step 2: params_def (Seedance 1.5-pro spec) ────────────────────────────────
UPDATE models SET
  kind = 'video', capabilities = '["reference_images"]',
  params_def = $json$[
    {"key":"duration","type":"enum","label":"时长","default":5,
     "options":[
       {"value":4,"label":"4s"},{"value":5,"label":"5s"},{"value":6,"label":"6s"},
       {"value":7,"label":"7s"},{"value":8,"label":"8s"},{"value":9,"label":"9s"},
       {"value":10,"label":"10s"},{"value":11,"label":"11s"},{"value":12,"label":"12s"}
     ]},
    {"key":"size","type":"enum","label":"画幅","default":"16:9",
     "options":[
       {"value":"21:9","label":"21:9","aspectRatio":"21:9","orientation":"landscape"},
       {"value":"16:9","label":"16:9","aspectRatio":"16:9","orientation":"landscape"},
       {"value":"4:3","label":"4:3","aspectRatio":"4:3","orientation":"landscape"},
       {"value":"1:1","label":"1:1","aspectRatio":"1:1"},
       {"value":"3:4","label":"3:4","aspectRatio":"3:4","orientation":"portrait"},
       {"value":"9:16","label":"9:16","aspectRatio":"9:16","orientation":"portrait"}
     ]},
    {"key":"resolution","type":"enum","label":"分辨率","default":"720p",
     "options":[{"value":"480p","label":"480p"},{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"}]}
  ]$json$,
  updated_time = EXTRACT(EPOCH FROM NOW())::bigint
WHERE model_name = 'doubao-seedance-1-5-pro-251215' AND deleted_at IS NULL;

-- ── Step 3: append snapshot id to the ARK 官渠's models column ──────────────────
-- The ARK 官渠 = any channel with an ENABLED doubao-seedance-2-0-260128 ability.
UPDATE channels AS c
SET models = CASE
      WHEN c.models LIKE '%doubao-seedance-1-5-pro-251215%' THEN c.models
      ELSE c.models || ',doubao-seedance-1-5-pro-251215'
    END
WHERE c.id IN (
  SELECT a.channel_id FROM abilities AS a
  WHERE a.model = 'doubao-seedance-2-0-260128' AND a.enabled = true
);

-- ── Step 4: clone the 2.0 snapshot abilities to 1.5 (the routing gate) ─────────
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT a."group", 'doubao-seedance-1-5-pro-251215', a.channel_id, a.enabled, a.priority, a.weight, a.tag
FROM abilities AS a
WHERE a.model = 'doubao-seedance-2-0-260128' AND a.enabled = true
ON CONFLICT ("group", model, channel_id) DO UPDATE
SET enabled = EXCLUDED.enabled;

-- ── Step 5: flat ModelPrice fallback (RMB). Real billing is on the Tanva backend. ─
INSERT INTO options (key, value) VALUES (
  'ModelPrice',
  $json${"doubao-seedance-1-5-pro-251215": 15}$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

-- ── Verify ────────────────────────────────────────────────────────────────────
\echo '----- ARK 官渠 channels now carrying the 1.5 snapshot -----'
SELECT id, name, type, status FROM channels
WHERE models LIKE '%doubao-seedance-1-5-pro-251215%' ORDER BY id;

\echo '----- 1.5 abilities (should mirror enabled 2.0 snapshot) -----'
SELECT "group", model, channel_id, enabled FROM abilities
WHERE model = 'doubao-seedance-1-5-pro-251215' ORDER BY channel_id;

COMMIT;
