-- AlterTable
ALTER TABLE "CreditAccount" ADD COLUMN     "consecutiveDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastCheckInDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CreditTransaction" ADD COLUMN     "expiredAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "isExpired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "InvitationRedemption" ADD COLUMN     "rewardAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rewardStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "rewardedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "noWatermark" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "NodeConfig" (
    "id" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "status" TEXT NOT NULL DEFAULT 'normal',
    "statusMessage" TEXT,
    "creditsPerCall" INTEGER NOT NULL DEFAULT 0,
    "priceYuan" DECIMAL(10,2),
    "serviceType" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NodeConfig_nodeKey_key" ON "NodeConfig"("nodeKey");

-- CreateIndex
CREATE INDEX "NodeConfig_category_sortOrder_idx" ON "NodeConfig"("category", "sortOrder");

-- CreateIndex
CREATE INDEX "NodeConfig_status_idx" ON "NodeConfig"("status");

-- CreateIndex
CREATE INDEX "CreditTransaction_expiresAt_isExpired_idx" ON "CreditTransaction"("expiresAt", "isExpired");

-- CreateIndex
CREATE INDEX "InvitationRedemption_inviterUserId_idx" ON "InvitationRedemption"("inviterUserId");
