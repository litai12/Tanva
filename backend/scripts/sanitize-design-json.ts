import { PrismaClient } from '@prisma/client';
import { sanitizeDesignJson } from '../src/utils/designJsonSanitizer';

const prisma = new PrismaClient();

const stableStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

const sanitizeNullableString = (value: string | null): string | null => {
  if (!value) return null;
  const sanitized = sanitizeDesignJson(value);
  return typeof sanitized === 'string' ? sanitized : null;
};

async function main() {
  let updatedProjects = 0;
  let updatedTemplates = 0;

  // Project.contentJson
  {
    const batchSize = 100;
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.project.findMany({
        take: batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        select: { id: true, contentJson: true },
      });
      if (batch.length === 0) break;

      for (const row of batch) {
        if (!row.contentJson) continue;
        const before = stableStringify(row.contentJson);
        const sanitized = sanitizeDesignJson(row.contentJson);
        const after = stableStringify(sanitized);
        if (before === after) continue;

        await prisma.project.update({
          where: { id: row.id },
          data: { contentJson: sanitized as any },
        });
        updatedProjects += 1;
      }

      cursor = batch[batch.length - 1]?.id;
    }
  }

  // PublicTemplate.templateData + thumbnail fields
  {
    const batchSize = 100;
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.publicTemplate.findMany({
        take: batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        select: { id: true, templateData: true, thumbnail: true, thumbnailSmall: true },
      });
      if (batch.length === 0) break;

      for (const row of batch) {
        const sanitizedTemplateData = sanitizeDesignJson(row.templateData);
        const sanitizedThumb = sanitizeNullableString(row.thumbnail);
        const sanitizedThumbSmall = sanitizeNullableString(row.thumbnailSmall);

        const needsUpdate =
          stableStringify(row.templateData) !== stableStringify(sanitizedTemplateData) ||
          row.thumbnail !== sanitizedThumb ||
          row.thumbnailSmall !== sanitizedThumbSmall;

        if (!needsUpdate) continue;

        await prisma.publicTemplate.update({
          where: { id: row.id },
          data: {
            templateData: sanitizedTemplateData as any,
            thumbnail: sanitizedThumb,
            thumbnailSmall: sanitizedThumbSmall,
          },
        });
        updatedTemplates += 1;
      }

      cursor = batch[batch.length - 1]?.id;
    }
  }

  // eslint-disable-next-line no-console
  console.log('[sanitize-design-json] Done', {
    updatedProjects,
    updatedTemplates,
  });
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[sanitize-design-json] Failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

