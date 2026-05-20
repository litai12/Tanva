-- Add nodeId to ImageTask
ALTER TABLE "ImageTask" ADD COLUMN IF NOT EXISTS "nodeId" TEXT;
CREATE INDEX IF NOT EXISTS "ImageTask_nodeId_idx" ON "ImageTask"("nodeId");

-- Create VideoTask table
CREATE TABLE IF NOT EXISTS "VideoTask" (
  "id"          TEXT        NOT NULL,
  "userId"      TEXT        NOT NULL,
  "nodeId"      TEXT,
  "status"      TEXT        NOT NULL DEFAULT 'queued',
  "taskType"    TEXT        NOT NULL,
  "prompt"      TEXT,
  "result"      JSONB,
  "error"       TEXT,
  "metadata"    JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "VideoTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VideoTask_nodeId_idx"            ON "VideoTask"("nodeId");
CREATE INDEX IF NOT EXISTS "VideoTask_userId_createdAt_idx"  ON "VideoTask"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "VideoTask_status_updatedAt_idx"  ON "VideoTask"("status", "updatedAt");
