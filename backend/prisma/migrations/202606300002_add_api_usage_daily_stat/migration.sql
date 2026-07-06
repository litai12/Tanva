-- CreateTable: API 用量按天预聚合表（rollup）
CREATE TABLE "ApiUsageDailyStat" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "responseStatus" TEXT NOT NULL,
    "totalCalls" INTEGER NOT NULL DEFAULT 0,
    "totalCredits" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "sumProcessTime" BIGINT NOT NULL DEFAULT 0,
    "procTimeCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiUsageDailyStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 唯一聚合键（rollup upsert 的 ON CONFLICT 目标）
CREATE UNIQUE INDEX "ApiUsageDailyStat_grain_key" ON "ApiUsageDailyStat"("day", "userId", "serviceType", "serviceName", "provider", "responseStatus");

-- CreateIndex
CREATE INDEX "ApiUsageDailyStat_day_serviceType_idx" ON "ApiUsageDailyStat"("day", "serviceType");

-- CreateIndex
CREATE INDEX "ApiUsageDailyStat_day_userId_idx" ON "ApiUsageDailyStat"("day", "userId");
