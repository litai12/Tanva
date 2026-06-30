-- CreateTable
CREATE TABLE "MaterialAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "teamId" TEXT,
    "folderId" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialFolder" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "teamId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialFolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialAsset_ownerId_teamId_kind_updatedAt_idx" ON "MaterialAsset"("ownerId", "teamId", "kind", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "MaterialAsset_teamId_kind_updatedAt_idx" ON "MaterialAsset"("teamId", "kind", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "MaterialAsset_folderId_idx" ON "MaterialAsset"("folderId");

-- CreateIndex
CREATE INDEX "MaterialFolder_ownerId_idx" ON "MaterialFolder"("ownerId");

-- CreateIndex
CREATE INDEX "MaterialFolder_teamId_idx" ON "MaterialFolder"("teamId");
