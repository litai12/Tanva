-- CreateTable
CREATE TABLE "ImageTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "prompt" TEXT NOT NULL,
    "requestData" JSONB,
    "imageUrl" TEXT,
    "thumbnailUrl" TEXT,
    "textResponse" TEXT,
    "error" TEXT,
    "aiProvider" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImageTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImageTask_userId_createdAt_idx" ON "ImageTask"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ImageTask_status_createdAt_idx" ON "ImageTask"("status", "createdAt");
