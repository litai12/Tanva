-- 会员套餐按租户隔离：MembershipPlan 加 tenantId，code 唯一改为 (tenantId, code) 复合唯一。
-- 必须与移除 TENANT_GLOBAL_MODELS 白名单的代码同批发布，否则旧代码仍把该表当全局表读写。

ALTER TABLE "MembershipPlan" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';

DROP INDEX IF EXISTS "MembershipPlan_code_key";
DROP INDEX IF EXISTS "MembershipPlan_isActive_sortOrder_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "MembershipPlan_tenantId_code_key" ON "MembershipPlan"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "MembershipPlan_tenantId_isActive_sortOrder_idx" ON "MembershipPlan"("tenantId", "isActive", "sortOrder");

-- 回填：为已存在的非主站租户克隆一份主站套餐（幂等：已有同 code 套餐的租户跳过）。
-- 新建租户由 TenantAdminService.createTenant 在代码里克隆，这里只兜底存量租户。
INSERT INTO "MembershipPlan"
  ("id", "tenantId", "code", "name", "billingCycle", "price",
   "monthlyQuotaCredits", "signupBonusCredits", "dailyGiftCredits",
   "isActive", "sortOrder", "metadata", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(), t."id", p."code", p."name", p."billingCycle", p."price",
  p."monthlyQuotaCredits", p."signupBonusCredits", p."dailyGiftCredits",
  p."isActive", p."sortOrder", p."metadata", NOW(), NOW()
FROM "Tenant" t
CROSS JOIN "MembershipPlan" p
WHERE t."id" <> 'default'
  AND p."tenantId" = 'default'
  AND NOT EXISTS (
    SELECT 1 FROM "MembershipPlan" x
    WHERE x."tenantId" = t."id" AND x."code" = p."code"
  );
