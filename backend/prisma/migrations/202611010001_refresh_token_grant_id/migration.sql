-- OAuth (MCP / external agent) grants: rotated sessions of one authorization share a grantId.
ALTER TABLE "RefreshToken" ADD COLUMN "grantId" TEXT;
CREATE INDEX "RefreshToken_grantId_idx" ON "RefreshToken"("grantId");
