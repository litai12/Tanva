INSERT INTO "TenantDomain" ("id","tenantId","host","isPrimary","verified","createdAt")
VALUES (gen_random_uuid(),'default','www.tanvas.cn',false,true,now()) ON CONFLICT ("host") DO NOTHING;
INSERT INTO "TenantDomain" ("id","tenantId","host","isPrimary","verified","createdAt")
VALUES (gen_random_uuid(),'default','localhost',false,true,now()) ON CONFLICT ("host") DO NOTHING;
