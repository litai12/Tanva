ALTER TABLE "ApiUsageRecord"
  ADD COLUMN "consumptionStatus" TEXT,
  ADD COLUMN "consumptionEventId" TEXT,
  ADD COLUMN "consumptionReceipt" JSONB,
  ADD COLUMN "consumptionNextCheckAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "ApiUsageRecord_consumptionEventId_key" ON "ApiUsageRecord"("consumptionEventId");
CREATE INDEX "ApiUsageRecord_consumptionStatus_consumptionNextCheckAt_idx" ON "ApiUsageRecord"("consumptionStatus", "consumptionNextCheckAt");
