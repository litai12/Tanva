ALTER TABLE "User"
ADD COLUMN "wechatOfficialOpenId" TEXT,
ADD COLUMN "wechatUnionId" TEXT;

CREATE UNIQUE INDEX "User_wechatOfficialOpenId_key" ON "User"("wechatOfficialOpenId");
CREATE UNIQUE INDEX "User_wechatUnionId_key" ON "User"("wechatUnionId");
CREATE INDEX "User_wechatUnionId_idx" ON "User"("wechatUnionId");

CREATE TABLE "WechatLoginSession" (
  "id" TEXT NOT NULL,
  "sceneKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "returnTo" TEXT NOT NULL DEFAULT '/app',
  "qrTicket" TEXT,
  "qrCodeUrl" TEXT,
  "openId" TEXT,
  "unionId" TEXT,
  "userId" TEXT,
  "authorizedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WechatLoginSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WechatLoginSession_sceneKey_key" ON "WechatLoginSession"("sceneKey");
CREATE INDEX "WechatLoginSession_status_expiresAt_idx" ON "WechatLoginSession"("status", "expiresAt");
CREATE INDEX "WechatLoginSession_userId_createdAt_idx" ON "WechatLoginSession"("userId", "createdAt" DESC);
CREATE INDEX "WechatLoginSession_openId_idx" ON "WechatLoginSession"("openId");

ALTER TABLE "WechatLoginSession"
ADD CONSTRAINT "WechatLoginSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
