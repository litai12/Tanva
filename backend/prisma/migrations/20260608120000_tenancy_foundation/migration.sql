-- 租户基座（Tenancy Foundation）
-- 注意：本仓库目标库通过 prisma db execute 增量应用(漂移库不能 migrate dev)，
-- 此文件经 'prisma migrate resolve --applied' 登记为已应用；新环境 migrate deploy 时按此执行。

-- ===== 阶段A: 租户表 + 主站种子 =====
CREATE TABLE IF NOT EXISTS "Tenant" (
  "id" TEXT PRIMARY KEY,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "isPlatform" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_slug_key" ON "Tenant"("slug");
CREATE INDEX IF NOT EXISTS "Tenant_status_idx" ON "Tenant"("status");

CREATE TABLE IF NOT EXISTS "TenantDomain" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "TenantDomain_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TenantDomain_host_key" ON "TenantDomain"("host");
CREATE INDEX IF NOT EXISTS "TenantDomain_tenantId_idx" ON "TenantDomain"("tenantId");

INSERT INTO "Tenant" ("id","slug","name","status","isPlatform","createdAt","updatedAt")
VALUES ('default','platform','主站','active',true,now(),now())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "TenantDomain" ("id","tenantId","host","isPrimary","verified","createdAt")
VALUES (gen_random_uuid(),'default','tanvas.cn',true,true,now())
ON CONFLICT ("host") DO NOTHING;

-- ===== 阶段A': 额外域名(www/localhost) =====
INSERT INTO "TenantDomain" ("id","tenantId","host","isPrimary","verified","createdAt")
VALUES (gen_random_uuid(),'default','www.tanvas.cn',false,true,now()) ON CONFLICT ("host") DO NOTHING;
INSERT INTO "TenantDomain" ("id","tenantId","host","isPrimary","verified","createdAt")
VALUES (gen_random_uuid(),'default','localhost',false,true,now()) ON CONFLICT ("host") DO NOTHING;

-- ===== 阶段B: 业务表加 tenantId + User 复合唯一 =====
-- P2: add tenantId to tenant-scoped tables (additive, constant default = no full rewrite)
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "Project_tenantId_idx" ON "Project"("tenantId");
ALTER TABLE "WorkflowHistory" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "WorkflowHistory_tenantId_idx" ON "WorkflowHistory"("tenantId");
ALTER TABLE "UserTemplate" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "UserTemplate_tenantId_idx" ON "UserTemplate"("tenantId");
ALTER TABLE "GlobalImageHistory" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "GlobalImageHistory_tenantId_idx" ON "GlobalImageHistory"("tenantId");
ALTER TABLE "CreditAccount" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "CreditAccount_tenantId_idx" ON "CreditAccount"("tenantId");
ALTER TABLE "CreditTransaction" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "CreditTransaction_tenantId_idx" ON "CreditTransaction"("tenantId");
ALTER TABLE "CreditLot" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "CreditLot_tenantId_idx" ON "CreditLot"("tenantId");
ALTER TABLE "CreditAnomalyRecord" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "CreditAnomalyRecord_tenantId_idx" ON "CreditAnomalyRecord"("tenantId");
ALTER TABLE "ApiUsageRecord" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "ApiUsageRecord_tenantId_idx" ON "ApiUsageRecord"("tenantId");
ALTER TABLE "UserMembershipSubscription" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "UserMembershipSubscription_tenantId_idx" ON "UserMembershipSubscription"("tenantId");
ALTER TABLE "MembershipSubscriptionChange" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "MembershipSubscriptionChange_tenantId_idx" ON "MembershipSubscriptionChange"("tenantId");
ALTER TABLE "MembershipEntitlementSnapshot" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "MembershipEntitlementSnapshot_tenantId_idx" ON "MembershipEntitlementSnapshot"("tenantId");
ALTER TABLE "InvitationCode" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "InvitationCode_tenantId_idx" ON "InvitationCode"("tenantId");
ALTER TABLE "InvitationRedemption" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "InvitationRedemption_tenantId_idx" ON "InvitationRedemption"("tenantId");
ALTER TABLE "PaymentOrder" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "PaymentOrder_tenantId_idx" ON "PaymentOrder"("tenantId");
ALTER TABLE "ImageTask" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "ImageTask_tenantId_idx" ON "ImageTask"("tenantId");
ALTER TABLE "VideoTask" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "VideoTask_tenantId_idx" ON "VideoTask"("tenantId");
ALTER TABLE "WechatLoginSession" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "WechatLoginSession_tenantId_idx" ON "WechatLoginSession"("tenantId");
ALTER TABLE "RefreshToken" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "RefreshToken_tenantId_idx" ON "RefreshToken"("tenantId");
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "Team_tenantId_idx" ON "Team"("tenantId");
ALTER TABLE "TeamMembership" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "TeamMembership_tenantId_idx" ON "TeamMembership"("tenantId");
ALTER TABLE "TeamInvite" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "TeamInvite_tenantId_idx" ON "TeamInvite"("tenantId");
ALTER TABLE "TeamProjectShare" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "TeamProjectShare_tenantId_idx" ON "TeamProjectShare"("tenantId");
ALTER TABLE "TeamCreditAccount" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "TeamCreditAccount_tenantId_idx" ON "TeamCreditAccount"("tenantId");
ALTER TABLE "TeamCreditLot" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "TeamCreditLot_tenantId_idx" ON "TeamCreditLot"("tenantId");
ALTER TABLE "TeamCreditLedger" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "TeamCreditLedger_tenantId_idx" ON "TeamCreditLedger"("tenantId");
ALTER TABLE "TeamSeatPackage" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "TeamSeatPackage_tenantId_idx" ON "TeamSeatPackage"("tenantId");
ALTER TABLE "TeamSubscriptionPlan" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "TeamSubscriptionPlan_tenantId_idx" ON "TeamSubscriptionPlan"("tenantId");
ALTER TABLE "TeamSubscription" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "TeamSubscription_tenantId_idx" ON "TeamSubscription"("tenantId");
ALTER TABLE "BioAuthGroup" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "BioAuthGroup_tenantId_idx" ON "BioAuthGroup"("tenantId");

-- User tenantId + composite uniques
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE UNIQUE INDEX IF NOT EXISTS "User_tenantId_phone_key" ON "User"("tenantId","phone");
CREATE UNIQUE INDEX IF NOT EXISTS "User_tenantId_email_key" ON "User"("tenantId","email");
CREATE UNIQUE INDEX IF NOT EXISTS "User_tenantId_watchaUserId_key" ON "User"("tenantId","watchaUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "User_tenantId_wechatOfficialOpenId_key" ON "User"("tenantId","wechatOfficialOpenId");
CREATE UNIQUE INDEX IF NOT EXISTS "User_tenantId_wechatUnionId_key" ON "User"("tenantId","wechatUnionId");
CREATE INDEX IF NOT EXISTS "User_tenantId_phone_status_idx" ON "User"("tenantId","phone","status");
DROP INDEX IF EXISTS "User_phone_key";
DROP INDEX IF EXISTS "User_email_key";
DROP INDEX IF EXISTS "User_watchaUserId_key";
DROP INDEX IF EXISTS "User_wechatOfficialOpenId_key";
DROP INDEX IF EXISTS "User_wechatUnionId_key";
