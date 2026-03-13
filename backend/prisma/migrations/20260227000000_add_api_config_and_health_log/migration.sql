-- CreateTable
CREATE TABLE "ApiConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "endpoint" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT NOT NULL DEFAULT 'other',
    "apiProtocol" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiHealthLog" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "errorDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkType" TEXT NOT NULL DEFAULT 'PING',
    "e2eDuration" INTEGER,
    "e2eMediaUrl" TEXT,

    CONSTRAINT "ApiHealthLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiConfig_provider_key" ON "ApiConfig"("provider");

-- CreateIndex
CREATE INDEX "ApiConfig_provider_idx" ON "ApiConfig"("provider");

-- CreateIndex
CREATE INDEX "ApiConfig_enabled_idx" ON "ApiConfig"("enabled");

-- CreateIndex
CREATE INDEX "ApiHealthLog_provider_createdAt_idx" ON "ApiHealthLog"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "ApiHealthLog_createdAt_idx" ON "ApiHealthLog"("createdAt");

-- CreateIndex
CREATE INDEX "ApiHealthLog_checkType_idx" ON "ApiHealthLog"("checkType");
