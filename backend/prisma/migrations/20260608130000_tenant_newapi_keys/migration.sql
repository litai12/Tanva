-- 子租户独立 new-api 三组 key（普通/VIP/SVIP），可空，空则回落平台 env key
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "newApiKey" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "newApiKeyVip" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "newApiKeySvip" TEXT;
