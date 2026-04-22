-- CreateTable
CREATE TABLE "VolcAssetRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolcAssetRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VolcAssetRecord_assetId_key" ON "VolcAssetRecord"("assetId");

-- CreateIndex
CREATE INDEX "VolcAssetRecord_expiresAt_deletedAt_idx" ON "VolcAssetRecord"("expiresAt", "deletedAt");

-- CreateIndex
CREATE INDEX "VolcAssetRecord_userId_createdAt_idx" ON "VolcAssetRecord"("userId", "createdAt");
