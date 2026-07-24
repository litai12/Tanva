CREATE TABLE "AnnouncementView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "firstViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnnouncementView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnnouncementView_userId_announcementId_key"
ON "AnnouncementView"("userId", "announcementId");
CREATE INDEX "AnnouncementView_announcementId_idx"
ON "AnnouncementView"("announcementId");
ALTER TABLE "AnnouncementView" ADD CONSTRAINT "AnnouncementView_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
