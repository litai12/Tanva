-- One isolated Ark asset group per Seedance generation task. The group remains
-- available while the async video task runs and is deleted on terminal status.
CREATE TABLE IF NOT EXISTS "VolcTaskAssetGroup" (
  "id"        TEXT         NOT NULL,
  "groupId"   TEXT         NOT NULL,
  "taskId"    TEXT,
  "status"    TEXT         NOT NULL DEFAULT 'preparing',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastError" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VolcTaskAssetGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VolcTaskAssetGroup_groupId_key"
  ON "VolcTaskAssetGroup"("groupId");

CREATE UNIQUE INDEX IF NOT EXISTS "VolcTaskAssetGroup_taskId_key"
  ON "VolcTaskAssetGroup"("taskId");

CREATE INDEX IF NOT EXISTS "VolcTaskAssetGroup_status_expiresAt_idx"
  ON "VolcTaskAssetGroup"("status", "expiresAt");
