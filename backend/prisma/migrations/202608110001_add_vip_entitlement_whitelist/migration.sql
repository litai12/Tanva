ALTER TABLE "User"
ADD COLUMN "vipEntitlementWhitelist" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "vipRechargeBonusEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "User_vipEntitlementWhitelist_idx"
ON "User"("vipEntitlementWhitelist");
