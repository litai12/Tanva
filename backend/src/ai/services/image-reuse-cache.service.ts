import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

export type ImageReuseSignature = {
  signature: string;
  promptNormalized: string;
  params: Record<string, any>;
  version: number;
};

export type ImageReuseCacheScope = 'global' | 'user';

export type ImageReuseSignatureInput = {
  prompt?: string | null;
  providerName?: string | null;
  model?: string | null;
  serviceType?: string | null;
  aspectRatio?: unknown;
  imageSize?: unknown;
  outputFormat?: unknown;
  thinkingLevel?: unknown;
  imageOnly?: unknown;
  providerOptions?: Record<string, any> | null;
  enableWebSearch?: unknown;
  googleSearch?: unknown;
  googleImageSearch?: unknown;
  imageUrls?: unknown;
  batchMode?: unknown;
  batchCount?: unknown;
  outputImageCount?: unknown;
  officialFallback?: unknown;
  quality?: unknown;
  background?: unknown;
  moderation?: unknown;
  outputCompression?: unknown;
  maskUrl?: unknown;
};

export type ClaimedImageAsset = {
  id: string;
  imageUrl: string;
  imageKey?: string | null;
  textResponse?: string | null;
  metadata?: Record<string, any> | null;
  scope: ImageReuseCacheScope;
  assetOwnerUserId: string;
  assetOwnerIsRequester: boolean;
  availablePoolSize: number;
  poolSize: number;
  minPoolSize: number;
  presentationDelayMs: number;
};

export type RecordedImageAsset = {
  id: string;
  imageUrl: string;
};

type AssetRow = {
  id: string;
  ownerUserId: string;
  imageUrl: string;
  imageKey: string | null;
  textResponse: string | null;
  metadata: unknown;
};

const CACHE_VERSION = 1;
const DEFAULT_MIN_POOL_SIZE = 3;
const DEFAULT_HIT_PRESENTATION_DELAY_MS = 8000;
const DEFAULT_CACHE_SCOPE: ImageReuseCacheScope = 'global';
const SENSITIVE_KEY_PATTERN = /(api[-_]?key|authorization|bearer|token|secret|password|credential)/i;

@Injectable()
export class ImageReuseCacheService {
  private readonly logger = new Logger(ImageReuseCacheService.name);
  private readonly cacheScope = this.resolveCacheScope();
  private readonly minPoolSize = this.resolveMinPoolSize();
  private readonly hitPresentationDelayMs = this.resolveHitPresentationDelayMs();

  constructor(private readonly prisma: PrismaService) {}

  buildTextToImageSignature(input: ImageReuseSignatureInput): ImageReuseSignature | null {
    const promptNormalized = this.normalizePrompt(input.prompt);
    if (!promptNormalized) return null;

    if (this.hasInputImages(input.imageUrls)) return null;
    if (this.hasNonEmptyString(input.maskUrl)) return null;
    if (input.enableWebSearch === true || input.googleSearch === true || input.googleImageSearch === true) {
      return null;
    }

    const outputImageCount = this.toPositiveInteger(input.outputImageCount) ?? 1;
    const batchCount = this.toPositiveInteger(input.batchCount) ?? 1;
    if (outputImageCount !== 1) return null;
    if (input.batchMode === true && batchCount > 1) return null;

    const params = this.removeUndefined({
      version: CACHE_VERSION,
      kind: 'text-to-image',
      prompt: promptNormalized,
      provider: this.normalizeString(input.providerName) ?? 'gemini',
      model: this.normalizeString(input.model),
      serviceType: this.normalizeString(input.serviceType),
      aspectRatio: this.normalizeString(input.aspectRatio),
      imageSize: this.normalizeString(input.imageSize),
      outputFormat: this.normalizeString(input.outputFormat),
      thinkingLevel: this.normalizeString(input.thinkingLevel),
      imageOnly: typeof input.imageOnly === 'boolean' ? input.imageOnly : undefined,
      officialFallback:
        typeof input.officialFallback === 'boolean' ? input.officialFallback : undefined,
      quality: this.normalizeString(input.quality),
      background: this.normalizeString(input.background),
      moderation: this.normalizeString(input.moderation),
      outputCompression:
        typeof input.outputCompression === 'number' && Number.isFinite(input.outputCompression)
          ? Math.round(input.outputCompression)
          : undefined,
      providerOptions: this.sanitizeProviderOptions(input.providerOptions),
    });

    const signature = this.sha256(this.stableStringify(params));
    return {
      signature,
      promptNormalized,
      params,
      version: CACHE_VERSION,
    };
  }

