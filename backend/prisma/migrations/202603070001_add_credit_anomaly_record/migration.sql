-- CreateTable
CREATE TABLE "CreditAnomalyRecord" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayStart" TIMESTAMP(3) NOT NULL,
    "dayLabel" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "maxSingleAmount" INTEGER NOT NULL,
    "transactionCount" INTEGER NOT NULL,
    "sourceBreakdown" JSONB NOT NULL,
    "severity" TEXT NOT NULL,
    "firstTransactionAt" TIMESTAMP(3) NOT NULL,
    "lastTransactionAt" TIMESTAMP(3) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditAnomalyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditAnomalyRecord_accountId_dayStart_key" ON "CreditAnomalyRecord"("accountId", "dayStart");

-- CreateIndex
CREATE INDEX "CreditAnomalyRecord_dayStart_severity_idx" ON "CreditAnomalyRecord"("dayStart", "severity");

-- CreateIndex
CREATE INDEX "CreditAnomalyRecord_userId_dayStart_idx" ON "CreditAnomalyRecord"("userId", "dayStart");

-- CreateIndex
CREATE INDEX "CreditAnomalyRecord_severity_totalAmount_idx" ON "CreditAnomalyRecord"("severity", "totalAmount");

-- AddForeignKey
ALTER TABLE "CreditAnomalyRecord" ADD CONSTRAINT "CreditAnomalyRecord_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CreditAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditAnomalyRecord" ADD CONSTRAINT "CreditAnomalyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
