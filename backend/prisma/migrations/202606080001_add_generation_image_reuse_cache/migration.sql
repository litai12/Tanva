-- First-pass text-to-image reuse cache.
-- Assets are user-scoped; reuse claims track which generated assets a user has already received.

CREATE TABLE IF NOT EXISTS "GenerationImageAsset" (
  "id"               TEXT         NOT NULL,
  "userId"           TEXT         NOT NULL,
  "requestSignature" TEXT         NOT NULL,
  "prompt"           TEXT         NOT NULL,
  "params"           JSONB        NOT NULL,
  "imageUrl"         TEXT         NOT NULL,
  "imageUrlHash"     TEXT         NOT NULL,
  "imageKey"         TEXT,
  "sourceType"       TEXT         NOT NULL DEFAULT 'text-to-image',
  "provider"         TEXT,
  "model"            TEXT,
  "serviceType"      TEXT,
  "textResponse"     TEXT,
  "status"           TEXT         NOT NULL DEFAULT 'active',
  "metadata"         JSONB,
  "reuseCount"       INTEGER      NOT NULL DEFAULT 0,
  "lastReusedAt"     TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GenerationImageAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GenerationImageAsset_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "GenerationImageReuse" (
  "id"               TEXT         NOT NULL,
  "userId"           TEXT         NOT NULL,
  "assetId"          TEXT         NOT NULL,
  "requestSignature" TEXT         NOT NULL,
  "apiUsageId"       TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GenerationImageReuse_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GenerationImageReuse_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GenerationImageReuse_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "GenerationImageAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "GenerationImageAsset_userId_imageUrlHash_key"
  ON "GenerationImageAsset"("userId", "imageUrlHash");

CREATE INDEX IF NOT EXISTS "GenerationImageAsset_userId_requestSignature_status_createdAt_idx"
  ON "GenerationImageAsset"("userId", "requestSignature", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "GenerationImageAsset_requestSignature_status_createdAt_idx"
  ON "GenerationImageAsset"("requestSignature", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "GenerationImageAsset_userId_createdAt_idx"
  ON "GenerationImageAsset"("userId", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "GenerationImageReuse_userId_assetId_key"
  ON "GenerationImageReuse"("userId", "assetId");

CREATE INDEX IF NOT EXISTS "GenerationImageReuse_userId_requestSignature_createdAt_idx"
  ON "GenerationImageReuse"("userId", "requestSignature", "createdAt");

CREATE INDEX IF NOT EXISTS "GenerationImageReuse_assetId_createdAt_idx"
  ON "GenerationImageReuse"("assetId", "createdAt");

CREATE INDEX IF NOT EXISTS "GenerationImageReuse_apiUsageId_idx"
  ON "GenerationImageReuse"("apiUsageId");
