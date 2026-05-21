-- 005-raise-tencent-vip-priority.sql
-- Purpose: make the tencent channel win over apimart inside the 'vip' group.
--
-- Background: new-api's GetRandomSatisfiedChannel (model/channel_cache.go)
-- selects the HIGHEST channel-priority tier first, then does weighted-random
-- only WITHIN that tier. apimart was promoted to priority=1 by
-- 2026-04-22/010-raise-apimart-priority.sql, while the tencent VIP channel
-- was created at priority=0. So for any model both channels serve in the
-- 'vip' group (gpt-image-2, gemini-*), new-api always lands on apimart and
-- never reaches tencent. The weight=100 on tencent is ignored because weight
-- only breaks ties inside the SAME priority tier.
--
-- Fix: raise the tencent VIP channel (and its abilities) to priority=2,
-- strictly above apimart's 1, so VIP requests route to tencent.
--
-- Scope: PostgreSQL only, data-only, idempotent. Keyed by channel
-- name + group, not by auto-increment id.

\set ON_ERROR_STOP on

BEGIN;

-- Memory-cache routing path uses channels.priority (channel.GetPriority()).
UPDATE channels
SET priority = 2
WHERE name = 'tencent'
  AND "group" LIKE '%vip%'
  AND (priority IS NULL OR priority < 2);

-- DB routing path uses abilities.priority; keep it in sync with the channel.
UPDATE abilities
SET priority = 2
WHERE channel_id IN (
  SELECT id FROM channels
  WHERE name = 'tencent' AND "group" LIKE '%vip%'
)
AND (priority IS NULL OR priority < 2);

\echo ''
\echo '----- vip-group priority: tencent must outrank apimart -----'
SELECT c.id, c.name, c.priority AS channel_priority,
       a.model, a.priority AS ability_priority, a.weight
FROM abilities a
JOIN channels c ON c.id = a.channel_id
WHERE a."group" = 'vip'
  AND a.model = 'gpt-image-2'
ORDER BY c.priority DESC;

COMMIT;
