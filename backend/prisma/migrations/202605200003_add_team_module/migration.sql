-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "isPersonal" BOOLEAN NOT NULL DEFAULT false,
    "maxSeats" INTEGER NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "creditQuotaMonthly" INTEGER,
    "creditUsedThisCycle" INTEGER NOT NULL DEFAULT 0,
    "quotaCycleStartAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE "TeamInvite" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3),
    "inviterUserId" TEXT NOT NULL,
    "acceptedUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamProjectShare" (
    "projectId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'edit',
    "sharedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamProjectShare_pkey" PRIMARY KEY ("projectId","teamId")
);

-- CreateTable
CREATE TABLE "TeamCreditAccount" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "frozenBalance" INTEGER NOT NULL DEFAULT 0,
    "totalEarned" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamCreditAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamCreditLot" (
    "id" TEXT NOT NULL,
    "teamCreditAccId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "sourceRefId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamCreditLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamCreditLedger" (
    "id" TEXT NOT NULL,
    "teamAccId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "taskId" TEXT,
    "taskKind" TEXT,
    "actorUserId" TEXT,
    "note" TEXT,
    "reserveExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamCreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamSubscriptionPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "priceMonthlyFen" INTEGER NOT NULL,
    "priceAnnualFen" INTEGER NOT NULL,
    "creditsPerSeatPerMonth" INTEGER NOT NULL,
    "maxSeats" INTEGER NOT NULL DEFAULT 100,
    "minSeats" INTEGER NOT NULL DEFAULT 1,
    "features" JSONB NOT NULL DEFAULT '{}',
    "sortWeight" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamSubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamSubscription" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL DEFAULT 'monthly',
    "seatCount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "nextCreditRenewalAt" TIMESTAMP(3) NOT NULL,
    "lastRenewedAt" TIMESTAMP(3),
    "creditsPerRenewal" INTEGER NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Team_ownerId_isPersonal_idx" ON "Team"("ownerId", "isPersonal");

-- CreateIndex
CREATE INDEX "TeamMembership_userId_idx" ON "TeamMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvite_code_key" ON "TeamInvite"("code");

-- CreateIndex
CREATE INDEX "TeamInvite_teamId_status_idx" ON "TeamInvite"("teamId", "status");

-- CreateIndex
CREATE INDEX "TeamProjectShare_teamId_idx" ON "TeamProjectShare"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamCreditAccount_teamId_key" ON "TeamCreditAccount"("teamId");

-- CreateIndex
CREATE INDEX "TeamCreditLot_teamCreditAccId_expiresAt_idx" ON "TeamCreditLot"("teamCreditAccId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamCreditLedger_teamAccId_entryType_taskId_key" ON "TeamCreditLedger"("teamAccId", "entryType", "taskId");

-- CreateIndex
CREATE INDEX "TeamCreditLedger_entryType_reserveExpiresAt_idx" ON "TeamCreditLedger"("entryType", "reserveExpiresAt");

-- CreateIndex
CREATE INDEX "TeamSubscription_nextCreditRenewalAt_status_idx" ON "TeamSubscription"("nextCreditRenewalAt", "status");

-- CreateIndex
CREATE INDEX "TeamSubscription_teamId_status_idx" ON "TeamSubscription"("teamId", "status");

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamProjectShare" ADD CONSTRAINT "TeamProjectShare_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamProjectShare" ADD CONSTRAINT "TeamProjectShare_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCreditAccount" ADD CONSTRAINT "TeamCreditAccount_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCreditLot" ADD CONSTRAINT "TeamCreditLot_teamCreditAccId_fkey" FOREIGN KEY ("teamCreditAccId") REFERENCES "TeamCreditAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCreditLedger" ADD CONSTRAINT "TeamCreditLedger_teamAccId_fkey" FOREIGN KEY ("teamAccId") REFERENCES "TeamCreditAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSubscription" ADD CONSTRAINT "TeamSubscription_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSubscription" ADD CONSTRAINT "TeamSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TeamSubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
