-- 003-consolidate-ark-channels.sql
-- Purpose: 合并三个共用同一 Ark(火山方舟 Doubao) APIKey 的冗余渠道。
--
-- 现状(同一个 key)：
--   - ark-doubao        (type=45, 裸域名)         —— 真正走 distributor 的主渠道，
--                                                   abilities 超集(seed3d+seedance+全部 seedream)。✅ 保留
--   - ark-doubao-image  (type=45, 裸域名)         —— 冗余：模型是 ark-doubao 的子集。❌ 停用
--   - ark               (type=1,  .../api/v3)     —— 旧的 /proxy/ark 按名透传渠道，后端已不再调用
--                                                   (seed3d/seedream 均走标准 relay)。❌ 停用
--
-- 做法(无损 + 可逆 + 幂等，符合 patch 规则：仅改数据、不删数据)：
--   1. 把 ark-doubao-image 的模型 abilities 无损并入 ark-doubao(防服务器状态有差异)；
--   2. 把 ark-doubao-image 的 models 列并入 ark-doubao 的 models 列(面板展示/FixAbility 持久源)；
--   3. 仅当主渠道 ark-doubao(type=45) 存在且启用时，才停用 ark-doubao-image 与 ark，
--      并把它们的 abilities 置为不可用，确保 distributor 只会选 ark-doubao。
--
-- 停用而非删除：status=2(手动停用)，随时可在面板重新启用；如需彻底删除可在面板手动删。
-- Scope: PostgreSQL only, data-only, idempotent. 业务键: channels(name, type)。

\set ON_ERROR_STOP on

BEGIN;

-- ── Step 1: 无损并入 abilities(ark-doubao-image → ark-doubao) ───────────────────
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT a."group", a.model, keep.id, true,
       COALESCE(keep.priority, 0), COALESCE(keep.weight, 0), keep.tag
FROM abilities AS a
JOIN channels AS dup  ON dup.id = a.channel_id AND dup.name = 'ark-doubao-image' AND dup.type = 45
JOIN channels AS keep ON keep.name = 'ark-doubao' AND keep.type = 45
ON CONFLICT ("group", model, channel_id) DO UPDATE
  SET enabled = true;

-- ── Step 2: 并入 models 列(去重) ──────────────────────────────────────────────
UPDATE channels AS keep
SET models = (
  SELECT string_agg(DISTINCT m, ',')
  FROM unnest(
    string_to_array(COALESCE(keep.models, ''), ',')
    || COALESCE(
         (SELECT string_to_array(dup.models, ',')
          FROM channels AS dup WHERE dup.name = 'ark-doubao-image' AND dup.type = 45 LIMIT 1),
         ARRAY[]::text[]
       )
  ) AS t(m)
  WHERE m <> ''
)
WHERE keep.name = 'ark-doubao' AND keep.type = 45
  AND EXISTS (SELECT 1 FROM channels d WHERE d.name = 'ark-doubao-image' AND d.type = 45);

-- ── Step 3: 仅当主渠道在线时，停用冗余渠道及其 abilities ────────────────────────
UPDATE abilities SET enabled = false
WHERE channel_id IN (
  SELECT id FROM channels
  WHERE (name = 'ark-doubao-image' AND type = 45) OR (name = 'ark' AND type = 1)
)
AND EXISTS (SELECT 1 FROM channels k WHERE k.name = 'ark-doubao' AND k.type = 45 AND k.status = 1);

UPDATE channels SET status = 2  -- 2 = 手动停用
WHERE ((name = 'ark-doubao-image' AND type = 45) OR (name = 'ark' AND type = 1))
  AND EXISTS (SELECT 1 FROM channels k WHERE k.name = 'ark-doubao' AND k.type = 45 AND k.status = 1);

-- ── Verify ────────────────────────────────────────────────────────────────────
\echo '----- ark 系渠道状态(只应剩 ark-doubao status=1) -----'
SELECT id, name, type, status, "group", left(models, 120) AS models
FROM channels
WHERE base_url LIKE '%ark.cn-beijing.volces.com%' OR name ILIKE '%ark%'
ORDER BY id;

\echo '----- ark-doubao 仍启用的 abilities(应覆盖全部 doubao 模型) -----'
SELECT a.model, a.enabled
FROM abilities a JOIN channels c ON c.id = a.channel_id
WHERE c.name = 'ark-doubao' AND c.type = 45
ORDER BY a.model;

COMMIT;
