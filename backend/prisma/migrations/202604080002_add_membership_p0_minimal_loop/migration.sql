-- AlterTable
ALTER TABLE "CreditTransaction"
ADD COLUMN     "businessType" TEXT,
ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "subscriptionId" TEXT,
ADD COLUMN     "membershipPlanId" TEXT;

-- AlterTable
ALTER TABLE "PaymentOrder"
ADD COLUMN     "orderType" TEXT NOT NULL DEFAULT 'recharge',
ADD COLUMN     "businessCode" TEXT,
ADD COLUMN     "membershipPlanId" TEXT,
ADD COLUMN     "subscriptionId" TEXT,
ADD COLUMN     "planSnapshot" JSONB;

-- CreateTable
CREATE TABLE "MembershipPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "monthlyQuotaCredits" INTEGER NOT NULL DEFAULT 0,
    "signupBonusCredits" INTEGER NOT NULL DEFAULT 0,
    "dailyGiftCredits" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMembershipSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipPlanId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "periodType" TEXT NOT NULL,
    "currentPeriodStartAt" TIMESTAMP(3) NOT NULL,
    "currentPeriodEndAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "renewalCount" INTEGER NOT NULL DEFAULT 0,
    "lastOrderId" TEXT,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMembershipSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipEntitlementSnapshot" (
    "userId" TEXT NOT NULL,
    "currentPlanCode" TEXT NOT NULL DEFAULT 'free',
    "membershipStatus" TEXT NOT NULL DEFAULT 'inactive',
    "currentPeriodStartAt" TIMESTAMP(3),
    "currentPeriodEndAt" TIMESTAMP(3),
    "pauseGiftDecay" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipEntitlementSnapshot_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPlan_code_key" ON "MembershipPlan"("code");

-- CreateIndex
CREATE INDEX "MembershipPlan_isActive_sortOrder_idx" ON "MembershipPlan"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "UserMembershipSubscription_userId_status_idx" ON "UserMembershipSubscription"("userId", "status");

-- CreateIndex
CREATE INDEX "UserMembershipSubscription_membershipPlanId_status_idx" ON "UserMembershipSubscription"("membershipPlanId", "status");

-- CreateIndex
CREATE INDEX "UserMembershipSubscription_currentPeriodEndAt_status_idx" ON "UserMembershipSubscription"("currentPeriodEndAt", "status");

-- CreateIndex
CREATE INDEX "CreditTransaction_businessType_createdAt_idx" ON "CreditTransaction"("businessType", "createdAt");

-- CreateIndex
CREATE INDEX "CreditTransaction_subscriptionId_createdAt_idx" ON "CreditTransaction"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditTransaction_membershipPlanId_createdAt_idx" ON "CreditTransaction"("membershipPlanId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentOrder_orderType_status_idx" ON "PaymentOrder"("orderType", "status");

-- Seed membership plans
INSERT INTO "MembershipPlan" (
    "id",
    "code",
    "name",
    "billingCycle",
    "price",
    "monthlyQuotaCredits",
    "signupBonusCredits",
    "dailyGiftCredits",
    "isActive",
    "sortOrder",
    "metadata",
    "createdAt",
    "updatedAt"
) VALUES
(
    gen_random_uuid()::text,
    'vip_69_monthly',
    'VIP 69 月卡',
    'monthly',
    69.00,
    7000,
    350,
    50,
    true,
    10,
    '{"planCode":"vip_69","pauseGiftDecay":true}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    gen_random_uuid()::text,
    'vip_199_monthly',
    'VIP 199 月卡',
    'monthly',
    199.00,
    20000,
    2000,
    100,
    true,
    20,
    '{"planCode":"vip_199","pauseGiftDecay":true}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    gen_random_uuid()::text,
    'vip_599_monthly',
    'VIP 599 月卡',
    'monthly',
    599.00,
    60000,
    9000,
    200,
    true,
    30,
    '{"planCode":"vip_599","pauseGiftDecay":true}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
