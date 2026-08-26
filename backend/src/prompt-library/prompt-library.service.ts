import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  type CreateUserPromptDto,
  type ListOfficialPromptsDto,
  type ListUserPromptsDto,
  type PromptLibrarySource,
  type PromptMediaType,
  type UpdateUserPromptDto,
} from './dto/prompt-library.dto';

type OfficialPromptModel = { slug: string; name: string };
type OfficialPromptMedia = {
  id: string;
  kind: PromptMediaType;
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  order: number;
};

type OfficialPromptCard = {
  id: string;
  title: string;
  description: string | null;
  promptText: string;
  mediaType: PromptMediaType;
  authorLabel: string;
  publishedAt: string | null;
  models: OfficialPromptModel[];
  media: OfficialPromptMedia[];
};

type OfficialPromptResult = {
  items: OfficialPromptCard[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    media: Array<{ kind: PromptMediaType; count: number }>;
    models: Array<{ slug: string; name: string; count: number }>;
    allMediaCount: number;
    allModelCount: number;
  };
};

const USER_PROMPT_SELECT = {
  id: true,
  title: true,
  description: true,
  promptText: true,
  mediaType: true,
  previewUrl: true,
  createdAt: true,
  updatedAt: true,
} as const;

const DEFAULT_TAPCANVAS_PROMPT_LIBRARY_URL =
  'https://tc.tanvas.cn/api/prompt-library';
const OFFICIAL_REQUEST_TIMEOUT_MS = 20_000;
const OFFICIAL_REQUEST_MAX_ATTEMPTS = 2;
const OFFICIAL_CACHE_TTL_MS = 60_000;
const OFFICIAL_CACHE_MAX_ENTRIES = 100;
const officialCache = new Map<string, { expiresAt: number; value: OfficialPromptResult }>();
const officialInflight = new Map<string, Promise<OfficialPromptResult>>();

