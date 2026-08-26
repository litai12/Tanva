CREATE TABLE "UserPromptLibraryItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "promptText" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL DEFAULT 'image',
    "previewUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPromptLibraryItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserPromptLibraryFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPromptLibraryFavorite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserPromptLibraryItem_userId_updatedAt_idx"
ON "UserPromptLibraryItem"("userId", "updatedAt" DESC);

CREATE INDEX "UserPromptLibraryItem_userId_mediaType_updatedAt_idx"
ON "UserPromptLibraryItem"("userId", "mediaType", "updatedAt" DESC);

CREATE UNIQUE INDEX "UserPromptLibraryFavorite_userId_source_promptId_key"
ON "UserPromptLibraryFavorite"("userId", "source", "promptId");

CREATE INDEX "UserPromptLibraryFavorite_userId_createdAt_idx"
ON "UserPromptLibraryFavorite"("userId", "createdAt" DESC);

ALTER TABLE "UserPromptLibraryItem"
ADD CONSTRAINT "UserPromptLibraryItem_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserPromptLibraryFavorite"
ADD CONSTRAINT "UserPromptLibraryFavorite_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
