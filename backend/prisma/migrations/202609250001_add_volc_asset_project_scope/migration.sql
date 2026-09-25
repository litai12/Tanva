-- Preserve the project that owns each Ark asset group. Existing records were
-- created in the default project, so the new columns default to "default".
ALTER TABLE "VolcReviewGroup"
  ADD COLUMN "projectName" TEXT NOT NULL DEFAULT 'default';

ALTER TABLE "VolcTaskAssetGroup"
  ADD COLUMN "projectName" TEXT NOT NULL DEFAULT 'default';

ALTER TABLE "BioAuthGroup"
  ADD COLUMN "projectName" TEXT NOT NULL DEFAULT 'default';

-- Review groups can now have one row per date and project. Keep groupId unique.
DROP INDEX IF EXISTS "VolcReviewGroup_date_key";

CREATE UNIQUE INDEX "VolcReviewGroup_date_projectName_key"
  ON "VolcReviewGroup"("date", "projectName");