  async claimNextUnusedAsset(params: {
    userId: string;
    signature: string;
    apiUsageId?: string | null;
  }): Promise<ClaimedImageAsset | null> {
    if (!this.isUsableUserId(params.userId) || !params.signature) return null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const useGlobalScope = this.cacheScope === 'global';
        const countRows = await tx.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`
            SELECT COUNT(*)::bigint AS count
            FROM "GenerationImageAsset" a
            WHERE (${useGlobalScope} OR a."userId" = ${params.userId})
              AND a."requestSignature" = ${params.signature}
              AND a."status" = 'active'
              AND NOT EXISTS (
                SELECT 1
                FROM "GenerationImageReuse" r
                WHERE r."userId" = ${params.userId}
                  AND r."assetId" = a."id"
              )
          `,
        );
        const availablePoolSize = Number(countRows[0]?.count ?? 0);
        if (availablePoolSize < this.minPoolSize) {
          return null;
        }

        const rows = await tx.$queryRaw<AssetRow[]>(
          Prisma.sql`
            SELECT
              a."id",
              a."userId" AS "ownerUserId",
              a."imageUrl",
              a."imageKey",
              a."textResponse",
              a."metadata"
            FROM "GenerationImageAsset" a
            WHERE (${useGlobalScope} OR a."userId" = ${params.userId})
              AND a."requestSignature" = ${params.signature}
              AND a."status" = 'active'
              AND NOT EXISTS (
                SELECT 1
                FROM "GenerationImageReuse" r
                WHERE r."userId" = ${params.userId}
                  AND r."assetId" = a."id"
              )
            ORDER BY a."createdAt" ASC, a."id" ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          `,
        );
        const row = rows[0];
        if (!row?.id || !row.imageUrl) return null;

        const inserted = await tx.$executeRaw(
          Prisma.sql`
            INSERT INTO "GenerationImageReuse" (
              "id",
              "userId",
              "assetId",
              "requestSignature",
              "apiUsageId"
            )
            VALUES (
              ${crypto.randomUUID()},
              ${params.userId},
              ${row.id},
              ${params.signature},
              ${params.apiUsageId ?? null}
            )
            ON CONFLICT ("userId", "assetId") DO NOTHING
          `,
        );

        if (inserted === 0) return null;

        await tx.$executeRaw(
          Prisma.sql`
            UPDATE "GenerationImageAsset"
            SET
              "reuseCount" = "reuseCount" + 1,
              "lastReusedAt" = CURRENT_TIMESTAMP,
              "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${row.id}
          `,
        );

