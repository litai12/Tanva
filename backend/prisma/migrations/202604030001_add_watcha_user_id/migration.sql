ALTER TABLE "User"
ADD COLUMN "watchaUserId" TEXT;

CREATE UNIQUE INDEX "User_watchaUserId_key"
ON "User"("watchaUserId");
