-- DropTable
DROP TABLE IF EXISTS "VolcAssetRecord";

-- CreateTable
CREATE TABLE "VolcReviewGroup" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolcReviewGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VolcReviewGroup_date_key" ON "VolcReviewGroup"("date");

-- CreateIndex
CREATE UNIQUE INDEX "VolcReviewGroup_groupId_key" ON "VolcReviewGroup"("groupId");
