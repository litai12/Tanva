import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { OssService } from '../oss/oss.service';
import { AIProviderFactory } from '../ai/ai-provider.factory';
import { signVolcRequest } from '../volc-asset/volc-sign.util';
import {
  AgentResearchCase,
  AgentResearchImageCandidate,
  AgentResearchSource,
} from './agent.types';

type VolcSearchType = 'web' | 'image';

export interface VolcResearchSearchPayload {
  keywords: string[];
  sources: AgentResearchSource[];
  imagesByQuery: Map<string, AgentResearchImageCandidate[]>;
  cases: AgentResearchCase[];
  provider: string;
}

type SearchDerivedCase = AgentResearchCase & {
  imageSearchQueries?: string[];
};

@Injectable()
export class VolcResearchSearchService {
  private readonly logger = new Logger(VolcResearchSearchService.name);
  private readonly cache = new Map<string, { expiresAt: number; value: any }>();

  constructor(
    private readonly config: ConfigService,
    private readonly oss: OssService,
    private readonly providerFactory: AIProviderFactory,
  ) {}

  isEnabled(): boolean {
    return this.readBool('VOLC_SEARCH_ENABLED', false);
  }

  async searchArchitectureResearch(
    prompt: string,
    baseImageQueries: string[] = [],
  ): Promise<VolcResearchSearchPayload | null> {
    if (!this.isEnabled()) return null;

    const keywords = this.buildKeywords(prompt);
    const webCount = this.readInt('VOLC_SEARCH_WEB_COUNT', 12, 1, 20);
    const imageCount = this.readInt('VOLC_SEARCH_IMAGE_COUNT', 4, 1, 5);

    const sources = await this.searchWebSources(keywords, webCount);
    const requestedCaseCount = this.extractRequestedCaseCount(prompt);
    const cases = await this.buildCasesFromSources(prompt, sources, requestedCaseCount);
    const uniqueImageQueries = Array.from(
      new Set(
        (cases.length > 0
          ? cases.flatMap((item) => this.caseImageSearchQueries(item))
          : baseImageQueries
        )
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ).slice(0, 12);
    const imageEntries = await Promise.all(
      uniqueImageQueries.map(async (query) => {
        const images = await this.searchImageCandidates(query, imageCount);
        return [query, images] as const;
      }),
    );

    return {
      keywords,
      sources,
      imagesByQuery: new Map(imageEntries),
      cases: this.attachImagesToCases(cases, new Map(imageEntries)),
      provider: this.resolveProviderLabel(),
    };
  }

  private buildKeywords(prompt: string): string[] {
    const normalized = String(prompt || '').replace(/\s+/g, ' ').trim();
    const keywords: string[] = [];
    if (normalized) keywords.push(normalized);

    if (/教堂|礼拜堂|church|chapel|cathedral/i.test(normalized)) {
      keywords.push('教堂 建筑 案例 建筑师');
      keywords.push('church chapel architecture case study architect');
    } else if (/学校|校园|大学|school|campus|university/i.test(normalized)) {
      keywords.push('建筑大师 学校 校园 建筑 案例');
      keywords.push('master architect school campus architecture case study');
    } else {
      keywords.push('建筑 案例 建筑师 项目 分析');
      keywords.push('architecture case study architect project');
    }

    return Array.from(new Set(keywords)).slice(0, 3);
  }

  private async searchWebSources(
    keywords: string[],
    totalCount: number,
  ): Promise<AgentResearchSource[]> {
    const perQuery = Math.max(1, Math.ceil(totalCount / Math.max(1, keywords.length)));
    const batches = await Promise.all(
      keywords.map((keyword) => this.callSearch(keyword, 'web', perQuery)),
    );
    const sources = batches.flatMap((batch) => this.extractWebSources(batch));
    return this.dedupeSources(sources).slice(0, totalCount);
  }

  private async searchImageCandidates(
    query: string,
    count: number,
  ): Promise<AgentResearchImageCandidate[]> {
    const raw = await this.callSearch(query, 'image', count);
    const images = this.extractImageCandidates(raw, query).slice(0, count);
    if (!this.readBool('VOLC_SEARCH_UPLOAD_IMAGES_TO_OSS', false)) {
      return images;
    }

    return Promise.all(
      images.map(async (image) => ({
        ...image,
        imageUrl: image.imageUrl
          ? await this.uploadRemoteImageToOss(image.imageUrl).catch((error) => {
              this.logger.warn(
                `Failed to cache search image: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              return image.imageUrl;
            })
          : image.imageUrl,
      })),
    );
  }

  private async buildCasesFromSources(
    prompt: string,
    sources: AgentResearchSource[],
    count: number,
  ): Promise<SearchDerivedCase[]> {
    if (sources.length === 0) return [];
    const aiCases = await this.buildCasesWithModel(prompt, sources, count).catch((error) => {
      this.logger.warn(
        `Failed to build research cases with model: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    });
    if (aiCases.length > 0) return aiCases.slice(0, count);
    return this.buildCasesHeuristically(prompt, sources, count);
  }

  private async buildCasesWithModel(
    prompt: string,
    sources: AgentResearchSource[],
    count: number,
  ): Promise<SearchDerivedCase[]> {
    const model =
      this.config.get<string>('VOLC_SEARCH_SUMMARY_MODEL') ||
      this.config.get<string>('ARK_WEB_SEARCH_MODEL') ||
      'gemini-3.1-pro';
    const provider = this.providerFactory.getProvider(model, 'new-api');
    const sourceLines = sources
      .slice(0, 18)
      .map((source, index) => {
        return [
          `#${index + 1}`,
          `title: ${source.title}`,
          `url: ${source.url}`,
          source.sourceName ? `site: ${source.sourceName}` : '',
          source.snippet ? `snippet: ${source.snippet}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n');

    const result = await provider.generateText({
      model,
      enableWebSearch: false,
      prompt: [
        '你是建筑案例研究助理。请只基于给定搜索结果抽取真实建筑案例，不要使用内置知识补案例。',
        `用户需求：${prompt}`,
        `目标案例数量：${count}`,
        '输出必须是 JSON，不要 Markdown，不要解释。',
        'JSON 格式：',
        '{"title":"...","cases":[{"title":"中文案例名","subtitle":"英文/原名","architect":"建筑师","location":"地点","category":"3 个以内分类，用 / 分隔","summary":"70字以内，说明为什么值得研究","highlights":["要点1","要点2","要点3","要点4"],"imageSearchQueries":["适合搜图的英文查询1","适合搜图的英文查询2"],"sourceUrls":["必须来自给定搜索结果的 url"]}]}',
        '规则：',
        '- 每个案例必须能在搜索结果中找到依据。',
        '- sourceUrls 只能使用给定搜索结果里的 url。',
        '- 如果资料不足，少返回案例，不要编造。',
        '- 优先建筑师/项目名/地点明确的案例。',
        '',
        '搜索结果：',
        sourceLines,
      ].join('\n'),
    });
    if (!result.success || !result.data?.text) return [];
    return this.normalizeModelCases(result.data.text, sources);
  }

  private normalizeModelCases(
    text: string,
    sources: AgentResearchSource[],
  ): SearchDerivedCase[] {
    const parsed = this.parseJsonObject(text);
    const rawCases: any[] = Array.isArray(parsed?.cases) ? parsed.cases : [];
    const sourceByUrl = new Map<string, AgentResearchSource>(
      sources.map((source) => [source.url, source]),
    );
    return rawCases
      .map((item: any): SearchDerivedCase | null => {
        const title = this.cleanText(item?.title);
        if (!title) return null;
        const sourceUrls = Array.isArray(item?.sourceUrls)
          ? item.sourceUrls.filter((url: unknown): url is string => typeof url === 'string')
          : [];
        const caseSources = sourceUrls
          .map((url: string) => sourceByUrl.get(url))
          .filter(
            (source: AgentResearchSource | undefined): source is AgentResearchSource =>
              Boolean(source),
          );
        if (caseSources.length === 0) return null;
        return {
          id: this.slugify(`${title}-${item?.architect || ''}`),
          title,
          subtitle: this.cleanText(item?.subtitle),
          architect: this.cleanText(item?.architect),
          location: this.cleanText(item?.location),
          category: this.cleanText(item?.category),
          summary:
            this.cleanText(item?.summary) ||
            caseSources[0]?.snippet ||
            '从真实搜索资料中整理出的建筑案例，适合继续追踪项目来源和图像资料。',
          highlights: this.normalizeStringArray(item?.highlights).slice(0, 4),
          sources: caseSources,
          images: [],
          imageSearchQueries: this.normalizeStringArray(item?.imageSearchQueries).slice(0, 3),
        };
      })
      .filter((item: SearchDerivedCase | null): item is SearchDerivedCase => Boolean(item));
  }

  private buildCasesHeuristically(
    prompt: string,
    sources: AgentResearchSource[],
    count: number,
  ): SearchDerivedCase[] {
    return sources.slice(0, count).map((source, index) => {
      const title = this.deriveCaseTitle(source.title || source.url);
      return {
        id: this.slugify(`${title}-${index}`),
        title,
        subtitle: source.title !== title ? source.title : undefined,
        architect: '',
        location: '',
        category: this.categoryFromPrompt(prompt),
        summary:
          source.snippet ||
          '从真实搜索资料中整理出的建筑案例，适合继续追踪项目来源和图像资料。',
        highlights: ['真实检索来源', '资料可追溯', '可继续核验', '图像参考'],
        sources: [source],
        images: [],
        imageSearchQueries: [title, `${title} architecture`, `${title} case study`],
      };
    });
  }

  private attachImagesToCases(
    cases: SearchDerivedCase[],
    imagesByQuery: Map<string, AgentResearchImageCandidate[]>,
  ): AgentResearchCase[] {
    return cases.map((item) => {
      const images = this.dedupeImageCandidates(
        this.caseImageSearchQueries(item).flatMap((query) => imagesByQuery.get(query) ?? []),
      ).slice(0, 4);
      return {
        ...item,
        images: images.length > 0 ? images : this.placeholderImagesForCase(item),
      };
    });
  }

  private caseImageSearchQueries(item: SearchDerivedCase): string[] {
    const explicit = Array.isArray(item.imageSearchQueries) ? item.imageSearchQueries : [];
    const base = [item.subtitle || item.title, item.architect, item.location, 'architecture']
      .filter(Boolean)
      .join(' ');
    const titleOnly = [item.subtitle || item.title, 'architecture'].filter(Boolean).join(' ');
    return Array.from(new Set([...explicit, base, titleOnly].filter(Boolean))).slice(0, 3);
  }

  private placeholderImagesForCase(item: SearchDerivedCase): AgentResearchImageCandidate[] {
    return this.caseImageSearchQueries(item).slice(0, 4).map((query, index) => ({
      label: this.labelForIndex(index),
      query,
      searchUrl: this.buildSearchUrl(query),
    }));
  }

  private async callSearch(
    query: string,
    searchType: VolcSearchType,
    count: number,
  ): Promise<any> {
    const cacheKey = `${searchType}:${count}:${query}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const body = JSON.stringify({
      Query: query,
      SearchType: searchType,
      Count: count,
    });

    const authMode = (this.config.get<string>('VOLC_SEARCH_AUTH_MODE') || 'aksk')
      .trim()
      .toLowerCase();
    const endpoint = this.normalizeEndpoint(
      this.config.get<string>('VOLC_SEARCH_ENDPOINT') ||
        'https://mercury.volcengineapi.com',
    );
    const url = new URL(endpoint);

    const response =
      authMode === 'apikey'
        ? await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              Authorization: `Bearer ${this.requiredConfig('VOLC_SEARCH_API_KEY')}`,
            },
            body,
          })
        : await this.callWithAkSk(url, body);

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Volc search ${searchType} failed: HTTP ${response.status} ${text.slice(0, 240)}`,
      );
    }

    const parsed = this.parseJson(text);
    const ttlSeconds = this.readInt('VOLC_SEARCH_CACHE_TTL_SECONDS', 86400, 0, 604800);
    if (ttlSeconds > 0) {
      this.cache.set(cacheKey, {
        expiresAt: Date.now() + ttlSeconds * 1000,
        value: parsed,
      });
    }
    return parsed;
  }

  private async callWithAkSk(endpoint: URL, body: string): Promise<Response> {
    const action = this.config.get<string>('VOLC_SEARCH_ACTION') || 'WebSearch';
    const version = this.config.get<string>('VOLC_SEARCH_VERSION') || '2025-01-01';
    const signed = signVolcRequest({
      accessKey:
        this.config.get<string>('VOLC_SEARCH_ACCESS_KEY') ||
        this.requiredConfig('VOLC_ARK_ACCESS_KEY'),
      secretKey:
        this.config.get<string>('VOLC_SEARCH_SECRET_KEY') ||
        this.requiredConfig('VOLC_ARK_SECRET_KEY'),
      region: this.config.get<string>('VOLC_SEARCH_REGION') || 'cn-beijing',
      service: this.config.get<string>('VOLC_SEARCH_SERVICE') || 'volc_torchlight_api',
      host: endpoint.host,
      method: 'POST',
      action,
      version,
      body,
    });
    const { Host: _host, ...headers } = signed.headers;
    return fetch(signed.url, {
      method: 'POST',
      headers,
      body,
    });
  }

  private extractWebSources(raw: any): AgentResearchSource[] {
    const candidates = this.collectArrays(raw, [
      'WebResults',
      'webResults',
      'web_results',
      'Results',
      'results',
      'data',
    ]);

    return candidates
      .map((item): AgentResearchSource | null => {
        const url = this.pickString(item, ['Url', 'url', 'Link', 'link', 'TargetUrl']);
        const title = this.pickString(item, ['Title', 'title', 'Name', 'name']) || url;
        if (!url || !/^https?:\/\//i.test(url)) return null;
        return {
          title,
          url,
          snippet: this.pickString(item, [
            'Snippet',
            'snippet',
            'Summary',
            'summary',
            'Content',
            'content',
          ]),
          sourceName: this.pickString(item, [
            'SiteName',
            'siteName',
            'Source',
            'source',
            'DisplayName',
          ]),
        } satisfies AgentResearchSource;
      })
      .filter((item): item is AgentResearchSource => Boolean(item));
  }

  private extractImageCandidates(
    raw: any,
    query: string,
  ): AgentResearchImageCandidate[] {
    const candidates = this.collectArrays(raw, [
      'ImageResults',
      'imageResults',
      'image_results',
      'Images',
      'images',
      'Results',
      'results',
      'data',
    ]);

    return candidates
      .map((item, index): AgentResearchImageCandidate | null => {
        const image = item?.Image || item?.image || item?.Thumbnail || item?.thumbnail || item;
        const imageUrl = this.pickString(image, [
          'Url',
          'url',
          'ImageUrl',
          'imageUrl',
          'ThumbnailUrl',
          'thumbnailUrl',
          'Src',
          'src',
        ]);
        if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return null;
        const sourceUrl =
          this.pickString(item, ['Url', 'url', 'SourceUrl', 'sourceUrl', 'PageUrl', 'pageUrl']) ||
          imageUrl;
        return {
          label: this.labelForIndex(index),
          query,
          searchUrl: this.buildSearchUrl(query),
          imageUrl,
          sourceUrl,
          sourceName: this.pickString(item, [
            'SiteName',
            'siteName',
            'Source',
            'source',
            'Title',
            'title',
          ]),
          width: this.pickNumber(image, ['Width', 'width']),
          height: this.pickNumber(image, ['Height', 'height']),
        } satisfies AgentResearchImageCandidate;
      })
      .filter((item): item is AgentResearchImageCandidate => Boolean(item));
  }

  private collectArrays(raw: any, keys: string[]): any[] {
    const result: any[] = [];
    const visit = (value: any, depth: number) => {
      if (!value || depth > 4) return;
      if (Array.isArray(value)) {
        result.push(...value);
        return;
      }
      if (typeof value !== 'object') return;
      for (const key of keys) {
        if (Array.isArray(value[key])) {
          result.push(...value[key]);
        }
      }
      for (const key of ['Result', 'result', 'Data', 'data', 'SearchResult', 'searchResult']) {
        if (value[key] && typeof value[key] === 'object') visit(value[key], depth + 1);
      }
    };
    visit(raw, 0);
    return result;
  }

  private async uploadRemoteImageToOss(imageUrl: string): Promise<string> {
    if (!this.oss.isEnabled()) return imageUrl;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(imageUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      if (!contentType.toLowerCase().startsWith('image/')) {
        throw new Error(`Unexpected content-type ${contentType}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > 8 * 1024 * 1024) {
        throw new Error('Image is larger than 8MB');
      }
      const ext = this.inferExt(contentType, imageUrl);
      const key = `research/images/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const upload = await this.oss.putStream(key, Readable.from(buffer), {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
      return upload.url || imageUrl;
    } finally {
      clearTimeout(timeout);
    }
  }

  private dedupeSources(sources: AgentResearchSource[]): AgentResearchSource[] {
    const seen = new Set<string>();
    const result: AgentResearchSource[] = [];
    for (const source of sources) {
      const key = source.url.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(source);
    }
    return result;
  }

  private dedupeImageCandidates(
    images: AgentResearchImageCandidate[],
  ): AgentResearchImageCandidate[] {
    const seen = new Set<string>();
    const result: AgentResearchImageCandidate[] = [];
    for (const image of images) {
      const key = image.imageUrl || image.sourceUrl || image.searchUrl || image.query;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(image);
    }
    return result;
  }

  private extractRequestedCaseCount(prompt: string): number {
    const raw = String(prompt || '');
    const digitMatch = raw.match(/(\d{1,2})\s*(?:个|篇|组|则|case|cases)/i);
    if (digitMatch) {
      return Math.max(1, Math.min(8, Number.parseInt(digitMatch[1], 10)));
    }
    const words: Record<string, number> = {
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
    };
    for (const [word, value] of Object.entries(words)) {
      if (raw.includes(`${word}个`) || raw.includes(`${word}篇`) || raw.includes(`${word}组`)) {
        return value;
      }
    }
    return 5;
  }

  private parseJsonObject(text: string): any {
    const trimmed = String(text || '').trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1]?.trim() || trimmed;
    try {
      return JSON.parse(candidate);
    } catch {}

    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    return null;
  }

  private cleanText(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim();
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this.cleanText(item))
      .filter((item) => item.length > 0);
  }

  private slugify(value: string): string {
    const ascii = value
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    return ascii || `case-${Date.now().toString(36)}`;
  }

  private deriveCaseTitle(title: string): string {
    const cleaned = this.cleanText(title);
    if (!cleaned) return '检索案例';
    const parts = cleaned.split(/\s[-_|｜:：]\s|[-_|｜:：]/).filter(Boolean);
    return (parts[0] || cleaned).slice(0, 48);
  }

  private categoryFromPrompt(prompt: string): string {
    if (/教堂|礼拜堂|church|chapel|cathedral/i.test(prompt)) {
      return '宗教建筑 / 案例研究 / 图像参考';
    }
    if (/学校|校园|大学|学院|school|campus|university/i.test(prompt)) {
      return '教育建筑 / 校园空间 / 案例研究';
    }
    return '建筑案例 / 资料检索 / 图像参考';
  }

  private pickString(value: any, keys: string[]): string {
    for (const key of keys) {
      const item = value?.[key];
      if (typeof item === 'string' && item.trim()) return item.trim();
    }
    return '';
  }

  private pickNumber(value: any, keys: string[]): number | undefined {
    for (const key of keys) {
      const item = Number(value?.[key]);
      if (Number.isFinite(item) && item > 0) return item;
    }
    return undefined;
  }

  private labelForIndex(index: number): string {
    return ['外观', '室内', '图纸', '细部'][index] || '图片';
  }

  private buildSearchUrl(query: string): string {
    return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
  }

  private resolveProviderLabel(): string {
    return `volc:${this.config.get<string>('VOLC_SEARCH_AUTH_MODE') || 'aksk'}`;
  }

  private readBool(key: string, fallback: boolean): boolean {
    const value = this.config.get<string>(key);
    if (value == null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
  }

  private readInt(key: string, fallback: number, min: number, max: number): number {
    const value = Number(this.config.get<string>(key));
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(value)));
  }

  private requiredConfig(key: string): string {
    const value = this.config.get<string>(key)?.trim();
    if (!value) throw new Error(`${key} is not configured`);
    return value;
  }

  private normalizeEndpoint(value: string): string {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  private parseJson(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Volc search returned invalid JSON: ${text.slice(0, 200)}`);
    }
  }

  private inferExt(contentType: string, url: string): string {
    if (contentType.includes('png')) return 'png';
    if (contentType.includes('webp')) return 'webp';
    if (contentType.includes('gif')) return 'gif';
    const match = url.match(/\.([a-z0-9]{3,4})(?:[?#]|$)/i);
    if (match) return match[1].toLowerCase();
    return 'jpg';
  }
}
