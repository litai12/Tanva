-- AlterTable: add teamId to PaymentOrder
ALTER TABLE "PaymentOrder" ADD COLUMN "teamId" TEXT;

-- CreateTable: TeamSeatPackage
CREATE TABLE "TeamSeatPackage" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "paymentOrderId" TEXT,
    "seats" INTEGER NOT NULL,
    "cycle" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamSeatPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamSeatPackage_paymentOrderId_key" ON "TeamSeatPackage"("paymentOrderId");

-- CreateIndex
CREATE INDEX "TeamSeatPackage_teamId_status_expiresAt_idx" ON "TeamSeatPackage"("teamId", "status", "expiresAt");

-- AddForeignKey
ALTER TABLE "TeamSeatPackage" ADD CONSTRAINT "TeamSeatPackage_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
