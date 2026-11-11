-- Mobile web (/m) chat: conversations and messages. Additive only.
CREATE TABLE "MobileConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '新会话',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "MobileConversation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MobileConversation_userId_lastMessageAt_idx" ON "MobileConversation"("userId", "lastMessageAt");

CREATE TABLE "MobileMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "content" TEXT NOT NULL DEFAULT '',
    "attachments" JSONB,
    "jobId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'done',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MobileMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MobileMessage_conversationId_createdAt_idx" ON "MobileMessage"("conversationId", "createdAt");
CREATE INDEX "MobileMessage_jobId_idx" ON "MobileMessage"("jobId");