        return {
          id: row.id,
          imageUrl: row.imageUrl,
          imageKey: row.imageKey,
          textResponse: row.textResponse,
          metadata: this.asRecord(row.metadata),
          scope: this.cacheScope,
          assetOwnerUserId: row.ownerUserId,
          assetOwnerIsRequester: row.ownerUserId === params.userId,
          availablePoolSize,
          poolSize: availablePoolSize,
          minPoolSize: this.minPoolSize,
          presentationDelayMs: this.hitPresentationDelayMs,
        };
      });
    } catch (error) {
      this.logger.warn(`Image reuse claim skipped: ${this.summarizeError(error)}`);
      return null;
    }
  }

  async waitForHitPresentationDelay(delayMs: number = this.hitPresentationDelayMs): Promise<number> {
    const normalizedDelayMs = this.normalizeDelayMs(delayMs);
    if (normalizedDelayMs <= 0) return 0;
    await new Promise((resolve) => setTimeout(resolve, normalizedDelayMs));
    return normalizedDelayMs;
  }

  async recordGeneratedAsset(params: {
    userId: string;
    signature: ImageReuseSignature;
    imageUrl: string;
    imageKey?: string | null;
    provider?: string | null;
    model?: string | null;
    serviceType?: string | null;
    textResponse?: string | null;
    metadata?: Record<string, any> | null;
    apiUsageId?: string | null;
  }): Promise<RecordedImageAsset | null> {
    if (!this.isUsableUserId(params.userId)) return null;

    const imageUrl = this.normalizeString(params.imageUrl);
    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return null;

    const imageUrlHash = this.sha256(imageUrl);
    const assetId = crypto.randomUUID();
    const paramsJson = JSON.stringify(params.signature.params);
    const metadata = this.removeUndefined({
      ...(params.metadata || {}),
      imageReuseCache: {
        storedAt: new Date().toISOString(),
        signature: params.signature.signature,
        version: params.signature.version,
      },
    });
    const metadataJson = JSON.stringify(metadata);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string; imageUrl: string }>>(
          Prisma.sql`
            INSERT INTO "GenerationImageAsset" (
              "id",
              "userId",
              "requestSignature",
              "prompt",
              "params",
              "imageUrl",
              "imageUrlHash",
              "imageKey",
              "provider",
              "model",
              "serviceType",
              "textResponse",
              "metadata"
            )
            VALUES (
              ${assetId},
              ${params.userId},
              ${params.signature.signature},
              ${params.signature.promptNormalized},
              ${paramsJson}::jsonb,
              ${imageUrl},
              ${imageUrlHash},
              ${params.imageKey ?? null},
              ${this.normalizeString(params.provider) ?? null},
              ${this.normalizeString(params.model) ?? null},
              ${this.normalizeString(params.serviceType) ?? null},
              ${this.normalizeString(params.textResponse) ?? null},
              ${metadataJson}::jsonb
            )
            ON CONFLICT ("userId", "imageUrlHash") DO UPDATE
            SET
              "userId" = EXCLUDED."userId",
              "requestSignature" = EXCLUDED."requestSignature",
              "prompt" = EXCLUDED."prompt",
              "params" = EXCLUDED."params",
              "imageUrl" = EXCLUDED."imageUrl",
              "imageKey" = COALESCE(EXCLUDED."imageKey", "GenerationImageAsset"."imageKey"),
              "provider" = EXCLUDED."provider",
              "model" = EXCLUDED."model",
              "serviceType" = EXCLUDED."serviceType",
              "textResponse" = EXCLUDED."textResponse",
              "metadata" = EXCLUDED."metadata",
              "status" = 'active',
              "updatedAt" = CURRENT_TIMESTAMP
            RETURNING "id", "imageUrl"
          `,
        );
        const row = rows[0];
        if (!row?.id) return null;
        return row;
      });
    } catch (error) {
      this.logger.warn(`Image reuse asset record skipped: ${this.summarizeError(error)}`);
      return null;
    }
  }

  private normalizePrompt(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\r\n/g, '\n').trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private hasNonEmptyString(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private hasInputImages(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    return value.some((item) => this.hasNonEmptyString(item));
  }

  private toPositiveInteger(value: unknown): number | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 1) return null;
    return Math.floor(numeric);
  }

  private sanitizeProviderOptions(value: unknown): Record<string, any> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const sanitized = this.sanitizeJsonValue(value);
    return this.asRecord(sanitized) ?? undefined;
  }

  private sanitizeJsonValue(value: unknown): unknown {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
      return undefined;
    }
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value)) {
      const items = value
        .map((item) => this.sanitizeJsonValue(item))
        .filter((item) => item !== undefined);
      return items.length > 0 ? items : undefined;
    }
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) continue;
        const sanitized = this.sanitizeJsonValue(item);
        if (sanitized !== undefined) {
          out[key] = sanitized;
        }
      }
      return Object.keys(out).length > 0 ? out : undefined;
    }
    return undefined;
  }

  private removeUndefined<T extends Record<string, any>>(value: T): T {
    const out: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const nested = this.removeUndefined(item as Record<string, any>);
        if (Object.keys(nested).length === 0) continue;
        out[key] = nested;
        continue;
      }
      out[key] = item;
    }
    return out as T;
  }

  private stableStringify(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    if (typeof value === 'object') {
      const objectValue = value as Record<string, unknown>;
      return `{${Object.keys(objectValue)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this.stableStringify(objectValue[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(String(value));
  }

  private sha256(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private asRecord(value: unknown): Record<string, any> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, any>;
  }

  private isUsableUserId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value !== 'anonymous';
  }

  private resolveMinPoolSize(): number {
    const raw = Number(process.env.IMAGE_REUSE_CACHE_MIN_POOL_SIZE);
    if (!Number.isFinite(raw) || raw < 1) {
      return DEFAULT_MIN_POOL_SIZE;
    }
    return Math.max(1, Math.min(100, Math.floor(raw)));
  }

  private resolveCacheScope(): ImageReuseCacheScope {
    const raw = typeof process.env.IMAGE_REUSE_CACHE_SCOPE === 'string'
      ? process.env.IMAGE_REUSE_CACHE_SCOPE.trim().toLowerCase()
      : '';
    if (raw === 'user' || raw === 'same-user' || raw === 'self') return 'user';
    if (raw === 'global' || raw === 'shared' || raw === 'site') return 'global';
    return DEFAULT_CACHE_SCOPE;
  }

  private resolveHitPresentationDelayMs(): number {
    return this.normalizeDelayMs(process.env.IMAGE_REUSE_CACHE_HIT_DELAY_MS);
  }

  private normalizeDelayMs(value: unknown): number {
    if (value === undefined || value === null || value === '') {
      return DEFAULT_HIT_PRESENTATION_DELAY_MS;
    }
    const raw = Number(value);
    if (!Number.isFinite(raw)) return DEFAULT_HIT_PRESENTATION_DELAY_MS;
    return Math.max(0, Math.min(30000, Math.floor(raw)));
  }

  private summarizeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
