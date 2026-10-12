CREATE TABLE "EnterpriseKnowledgeDocument" (
 "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "teamId" TEXT,
 "title" TEXT NOT NULL, "summary" TEXT NOT NULL, "tags" JSONB NOT NULL, "origin" JSONB NOT NULL,
 "enterpriseName" TEXT, "category" TEXT, "content" TEXT NOT NULL,
 "sha256" TEXT NOT NULL, "bytes" INTEGER NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
 "deletedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "EnterpriseKnowledgeDocument_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "EnterpriseKnowledgeDocument_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "EnterpriseKnowledgeDocument_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "EnterpriseKnowledgeRevision" (
 "id" TEXT NOT NULL, "documentId" TEXT NOT NULL, "version" INTEGER NOT NULL,
 "snapshot" JSONB NOT NULL, "actorId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "EnterpriseKnowledgeRevision_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "EnterpriseKnowledgeRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EnterpriseKnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "enterprise_knowledge_owner_space_idx" ON "EnterpriseKnowledgeDocument"("ownerId", "teamId", "deletedAt", "updatedAt");
CREATE INDEX "enterprise_knowledge_team_category_idx" ON "EnterpriseKnowledgeDocument"("teamId", "deletedAt", "enterpriseName", "category");
CREATE UNIQUE INDEX "EnterpriseKnowledgeRevision_documentId_version_key" ON "EnterpriseKnowledgeRevision"("documentId", "version");
