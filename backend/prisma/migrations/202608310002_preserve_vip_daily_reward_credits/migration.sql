BEGIN;

-- 恢复本次规则上线后被误清的 VIP 签到积分。VIP 范围包含有效月卡、
-- 有效年卡以及 VIP 白名单；历史批次通过非 free 的 tierCode 识别。
CREATE TEMP TABLE "_VipDailyRewardRestoreLot" ON COMMIT DROP AS
SELECT
  expired."creditLotId" AS "lotId",
  expired."accountId" AS "accountId",
  LEAST(
    SUM(-expired."amount")::int,
    GREATEST(lot."totalAmount" - lot."remainingAmount", 0)
  )::int AS "restoreAmount"
FROM "CreditTransaction" AS expired
JOIN "CreditLot" AS lot ON lot."id" = expired."creditLotId"
WHERE
  expired."type" = 'expire'
  AND expired."amount" < 0
  AND expired."description" = '签到积分当日到期清除'
  AND COALESCE(expired."metadata"->>'restoredAsVipBenefit', 'false') <> 'true'
  AND lot."metadata"->>'reason' = 'daily_reward'
  AND COALESCE(NULLIF(LOWER(lot."metadata"->>'tierCode'), ''), 'free') <> 'free'
GROUP BY
  expired."creditLotId",
  expired."accountId",
  lot."totalAmount",
  lot."remainingAmount"
HAVING LEAST(
  SUM(-expired."amount")::int,
  GREATEST(lot."totalAmount" - lot."remainingAmount", 0)
) > 0;

CREATE TEMP TABLE "_VipDailyRewardRestoreAccount" ON COMMIT DROP AS
SELECT "accountId", SUM("restoreAmount")::int AS "restoreAmount"
FROM "_VipDailyRewardRestoreLot"
GROUP BY "accountId";

-- 保留原误清流水作为审计证据，并新增一条账户级补回流水。
INSERT INTO "CreditTransaction" (
  "id",
  "accountId",
  "type",
  "amount",
  "balanceBefore",
  "balanceAfter",
  "description",
  "businessType",
  "metadata",
  "createdAt"
)
SELECT
  gen_random_uuid()::text,
  restore."accountId",
  'adjustment',
  restore."restoreAmount",
  account."balance",
  account."balance" + restore."restoreAmount",
  '恢复误清的VIP签到积分',
  'vip_daily_reward_restore',
  jsonb_build_object(
    'reason', 'restore_vip_daily_reward_benefit',
    'migration', '202608310002_preserve_vip_daily_reward_credits'
  ),
  CURRENT_TIMESTAMP
FROM "_VipDailyRewardRestoreAccount" AS restore
JOIN "CreditAccount" AS account ON account."id" = restore."accountId";

UPDATE "CreditAccount" AS account
SET
  "balance" = account."balance" + restore."restoreAmount",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_VipDailyRewardRestoreAccount" AS restore
WHERE account."id" = restore."accountId";

UPDATE "CreditLot" AS lot
SET
  "sourceType" = 'subscription',
  "validityType" = 'permanent',
  "remainingAmount" = LEAST(lot."totalAmount", lot."remainingAmount" + restore."restoreAmount"),
  "expiresAt" = NULL,
  "durationDays" = NULL,
  "status" = 'active',
  "metadata" = COALESCE(lot."metadata", '{}'::jsonb) || jsonb_build_object(
    'retentionPolicy', 'vip_permanent'
  ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_VipDailyRewardRestoreLot" AS restore
WHERE lot."id" = restore."lotId";

-- 尚未误清的历史 VIP 签到批次也统一改为会员永久积分，避免会员到期后
-- 被免费 gift 每日衰减任务误扣。
UPDATE "CreditLot"
SET
  "sourceType" = 'subscription',
  "validityType" = 'permanent',
  "expiresAt" = NULL,
  "durationDays" = NULL,
  "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object(
    'retentionPolicy', 'vip_permanent'
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "metadata"->>'reason' = 'daily_reward'
  AND COALESCE(NULLIF(LOWER("metadata"->>'tierCode'), ''), 'free') <> 'free';

UPDATE "CreditTransaction" AS reward
SET
  "expiresAt" = NULL,
  "isExpired" = false,
  "expiredAmount" = 0,
  "metadata" = COALESCE(reward."metadata", '{}'::jsonb) || jsonb_build_object(
    'retentionPolicy', 'vip_permanent'
  )
FROM "CreditLot" AS lot
WHERE
  reward."creditLotId" = lot."id"
  AND reward."type" = 'daily_reward'
  AND lot."metadata"->>'reason' = 'daily_reward'
  AND COALESCE(NULLIF(LOWER(lot."metadata"->>'tierCode'), ''), 'free') <> 'free';

UPDATE "CreditTransaction" AS expired
SET "metadata" = COALESCE(expired."metadata", '{}'::jsonb) || jsonb_build_object(
  'restoredAsVipBenefit', true,
  'restorationMigration', '202608310002_preserve_vip_daily_reward_credits'
)
FROM "_VipDailyRewardRestoreLot" AS restore
WHERE
  expired."creditLotId" = restore."lotId"
  AND expired."type" = 'expire'
  AND expired."description" = '签到积分当日到期清除';

COMMIT;
