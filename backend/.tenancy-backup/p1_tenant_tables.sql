CREATE TABLE IF NOT EXISTS "Tenant" (
  "id" TEXT PRIMARY KEY,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "isPlatform" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_slug_key" ON "Tenant"("slug");
CREATE INDEX IF NOT EXISTS "Tenant_status_idx" ON "Tenant"("status");

CREATE TABLE IF NOT EXISTS "TenantDomain" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "TenantDomain_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TenantDomain_host_key" ON "TenantDomain"("host");
CREATE INDEX IF NOT EXISTS "TenantDomain_tenantId_idx" ON "TenantDomain"("tenantId");

INSERT INTO "Tenant" ("id","slug","name","status","isPlatform","createdAt","updatedAt")
VALUES ('default','platform','主站','active',true,now(),now())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "TenantDomain" ("id","tenantId","host","isPrimary","verified","createdAt")
VALUES (gen_random_uuid(),'default','tanvas.cn',true,true,now())
ON CONFLICT ("host") DO NOTHING;
