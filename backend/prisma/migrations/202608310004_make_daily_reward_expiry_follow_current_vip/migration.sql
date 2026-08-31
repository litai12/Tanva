BEGIN;

-- 最终口径：签到积分是否跨业务日保留只看清理发生时的当前 VIP/白名单资格。
-- 元数据仅记录发放时身份，不能作为永久豁免条件。
UPDATE "CreditLot"
SET
  "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object(
    'retentionPolicy', 'current_vip_only'
  ),
  "priority" = -200,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "metadata"->>'reason' = 'daily_reward'
  AND (
    "metadata"->>'retentionPolicy' IN (
      'vip_permanent',
      'vip_decay_after_entitlement',
      'current_vip_only'
    )
    OR COALESCE(NULLIF(LOWER("metadata"->>'tierCode'), ''), 'free') <> 'free'
  );

UPDATE "CreditTransaction" AS reward
SET
  "metadata" = COALESCE(reward."metadata", '{}'::jsonb) || jsonb_build_object(
    'retentionPolicy', 'current_vip_only'
  )
FROM "CreditLot" AS lot
WHERE
  reward."creditLotId" = lot."id"
  AND reward."type" = 'daily_reward'
  AND lot."metadata"->>'reason' = 'daily_reward'
  AND lot."metadata"->>'retentionPolicy' = 'current_vip_only';

COMMIT;
