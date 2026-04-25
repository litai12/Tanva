-- CreateTable
CREATE TABLE "BioAuthGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BioAuthGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BioAuthGroup_groupId_key" ON "BioAuthGroup"("groupId");

-- CreateIndex
CREATE INDEX "BioAuthGroup_userId_createdAt_idx" ON "BioAuthGroup"("userId", "createdAt");
