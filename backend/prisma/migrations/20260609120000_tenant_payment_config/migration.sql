-- 子租户独立支付商户配置（微信/支付宝），全部可空，空则逐渠道回落平台 env。
-- 明文(非密)：商户号 / appid / 证书序列号
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "wechatAppId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "wechatMchId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "wechatSerialNo" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "alipayAppId" TEXT;
-- 密文(AES-256-GCM，utils/secret-crypto)：私钥 / 证书 / APIv3 key
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "wechatPrivateKeyEnc" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "wechatCertificateEnc" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "wechatApiV3KeyEnc" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "alipayPrivateKeyEnc" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "alipayPublicKeyEnc" TEXT;
