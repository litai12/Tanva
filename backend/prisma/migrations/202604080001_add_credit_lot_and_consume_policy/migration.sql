-- AlterTable
ALTER TABLE "CreditTransaction" ADD COLUMN     "consumePolicyCode" TEXT,
ADD COLUMN     "consumePolicyVersion" INTEGER,
ADD COLUMN     "creditLotId" TEXT;

-- CreateTable
CREATE TABLE "CreditLot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "validityType" TEXT NOT NULL,
    "scopeType" TEXT DEFAULT 'global',
    "scopeValue" TEXT,
    "totalAmount" INTEGER NOT NULL,
    "remainingAmount" INTEGER NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "durationDays" INTEGER,
    "subscriptionId" TEXT,
    "orderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditConsumePolicy" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'global',
    "scopeValue" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sorts" JSONB NOT NULL,
    "validityPriority" JSONB NOT NULL,
    "sourcePriority" JSONB NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditConsumePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditLot_accountId_status_expiresAt_idx" ON "CreditLot"("accountId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "CreditLot_accountId_validityType_status_idx" ON "CreditLot"("accountId", "validityType", "status");

-- CreateIndex
CREATE INDEX "CreditLot_scopeType_scopeValue_status_idx" ON "CreditLot"("scopeType", "scopeValue", "status");

-- CreateIndex
CREATE INDEX "CreditLot_subscriptionId_idx" ON "CreditLot"("subscriptionId");

-- CreateIndex
CREATE INDEX "CreditLot_orderId_idx" ON "CreditLot"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditConsumePolicy_code_key" ON "CreditConsumePolicy"("code");

-- CreateIndex
CREATE INDEX "CreditConsumePolicy_scopeType_scopeValue_isActive_idx" ON "CreditConsumePolicy"("scopeType", "scopeValue", "isActive");

-- CreateIndex
CREATE INDEX "CreditTransaction_creditLotId_createdAt_idx" ON "CreditTransaction"("creditLotId", "createdAt");

-- Seed default consume policy
INSERT INTO "CreditConsumePolicy" (
    "id",
    "code",
    "scopeType",
    "scopeValue",
    "isActive",
    "version",
    "sorts",
    "validityPriority",
    "sourcePriority",
    "description",
    "createdAt",
    "updatedAt"
) VALUES (
    gen_random_uuid()::text,
    'global_default',
    'global',
    NULL,
    true,
    1,
    '["scope_specificity_desc","validity_priority_asc","expires_at_asc_nulls_last","source_priority_asc","granted_at_asc","custom_priority_asc"]'::jsonb,
    '{"membership_bound":10,"fixed_window":20,"permanent":30}'::jsonb,
    '{"promo":10,"gift":20,"manual":25,"subscription":30,"recharge":40}'::jsonb,
    'Default lot consume policy',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_creditLotId_fkey" FOREIGN KEY ("creditLotId") REFERENCES "CreditLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLot" ADD CONSTRAINT "CreditLot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CreditAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