const readString = (value: unknown, maxLength: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const readNullableString = (value: unknown, maxLength: number): string | null => {
  const output = readString(value, maxLength);
  return output || null;
};

const readCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;

const readPositiveInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

const isPromptMediaType = (value: unknown): value is PromptMediaType =>
  value === 'image' || value === 'video';

const normalizeRemoteUrl = (value: unknown): string | null => {
  const raw = readString(value, 2_048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

const requireRemoteUrl = (value: string | undefined): string | null => {
  if (!value?.trim()) return null;
  const normalized = normalizeRemoteUrl(value);
  if (!normalized) {
    throw new BadRequestException('预览图必须使用 HTTP(S) 远程 URL');
  }
  return normalized;
};

const sanitizeOfficialResult = (raw: unknown): OfficialPromptResult => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadGatewayException('TapCanvas 提示词库返回了无效数据');
  }
  const record = raw as Record<string, unknown>;
  const items = Array.isArray(record.items) ? record.items : [];
  const sanitizedItems = items.flatMap((entry): OfficialPromptCard[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const id = readString(item.id, 200);
    const title = readString(item.title, 500);
    const promptText = readString(item.promptText, 100_000);
    if (!id || !title || !promptText || !isPromptMediaType(item.mediaType)) return [];

    const models = (Array.isArray(item.models) ? item.models : []).flatMap(
      (model): OfficialPromptModel[] => {
        if (!model || typeof model !== 'object' || Array.isArray(model)) return [];
        const candidate = model as Record<string, unknown>;
        const slug = readString(candidate.slug, 120);
        const name = readString(candidate.name, 160);
        return slug && name ? [{ slug, name }] : [];
      },
    );
    const media = (Array.isArray(item.media) ? item.media : []).flatMap(
      (mediaItem, index): OfficialPromptMedia[] => {
        if (!mediaItem || typeof mediaItem !== 'object' || Array.isArray(mediaItem)) return [];
        const candidate = mediaItem as Record<string, unknown>;
        const url = normalizeRemoteUrl(candidate.url);
        if (!url || !isPromptMediaType(candidate.kind)) return [];
        return [{
          id: readString(candidate.id, 200) || `${id}:${index}`,
          kind: candidate.kind,
          url,
          thumbnailUrl: normalizeRemoteUrl(candidate.thumbnailUrl),
          width: readPositiveInteger(candidate.width),
          height: readPositiveInteger(candidate.height),
          order: typeof candidate.order === 'number' && Number.isFinite(candidate.order)
            ? Math.floor(candidate.order)
            : index,
        }];
      },
    );
    if (media.length === 0) return [];
    return [{
      id,
      title,
      description: readNullableString(item.description, 2_000),
      promptText,
      mediaType: item.mediaType,
      authorLabel: readString(item.authorLabel, 160) || 'TapCanvas',
      publishedAt: readNullableString(item.publishedAt, 80),
      models,
      media,
    }];
  });

  const rawFacets = record.facets && typeof record.facets === 'object' && !Array.isArray(record.facets)
    ? record.facets as Record<string, unknown>
    : {};
  const mediaFacets = (Array.isArray(rawFacets.media) ? rawFacets.media : []).flatMap(
    (facet): Array<{ kind: PromptMediaType; count: number }> => {
      if (!facet || typeof facet !== 'object' || Array.isArray(facet)) return [];
      const candidate = facet as Record<string, unknown>;
      return isPromptMediaType(candidate.kind)
        ? [{ kind: candidate.kind, count: readCount(candidate.count) }]
        : [];
    },
  );
  const modelFacets = (Array.isArray(rawFacets.models) ? rawFacets.models : []).flatMap(
    (facet): Array<{ slug: string; name: string; count: number }> => {
      if (!facet || typeof facet !== 'object' || Array.isArray(facet)) return [];
      const candidate = facet as Record<string, unknown>;
      const slug = readString(candidate.slug, 120);
      const name = readString(candidate.name, 160);
      return slug && name ? [{ slug, name, count: readCount(candidate.count) }] : [];
    },
  );

  return {
    items: sanitizedItems,
    total: readCount(record.total),
    page: Math.max(1, readCount(record.page) || 1),
    pageSize: Math.max(1, readCount(record.pageSize) || sanitizedItems.length || 1),
    facets: {
      media: mediaFacets,
      models: modelFacets,
      allMediaCount: readCount(rawFacets.allMediaCount),
      allModelCount: readCount(rawFacets.allModelCount),
    },
  };
};

@Injectable()
export class PromptLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private fetchOfficial(url: URL): Promise<OfficialPromptResult> {
    const cacheKey = url.toString();
    const cached = officialCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
    if (cached) officialCache.delete(cacheKey);

    const inflight = officialInflight.get(cacheKey);
    if (inflight) return inflight;

    const request = (async () => {
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= OFFICIAL_REQUEST_MAX_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(OFFICIAL_REQUEST_TIMEOUT_MS),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const value = sanitizeOfficialResult(await response.json());
          if (officialCache.size >= OFFICIAL_CACHE_MAX_ENTRIES) {
            const oldestKey = officialCache.keys().next().value as string | undefined;
            if (oldestKey) officialCache.delete(oldestKey);
          }
          officialCache.set(cacheKey, { expiresAt: Date.now() + OFFICIAL_CACHE_TTL_MS, value });
          return value;
        } catch (error) {
          lastError = error;
          if (attempt < OFFICIAL_REQUEST_MAX_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
          }
        }
      }
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      throw new BadGatewayException(`TapCanvas 提示词库暂不可用：${message}`);
    })().finally(() => {
      officialInflight.delete(cacheKey);
    });
    officialInflight.set(cacheKey, request);
    return request;
  }

  async listOfficial(input: ListOfficialPromptsDto): Promise<OfficialPromptResult> {
    const endpoint = this.config.get<string>('TAPCANVAS_PROMPT_LIBRARY_API_URL')?.trim()
      || DEFAULT_TAPCANVAS_PROMPT_LIBRARY_URL;
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new BadGatewayException('TapCanvas 提示词库地址配置无效');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadGatewayException('TapCanvas 提示词库地址必须使用 HTTP(S)');
    }
    if (input.query?.trim()) url.searchParams.set('query', input.query.trim());
    if (input.model?.trim()) url.searchParams.set('model', input.model.trim());
    if (input.mediaType) url.searchParams.set('mediaType', input.mediaType);
    url.searchParams.set('sort', input.sort || 'time_desc');
    url.searchParams.set('page', String(input.page || 1));
    url.searchParams.set('pageSize', String(input.pageSize || 24));

    return this.fetchOfficial(url);
  }

  listMine(userId: string, input: ListUserPromptsDto) {
    const query = input.query?.trim();
    return this.prisma.userPromptLibraryItem.findMany({
      where: {
        userId,
        ...(input.mediaType ? { mediaType: input.mediaType } : {}),
        ...(query ? {
          OR: [
            { title: { contains: query, mode: 'insensitive' as const } },
            { description: { contains: query, mode: 'insensitive' as const } },
            { promptText: { contains: query, mode: 'insensitive' as const } },
          ],
        } : {}),
      },
      select: USER_PROMPT_SELECT,
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  createMine(userId: string, dto: CreateUserPromptDto) {
    return this.prisma.userPromptLibraryItem.create({
      data: {
        userId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        promptText: dto.promptText.trim(),
        mediaType: dto.mediaType,
        previewUrl: requireRemoteUrl(dto.previewUrl),
      },
      select: USER_PROMPT_SELECT,
    });
  }

  async updateMine(userId: string, id: string, dto: UpdateUserPromptDto) {
    const existing = await this.prisma.userPromptLibraryItem.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('提示词不存在');
    return this.prisma.userPromptLibraryItem.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
        ...(dto.promptText !== undefined ? { promptText: dto.promptText.trim() } : {}),
        ...(dto.mediaType !== undefined ? { mediaType: dto.mediaType } : {}),
        ...(dto.previewUrl !== undefined ? { previewUrl: requireRemoteUrl(dto.previewUrl) } : {}),
      },
      select: USER_PROMPT_SELECT,
    });
  }

  async removeMine(userId: string, id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.userPromptLibraryItem.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('提示词不存在');
    await this.prisma.$transaction([
      this.prisma.userPromptLibraryFavorite.deleteMany({
        where: { userId, source: 'custom', promptId: id },
      }),
      this.prisma.userPromptLibraryItem.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  listFavorites(userId: string) {
    return this.prisma.userPromptLibraryFavorite.findMany({
      where: { userId },
      select: { source: true, promptId: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async setFavorite(
    userId: string,
    source: PromptLibrarySource,
    promptId: string,
    favorite: boolean,
  ): Promise<{ source: PromptLibrarySource; promptId: string; favorite: boolean }> {
    const normalizedId = promptId.trim();
    if (!normalizedId || normalizedId.length > 200) {
      throw new BadRequestException('提示词 ID 无效');
    }
    if (source === 'custom') {
      const owned = await this.prisma.userPromptLibraryItem.findFirst({
        where: { id: normalizedId, userId },
        select: { id: true },
      });
      if (!owned) throw new NotFoundException('提示词不存在');
    }
    if (favorite) {
      await this.prisma.userPromptLibraryFavorite.upsert({
        where: { userId_source_promptId: { userId, source, promptId: normalizedId } },
        create: { userId, source, promptId: normalizedId },
        update: {},
      });
    } else {
      await this.prisma.userPromptLibraryFavorite.deleteMany({
        where: { userId, source, promptId: normalizedId },
      });
    }
    return { source, promptId: normalizedId, favorite };
  }
}
