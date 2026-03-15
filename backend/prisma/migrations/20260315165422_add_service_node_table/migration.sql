-- CreateTable
CREATE TABLE "ServiceNode" (
    "id" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "creditsPerCall" INTEGER NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceNode_serviceType_key" ON "ServiceNode"("serviceType");

-- CreateIndex
CREATE INDEX "ServiceNode_enabled_idx" ON "ServiceNode"("enabled");
