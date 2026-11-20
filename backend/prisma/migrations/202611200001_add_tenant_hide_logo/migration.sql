-- 租户级白标开关：开启后隐藏平台 Logo（电脑端与 m 站均不展示）
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "hideLogo" BOOLEAN NOT NULL DEFAULT false;
