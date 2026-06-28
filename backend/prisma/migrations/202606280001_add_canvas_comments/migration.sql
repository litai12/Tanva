-- CanvasCommentThread / CanvasComment：节点评论（Figma 式，锚定到节点）
CREATE TABLE IF NOT EXISTS "CanvasCommentThread" (
  "id"           TEXT         NOT NULL,
  "projectId"    TEXT         NOT NULL,
  "nodeId"       TEXT         NOT NULL,
  "resolved"     BOOLEAN      NOT NULL DEFAULT false,
  "resolvedAt"   TIMESTAMP(3),
  "resolvedById" TEXT,
  "createdById"  TEXT         NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CanvasCommentThread_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CanvasCommentThread_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CanvasCommentThread_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CanvasCommentThread_projectId_nodeId_idx"
  ON "CanvasCommentThread"("projectId", "nodeId");
CREATE INDEX IF NOT EXISTS "CanvasCommentThread_projectId_resolved_idx"
  ON "CanvasCommentThread"("projectId", "resolved");

CREATE TABLE IF NOT EXISTS "CanvasComment" (
  "id"        TEXT         NOT NULL,
  "threadId"  TEXT         NOT NULL,
  "authorId"  TEXT         NOT NULL,
  "body"      TEXT         NOT NULL,
  "mentions"  TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CanvasComment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CanvasComment_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "CanvasCommentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CanvasComment_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CanvasComment_threadId_createdAt_idx"
  ON "CanvasComment"("threadId", "createdAt");
CREATE INDEX IF NOT EXISTS "CanvasComment_authorId_idx"
  ON "CanvasComment"("authorId");
