-- 租户首页模板：default = 平台默认首页；newway = NewWay 官网宣发页
ALTER TABLE "Tenant" ADD COLUMN "homepage" TEXT NOT NULL DEFAULT 'default';
