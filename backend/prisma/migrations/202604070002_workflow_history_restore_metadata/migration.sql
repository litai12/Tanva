-- AlterTable
ALTER TABLE "WorkflowHistory"
ADD COLUMN "restoredFromUpdatedAt" TIMESTAMP(3),
ADD COLUMN "restoredFromVersion" INTEGER;
