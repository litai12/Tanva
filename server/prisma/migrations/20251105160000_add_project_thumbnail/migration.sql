-- Add optional thumbnail URL for project previews
ALTER TABLE "Project"
ADD COLUMN "thumbnailUrl" TEXT;
