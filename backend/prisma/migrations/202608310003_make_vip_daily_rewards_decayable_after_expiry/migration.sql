BEGIN;

-- 会员/白名单签到积分只在当前资格有效时暂停衰减。它们不参加次日 3 点
-- 的免费签到整批清理，但资格失效后必须重新进入每日 gift 衰减池。
UPDATE "CreditLot"
SET
  "sourceType" = 'gift',
  "validityType" = 'permanent',
  "expiresAt" = NULL,
  "durationDays" = NULL,
  "priority" = -200,
  "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object(
    'retentionPolicy', 'vip_decay_after_entitlement'
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "metadata"->>'reason' = 'daily_reward'
  AND (
    "metadata"->>'retentionPolicy' IN ('vip_permanent', 'vip_decay_after_entitlement')
    OR COALESCE(NULLIF(LOWER("metadata"->>'tierCode'), ''), 'free') <> 'free'
  );

UPDATE "CreditTransaction" AS reward
SET
  "expiresAt" = NULL,
  "metadata" = COALESCE(reward."metadata", '{}'::jsonb) || jsonb_build_object(
    'retentionPolicy', 'vip_decay_after_entitlement'
  )
FROM "CreditLot" AS lot
WHERE
  reward."creditLotId" = lot."id"
  AND reward."type" = 'daily_reward'
  AND lot."metadata"->>'reason' = 'daily_reward'
  AND lot."metadata"->>'retentionPolicy' = 'vip_decay_after_entitlement';

COMMIT;
