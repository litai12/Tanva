ALTER TABLE "User" ADD COLUMN "seedance2AccessWhitelist" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "User_seedance2AccessWhitelist_idx" ON "User"("seedance2AccessWhitelist");
