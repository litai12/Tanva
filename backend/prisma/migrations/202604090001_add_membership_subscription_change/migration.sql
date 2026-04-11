-- CreateTable
CREATE TABLE "MembershipSubscriptionChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentSubscriptionId" TEXT,
    "targetPlanId" TEXT NOT NULL,
    "targetPlanCode" TEXT NOT NULL,
    "targetBillingCycle" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "effectiveMode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "reason" TEXT,
    "orderId" TEXT,
    "requestedBy" TEXT,
    "currentPeriodEndAt" TIMESTAMP(3),
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "MembershipSubscriptionChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipSubscriptionChange_userId_status_effectiveAt_idx" ON "MembershipSubscriptionChange"("userId", "status", "effectiveAt");

-- CreateIndex
CREATE INDEX "MembershipSubscriptionChange_currentSubscriptionId_status_idx" ON "MembershipSubscriptionChange"("currentSubscriptionId", "status");

-- CreateIndex
CREATE INDEX "MembershipSubscriptionChange_targetPlanId_status_idx" ON "MembershipSubscriptionChange"("targetPlanId", "status");
