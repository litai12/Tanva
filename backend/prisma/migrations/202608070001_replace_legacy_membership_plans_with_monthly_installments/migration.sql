-- 会员套餐目录只保留 2026-08 按月发放版本。
--
-- 旧部署曾允许管理员重复创建同名套餐，且年卡使用一次性发放配置。订阅、订单
-- 和积分 lot 都按 membershipPlanId / snapshot 保存历史事实，因此这里不删除旧行：
-- 仅下架并改写旧 code，避免破坏已生效订阅的到期、退款和审计链路。

-- 先下架未标记为当前价格版本的所有旧套餐，并把其 code 改为历史唯一值。
-- code 即使在 inactive 行中也要求唯一；这一步同时修复历史重复 code，确保后续
-- 可以安全恢复数据库层的唯一约束。
UPDATE "MembershipPlan"
SET
  "isActive" = false,
  "code" = 'legacy_' || "id",
  "updatedAt" = CURRENT_TIMESTAMP
WHERE COALESCE("metadata"->>'priceVersion', '') <> '2026-08-v2';

-- 若此前数据库缺失了最初迁移声明的唯一索引，上方清理后重新建立它。
CREATE UNIQUE INDEX IF NOT EXISTS "MembershipPlan_code_key"
  ON "MembershipPlan"("code");

-- 当前可售套餐：年卡的额度字段代表全年总额，由服务端按 12 期均分；
-- creditIssuanceMode 是发放行为的唯一开关，不能依赖前端文案。
INSERT INTO "MembershipPlan" (
  "id", "code", "name", "billingCycle", "price",
  "monthlyQuotaCredits", "signupBonusCredits", "dailyGiftCredits",
  "isActive", "sortOrder", "metadata", "createdAt", "updatedAt"
) VALUES
(
  gen_random_uuid()::text, 'vip_69_monthly', '日常创作', 'monthly', 69.00,
  7000, 350, 50, true, 10,
  '{"planCode":"vip_69","priceVersion":"2026-08-v2","inviteLimit":20,"supportLevel":"官方支持","pauseGiftDecay":true,"seedance2Access":"enabled","noWatermarkAccess":"enabled","templateLibraryAccess":"全部开放"}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
  gen_random_uuid()::text, 'vip_199_monthly', '专业进阶', 'monthly', 199.00,
  20000, 2000, 100, true, 20,
  '{"planCode":"vip_199","priceVersion":"2026-08-v2","inviteLimit":40,"supportLevel":"官方 24 小时支持","pauseGiftDecay":true,"seedance2Access":"enabled","noWatermarkAccess":"enabled","templateLibraryAccess":"全部开放"}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
  gen_random_uuid()::text, 'vip_599_monthly', '旗舰尊享', 'monthly', 599.00,
  60000, 9000, 150, true, 30,
  '{"planCode":"vip_599","priceVersion":"2026-08-v2","inviteLimit":100,"supportLevel":"CEO 直接支持","pauseGiftDecay":true,"seedance2Access":"enabled","noWatermarkAccess":"enabled","templateLibraryAccess":"全部开放"}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
  gen_random_uuid()::text, 'vip_69_yearly', '日常创作', 'yearly', 662.00,
  84000, 4200, 50, true, 40,
  '{"planCode":"vip_69_yearly","priceVersion":"2026-08-v2","creditIssuanceMode":"yearly_monthly_installments","inviteLimit":20,"supportLevel":"官方支持","pauseGiftDecay":true,"seedance2Access":"enabled","noWatermarkAccess":"enabled","templateLibraryAccess":"全部开放"}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
  gen_random_uuid()::text, 'vip_199_yearly', '专业进阶', 'yearly', 1910.00,
  240000, 24000, 100, true, 50,
  '{"planCode":"vip_199_yearly","priceVersion":"2026-08-v2","creditIssuanceMode":"yearly_monthly_installments","inviteLimit":40,"supportLevel":"官方 24 小时支持","pauseGiftDecay":true,"seedance2Access":"enabled","noWatermarkAccess":"enabled","templateLibraryAccess":"全部开放"}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
  gen_random_uuid()::text, 'vip_599_yearly', '旗舰尊享', 'yearly', 5750.00,
  720000, 108000, 150, true, 60,
  '{"planCode":"vip_599_yearly","priceVersion":"2026-08-v2","creditIssuanceMode":"yearly_monthly_installments","inviteLimit":100,"supportLevel":"CEO 直接支持","pauseGiftDecay":true,"seedance2Access":"enabled","noWatermarkAccess":"enabled","templateLibraryAccess":"全部开放"}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "billingCycle" = EXCLUDED."billingCycle",
  "price" = EXCLUDED."price",
  "monthlyQuotaCredits" = EXCLUDED."monthlyQuotaCredits",
  "signupBonusCredits" = EXCLUDED."signupBonusCredits",
  "dailyGiftCredits" = EXCLUDED."dailyGiftCredits",
  "isActive" = true,
  "sortOrder" = EXCLUDED."sortOrder",
  "metadata" = EXCLUDED."metadata",
  "updatedAt" = CURRENT_TIMESTAMP;
