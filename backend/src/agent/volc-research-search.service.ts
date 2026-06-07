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

interface ResearchCaseSeed {
  title: string;
  subtitle?: string;
  architect?: string;
  location?: string;
  category?: string;
  reason?: string;
  searchQueries: string[];
  imageSearchQueries: string[];
}

interface SeedSearchBundle {
  seed: ResearchCaseSeed;
  queries: string[];
  sources: AgentResearchSource[];
}

interface ResearchQueryProfile {
  subject?: string;
  aliases: string[];
  requiredTerms: string[];
  strict: boolean;
}

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

    const profile = this.buildQueryProfile(prompt);
    let keywords = this.buildKeywords(prompt, profile);
    const webCount = this.readInt('VOLC_SEARCH_WEB_COUNT', 12, 1, 20);
    const imageCount = this.readInt('VOLC_SEARCH_IMAGE_COUNT', 4, 1, 5);
    const requestedCaseCount = this.extractRequestedCaseCount(prompt);
    let sources: AgentResearchSource[] = [];
    let cases: SearchDerivedCase[] = [];

    const modelSeeds = await this.buildCaseSeedsWithModel(
      prompt,
      requestedCaseCount,
      profile,
    ).catch((error) => {
      this.logger.warn(
        `Failed to plan research case seeds: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    });
    const seeds = this.mergeCaseSeeds([
      ...modelSeeds,
      ...this.buildFallbackCaseSeeds(prompt, profile),
    ]).slice(0, requestedCaseCount);

    if (seeds.length > 0) {
      const seedBundles = await this.searchSourcesForSeeds(
        seeds.slice(0, requestedCaseCount),
        profile,
        webCount,
      );
      keywords = this.dedupeStrings(seedBundles.flatMap((bundle) => bundle.queries));
      sources = this.dedupeSources(seedBundles.flatMap((bundle) => bundle.sources));
      cases = await this.buildCasesFromSeedSearches(
        prompt,
        seedBundles,
        requestedCaseCount,
        profile,
      );
    }

    if (cases.length === 0 && !profile.strict) {
      sources = await this.searchWebSources(keywords, webCount);
      cases = await this.buildCasesFromSources(prompt, sources, requestedCaseCount, profile);
    }

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

  private buildKeywords(prompt: string, profile: ResearchQueryProfile): string[] {
    const normalized = String(prompt || '').replace(/\s+/g, ' ').trim();
    const keywords: string[] = [];
    if (normalized) keywords.push(normalized);

    if (profile.strict && profile.aliases.length > 0) {
      const primary = profile.aliases.join(' ');
      keywords.push(`${primary} 建筑案例 建筑作品 建筑师`);
      keywords.push(`${primary} architecture projects buildings case study`);
      keywords.push(`${primary} ArchDaily architecture project`);
      return Array.from(new Set(keywords)).slice(0, 4);
    }

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

  private async buildCaseSeedsWithModel(
    prompt: string,
    count: number,
    profile: ResearchQueryProfile,
  ): Promise<ResearchCaseSeed[]> {
    const model =
      this.config.get<string>('VOLC_SEARCH_SUMMARY_MODEL') ||
      this.config.get<string>('ARK_WEB_SEARCH_MODEL') ||
      'gemini-3.1-pro';
    const provider = this.providerFactory.getProvider(model, 'new-api');
    const result = await provider.generateText({
      model,
      enableWebSearch: false,
      prompt: [
        '你是建筑案例检索规划器。先把用户问题拆成具体建筑项目名称，再交给网页检索核验。',
        `用户需求：${prompt}`,
        `目标案例数量：${count}`,
        profile.strict
          ? `硬性主题/人物：${profile.aliases.join(' / ')}。候选项目必须属于这个主题/人物。`
          : '',
        '输出必须是 JSON，不要 Markdown，不要解释。',
        'JSON 格式：',
        '{"cases":[{"title":"中文项目名，不要写人物名或文章标题","subtitle":"英文/原名","architect":"建筑师","location":"地点","category":"类型 / 风格 / 研究点","reason":"为什么适合作为案例，50字以内","searchQueries":["用于网页检索的精确查询1","用于网页检索的精确查询2"],"imageSearchQueries":["用于图片检索的精确查询1","用于图片检索的精确查询2"]}]}',
        '规则：',
        '- title 必须是单个真实建筑项目/建筑作品名，例如“住吉的长屋”，不能是“安藤忠雄”、文章标题、作品合集、新闻标题或排行榜标题。',
        '- 如果用户问某位建筑师的案例，先列出该建筑师的具体作品名，再让后续网页搜索核验。',
        '- 可以用建筑常识规划候选名称，但不要编造不存在的项目；不确定就少返回。',
        '- searchQueries 必须包含项目名 + 建筑师/主题名，便于后续真实联网搜索。',
        '- imageSearchQueries 优先使用英文项目名 + architect + architecture。',
      ].join('\n'),
    });
    if (!result.success || !result.data?.text) return [];
    return this.normalizeCaseSeeds(result.data.text, profile).slice(0, count);
  }

  private normalizeCaseSeeds(text: string, profile: ResearchQueryProfile): ResearchCaseSeed[] {
    const parsed = this.parseJsonObject(text);
    const rawCases: any[] = Array.isArray(parsed?.cases) ? parsed.cases : [];
    return rawCases
      .map((item: any): ResearchCaseSeed | null => {
        const title = this.cleanText(item?.title);
        if (!this.isLikelyProjectTitle(title, profile)) return null;
        const subtitle = this.cleanText(item?.subtitle);
        const architect = this.cleanText(item?.architect);
        const location = this.cleanText(item?.location);
        const category = this.cleanText(item?.category);
        const reason = this.cleanText(item?.reason);
        const defaultQuery = [title, subtitle, architect || profile.aliases.join(' '), 'architecture']
          .filter(Boolean)
          .join(' ');
        const searchQueries = this.dedupeStrings([
          ...this.normalizeStringArray(item?.searchQueries),
          defaultQuery,
        ]).slice(0, 3);
        const imageSearchQueries = this.dedupeStrings([
          ...this.normalizeStringArray(item?.imageSearchQueries),
          [subtitle || title, architect || profile.aliases.join(' '), 'architecture'].filter(Boolean).join(' '),
          [subtitle || title, architect || profile.aliases.join(' '), 'interior exterior plan'].filter(Boolean).join(' '),
        ]).slice(0, 3);
        const seed = {
          title,
          subtitle,
          architect,
          location,
          category,
          reason,
          searchQueries,
          imageSearchQueries,
        };
        return this.seedMatchesProfile(seed, profile) ? seed : null;
      })
      .filter((item: ResearchCaseSeed | null): item is ResearchCaseSeed => Boolean(item));
  }

  private mergeCaseSeeds(seeds: ResearchCaseSeed[]): ResearchCaseSeed[] {
    const seen = new Set<string>();
    const result: ResearchCaseSeed[] = [];
    for (const seed of seeds) {
      const key = this.normalizeLooseText(seed.subtitle || seed.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(seed);
    }
    return result;
  }

  private buildFallbackCaseSeeds(
    prompt: string,
    profile: ResearchQueryProfile,
  ): ResearchCaseSeed[] {
    const haystack = `${prompt} ${profile.aliases.join(' ')}`;
    if (!/安藤忠雄|tadao\s+ando/i.test(haystack)) return [];

    return [
      this.createCaseSeed({
        title: '住吉的长屋',
        subtitle: 'Row House in Sumiyoshi / Azuma House',
        architect: '安藤忠雄 Tadao Ando',
        location: '日本大阪',
        category: '住宅 / 清水混凝土 / 光与庭院',
        reason: '早期成名作，以狭长住宅和中庭组织日常生活。',
      }),
      this.createCaseSeed({
        title: '光之教堂',
        subtitle: 'Church of the Light',
        architect: '安藤忠雄 Tadao Ando',
        location: '日本大阪府茨木市',
        category: '宗教建筑 / 清水混凝土 / 光影',
        reason: '以十字光缝和极简混凝土空间成为安藤代表作。',
      }),
      this.createCaseSeed({
        title: '水御堂',
        subtitle: 'Water Temple / Honpukuji Temple',
        architect: '安藤忠雄 Tadao Ando',
        location: '日本淡路岛',
        category: '宗教建筑 / 水庭 / 下沉空间',
        reason: '通过莲池、下沉路径和朱红内殿组织独特宗教体验。',
      }),
      this.createCaseSeed({
        title: '六甲集合住宅',
        subtitle: 'Rokko Housing',
        architect: '安藤忠雄 Tadao Ando',
        location: '日本神户',
        category: '集合住宅 / 山地地形 / 阶梯社区',
        reason: '顺应陡坡地形组织住宅单元和公共路径。',
      }),
      this.createCaseSeed({
        title: '地中美术馆',
        subtitle: 'Chichu Art Museum',
        architect: '安藤忠雄 Tadao Ando',
        location: '日本直岛',
        category: '美术馆 / 地景建筑 / 自然光',
        reason: '将美术馆埋入地景，以自然光组织展览体验。',
      }),
    ];
  }

  private createCaseSeed(seed: Omit<ResearchCaseSeed, 'searchQueries' | 'imageSearchQueries'>): ResearchCaseSeed {
    const base = [seed.title, seed.subtitle, seed.architect].filter(Boolean).join(' ');
    return {
      ...seed,
      searchQueries: this.dedupeStrings([
        [seed.title, seed.architect, '建筑'].filter(Boolean).join(' '),
        [seed.subtitle || seed.title, seed.architect, 'architecture project'].filter(Boolean).join(' '),
        [seed.subtitle || seed.title, seed.architect, 'ArchDaily'].filter(Boolean).join(' '),
      ]),
      imageSearchQueries: this.dedupeStrings([
        [seed.subtitle || seed.title, seed.architect, 'architecture exterior interior'].filter(Boolean).join(' '),
        [seed.subtitle || seed.title, seed.architect, 'plan section detail'].filter(Boolean).join(' '),
        base,
      ]),
    };
  }

  private async searchSourcesForSeeds(
    seeds: ResearchCaseSeed[],
    profile: ResearchQueryProfile,
    webCount: number,
  ): Promise<SeedSearchBundle[]> {
    const perSeedCount = Math.max(2, Math.ceil(webCount / Math.max(1, seeds.length)));
    return Promise.all(
      seeds.map(async (seed) => {
        const queries = this.caseSeedWebQueries(seed, profile);
        const rawSources = await this.searchWebSources(queries, perSeedCount);
        const rankedSources = this.rankSourcesForSeed(rawSources, seed, profile);
        const sources = (rankedSources.length > 0 ? rankedSources : rawSources).slice(
          0,
          perSeedCount,
        );
        return { seed, queries, sources };
      }),
    );
  }

  private caseSeedWebQueries(seed: ResearchCaseSeed, profile: ResearchQueryProfile): string[] {
    const subject = seed.architect || profile.aliases.join(' ');
    return this.dedupeStrings([
      ...seed.searchQueries,
      [seed.title, subject, '建筑'].filter(Boolean).join(' '),
      [seed.subtitle || seed.title, subject, 'architecture project'].filter(Boolean).join(' '),
      [seed.subtitle || seed.title, subject, 'ArchDaily'].filter(Boolean).join(' '),
    ]).slice(0, 3);
  }

  private async buildCasesFromSeedSearches(
    prompt: string,
    bundles: SeedSearchBundle[],
    count: number,
    profile: ResearchQueryProfile,
  ): Promise<SearchDerivedCase[]> {
    const searchableBundles = bundles.filter((bundle) => bundle.sources.length > 0);
    if (searchableBundles.length === 0) return [];
    const aiCases = await this.buildCasesWithModelFromSeedSearches(
      prompt,
      searchableBundles,
      count,
      profile,
    ).catch((error) => {
      this.logger.warn(
        `Failed to summarize seed research cases with model: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    });
    if (aiCases.length > 0) return aiCases.slice(0, count);
    return this.buildCasesFromSeedsHeuristically(searchableBundles, count, profile);
  }

  private async buildCasesWithModelFromSeedSearches(
    prompt: string,
    bundles: SeedSearchBundle[],
    count: number,
    profile: ResearchQueryProfile,
  ): Promise<SearchDerivedCase[]> {
    const model =
      this.config.get<string>('VOLC_SEARCH_SUMMARY_MODEL') ||
      this.config.get<string>('ARK_WEB_SEARCH_MODEL') ||
      'gemini-3.1-pro';
    const provider = this.providerFactory.getProvider(model, 'new-api');
    const allSources = this.dedupeSources(bundles.flatMap((bundle) => bundle.sources));
    const bundleLines = bundles
      .map((bundle, bundleIndex) => {
        const sourceLines = bundle.sources
          .map((source, sourceIndex) => {
            return [
              `source ${bundleIndex + 1}.${sourceIndex + 1}`,
              `title: ${source.title}`,
              `url: ${source.url}`,
              source.sourceName ? `site: ${source.sourceName}` : '',
              source.snippet ? `snippet: ${source.snippet}` : '',
            ]
              .filter(Boolean)
              .join('\n');
          })
          .join('\n\n');
        return [
          `candidate: ${bundle.seed.title}`,
          bundle.seed.subtitle ? `originalName: ${bundle.seed.subtitle}` : '',
          bundle.seed.architect ? `architect: ${bundle.seed.architect}` : '',
          bundle.seed.location ? `locationHint: ${bundle.seed.location}` : '',
          bundle.seed.reason ? `reasonHint: ${bundle.seed.reason}` : '',
          'sources:',
          sourceLines,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n---\n\n');

    const result = await provider.generateText({
      model,
      enableWebSearch: false,
      prompt: [
        '你是建筑案例研究助理。输入已经按“候选建筑项目”分组，并且每组下面是该项目的真实网页搜索结果。',
        `用户需求：${prompt}`,
        `目标案例数量：${count}`,
        profile.strict
          ? `硬性主题/人物：${profile.aliases.join(' / ')}。每个案例必须属于这个主题/人物。`
          : '',
        '输出必须是 JSON，不要 Markdown，不要解释。',
        'JSON 格式：',
        '{"cases":[{"title":"建筑项目中文名","subtitle":"英文/原名","architect":"建筑师","location":"地点","category":"3 个以内分类，用 / 分隔","summary":"70字以内，说明这个项目为什么值得研究","highlights":["要点1","要点2","要点3","要点4"],"imageSearchQueries":["适合搜图的英文查询1","适合搜图的英文查询2"],"sourceUrls":["必须来自输入 sources 的 url"]}]}',
        '规则：',
        '- 一张卡片只对应一个候选建筑项目，不能把一个文章里的多个作品合并成一张卡片。',
        '- title 必须是建筑项目名，不能是建筑师名、文章标题、新闻标题、榜单标题或作品合集标题。',
        '- sourceUrls 只能使用该候选项目分组下的 URL；如果该分组资料不足就跳过。',
        '- 如果资料不足，少返回案例，不要编造。',
        '',
        '候选项目与搜索结果：',
        bundleLines,
      ].join('\n'),
    });
    if (!result.success || !result.data?.text) return [];
    return this.normalizeModelCases(result.data.text, allSources, profile)
      .filter((item) => this.isLikelyProjectTitle(item.title, profile))
      .filter((item) => this.caseMatchesAnySeed(item, bundles.map((bundle) => bundle.seed)));
  }

  private buildCasesFromSeedsHeuristically(
    bundles: SeedSearchBundle[],
    count: number,
    profile: ResearchQueryProfile,
  ): SearchDerivedCase[] {
    return bundles
      .map((bundle): SearchDerivedCase | null => {
        const seed = bundle.seed;
        if (!this.isLikelyProjectTitle(seed.title, profile)) return null;
        const sources = bundle.sources.slice(0, 3);
        if (sources.length === 0) return null;
        return {
          id: this.slugify(`${seed.title}-${seed.architect || profile.aliases.join('-')}`),
          title: seed.title,
          subtitle: seed.subtitle,
          architect: seed.architect || profile.aliases.join(' / '),
          location: seed.location,
          category: seed.category || '建筑案例 / 资料检索 / 图像参考',
          summary:
            seed.reason ||
            sources[0]?.snippet ||
            '由文本规划出的建筑项目，并通过真实网页检索结果进行来源校验。',
          highlights: ['项目名先行', '真实网页校验', '资料可追溯', '图像参考'],
          sources: sources.slice(0, 3),
          images: [],
          imageSearchQueries: seed.imageSearchQueries,
        };
      })
      .filter((item: SearchDerivedCase | null): item is SearchDerivedCase => Boolean(item))
      .filter((item) => this.caseMatchesProfile(item, profile))
      .slice(0, count);
  }

  private async buildCasesFromSources(
    prompt: string,
    sources: AgentResearchSource[],
    count: number,
    profile: ResearchQueryProfile,
  ): Promise<SearchDerivedCase[]> {
    if (sources.length === 0) return [];
    const aiCases = await this.buildCasesWithModel(prompt, sources, count, profile).catch((error) => {
      this.logger.warn(
        `Failed to build research cases with model: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    });
    if (aiCases.length > 0) return aiCases.slice(0, count);
    return this.buildCasesHeuristically(prompt, sources, count, profile);
  }

  private async buildCasesWithModel(
    prompt: string,
    sources: AgentResearchSource[],
    count: number,
    profile: ResearchQueryProfile,
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
        profile.strict
          ? `硬性主题/人物：${profile.aliases.join(' / ')}。每个返回案例必须明显属于这个主题/人物；不符合就不要返回。`
          : '',
        '输出必须是 JSON，不要 Markdown，不要解释。',
        'JSON 格式：',
        '{"title":"...","cases":[{"title":"中文案例名","subtitle":"英文/原名","architect":"建筑师","location":"地点","category":"3 个以内分类，用 / 分隔","summary":"70字以内，说明为什么值得研究","highlights":["要点1","要点2","要点3","要点4"],"imageSearchQueries":["适合搜图的英文查询1","适合搜图的英文查询2"],"sourceUrls":["必须来自给定搜索结果的 url"]}]}',
        '规则：',
        '- 每个案例必须能在搜索结果中找到依据。',
        '- sourceUrls 只能使用给定搜索结果里的 url。',
        '- 如果资料不足，少返回案例，不要编造。',
        '- 用户点名建筑师、人物、地点或作品类型时，这是硬性过滤条件，不能用其他建筑师案例补足数量。',
        '- 优先建筑师/项目名/地点明确的案例。',
        '',
        '搜索结果：',
        sourceLines,
      ].join('\n'),
    });
    if (!result.success || !result.data?.text) return [];
    return this.normalizeModelCases(result.data.text, sources, profile);
  }

  private normalizeModelCases(
    text: string,
    sources: AgentResearchSource[],
    profile: ResearchQueryProfile,
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
      .filter((item: SearchDerivedCase | null): item is SearchDerivedCase => Boolean(item))
      .filter((item) => this.caseMatchesProfile(item, profile));
  }

  private buildCasesHeuristically(
    prompt: string,
    sources: AgentResearchSource[],
    count: number,
    profile: ResearchQueryProfile,
  ): SearchDerivedCase[] {
    const scopedSources = profile.strict
      ? sources.filter((source) => this.sourceMatchesProfile(source, profile))
      : sources;
    return scopedSources.slice(0, count).map((source, index) => {
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

  private buildQueryProfile(prompt: string): ResearchQueryProfile {
    const subject = this.extractRequestedSubject(prompt);
    const aliasMap: Array<{ match: RegExp; aliases: string[] }> = [
      { match: /安藤忠雄|tadao\s+ando/i, aliases: ['安藤忠雄', 'Tadao Ando'] },
      { match: /扎哈[·\s-]*哈迪德|zaha\s+hadid/i, aliases: ['扎哈·哈迪德', 'Zaha Hadid'] },
      { match: /伊东丰雄|伊東豊雄|toyo\s+ito/i, aliases: ['伊东丰雄', 'Toyo Ito'] },
      { match: /彼得[·\s-]*卒姆托|peter\s+zumthor/i, aliases: ['彼得·卒姆托', 'Peter Zumthor'] },
      { match: /路易斯[·\s-]*康|louis\s+kahn/i, aliases: ['路易斯·康', 'Louis Kahn'] },
    ];
    const haystack = `${prompt} ${subject || ''}`;
    const known = aliasMap.find((item) => item.match.test(haystack));
    const aliases = known?.aliases || (subject ? [subject] : []);
    return {
      subject,
      aliases,
      requiredTerms: aliases,
      strict: aliases.length > 0,
    };
  }

  private extractRequestedSubject(prompt: string): string | undefined {
    const raw = String(prompt || '').replace(/\s+/g, ' ').trim();
    if (!raw) return undefined;

    const match = raw.match(
      /(?:帮我|请|给我|麻烦)?(?:找|搜索|检索|推荐|整理|列出)?\s*(?:[一二两三四五六七八九十两\d]+\s*(?:个|组|则|篇)?)?\s*([^，。,.!?！？]{2,40}?)(?:的)?(?:建筑案例|建筑作品|建筑项目|建筑|作品|项目|案例)/i,
    );
    const candidate = this.cleanSubject(match?.[1] || '');
    if (candidate && !this.isGenericResearchSubject(candidate)) return candidate;

    const knownArchitect = raw.match(/安藤忠雄|tadao\s+ando|扎哈[·\s-]*哈迪德|zaha\s+hadid|伊东丰雄|伊東豊雄|toyo\s+ito|彼得[·\s-]*卒姆托|peter\s+zumthor|路易斯[·\s-]*康|louis\s+kahn/i);
    return knownArchitect?.[0];
  }

  private cleanSubject(value: string): string {
    return this.cleanText(value)
      .replace(/^(帮我|请|给我|麻烦|找|搜索|检索|推荐|整理|列出|关于|一些|几个)+/g, '')
      .replace(/^[一二两三四五六七八九十\d]+\s*(个|组|则|篇)?/g, '')
      .replace(/^(优秀|经典|著名|知名|真实|参考)+/g, '')
      .replace(/的$/g, '')
      .trim();
  }

  private isGenericResearchSubject(value: string): boolean {
    const normalized = value.replace(/\s+/g, '').toLowerCase();
    return [
      '建筑',
      '建筑案例',
      '案例',
      '作品',
      '项目',
      '资料',
      '参考',
      '优秀建筑',
      '经典建筑',
      '教堂',
      '学校',
      '校园',
    ].includes(normalized);
  }

  private caseMatchesProfile(item: SearchDerivedCase, profile: ResearchQueryProfile): boolean {
    if (!profile.strict) return true;
    const haystack = this.normalizeMatchText(
      [
        item.title,
        item.subtitle,
        item.architect,
        item.location,
        item.category,
        item.summary,
        ...item.highlights,
        ...item.sources.flatMap((source) => [
          source.title,
          source.snippet,
          source.sourceName,
          source.url,
        ]),
      ].join(' '),
    );
    return profile.requiredTerms.some((term) => haystack.includes(this.normalizeMatchText(term)));
  }

  private sourceMatchesProfile(
    source: AgentResearchSource,
    profile: ResearchQueryProfile,
  ): boolean {
    if (!profile.strict) return true;
    const haystack = this.normalizeMatchText(
      [source.title, source.snippet, source.sourceName, source.url].join(' '),
    );
    return profile.requiredTerms.some((term) => haystack.includes(this.normalizeMatchText(term)));
  }

  private seedMatchesProfile(seed: ResearchCaseSeed, profile: ResearchQueryProfile): boolean {
    if (!profile.strict) return true;
    const haystack = this.normalizeMatchText(
      [
        seed.title,
        seed.subtitle,
        seed.architect,
        seed.location,
        seed.category,
        seed.reason,
        ...seed.searchQueries,
        ...seed.imageSearchQueries,
      ].join(' '),
    );
    return profile.requiredTerms.some((term) => haystack.includes(this.normalizeMatchText(term)));
  }

  private caseMatchesAnySeed(item: SearchDerivedCase, seeds: ResearchCaseSeed[]): boolean {
    const haystack = this.normalizeLooseText(
      [
        item.title,
        item.subtitle,
        item.architect,
        item.location,
        item.summary,
        ...item.sources.flatMap((source) => [source.title, source.snippet, source.url]),
      ].join(' '),
    );
    return seeds.some((seed) =>
      this.seedTitleVariants(seed).some((term) => term && haystack.includes(term)),
    );
  }

  private sourceMatchesSeed(source: AgentResearchSource, seed: ResearchCaseSeed): boolean {
    return this.scoreSourceForSeed(source, seed) > 0;
  }

  private rankSourcesForSeed(
    sources: AgentResearchSource[],
    seed: ResearchCaseSeed,
    profile: ResearchQueryProfile,
  ): AgentResearchSource[] {
    const scored = sources
      .map((source, index) => ({
        source,
        index,
        score: this.scoreSourceForSeed(source, seed, profile),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);
    return scored.map((item) => item.source);
  }

  private scoreSourceForSeed(
    source: AgentResearchSource,
    seed: ResearchCaseSeed,
    profile?: ResearchQueryProfile,
  ): number {
    const haystack = this.normalizeLooseText(
      [source.title, source.snippet, source.sourceName, source.url].join(' '),
    );
    let score = 0;
    for (const term of this.seedTitleVariants(seed)) {
      if (term && haystack.includes(term)) score += term.length >= 6 ? 6 : 4;
    }
    const architectTerms = this.dedupeStrings([
      seed.architect || '',
      ...(profile?.aliases || []),
    ]).map((term) => this.normalizeLooseText(term));
    for (const term of architectTerms) {
      if (term && haystack.includes(term)) score += 2;
    }
    const queryTokenHits = this.dedupeStrings(seed.searchQueries)
      .flatMap((query) => this.queryTokens(query))
      .filter((token) => haystack.includes(token)).length;
    return score + Math.min(queryTokenHits, 3);
  }

  private seedTitleVariants(seed: ResearchCaseSeed): string[] {
    const rawTerms = [seed.title, seed.subtitle].filter(Boolean) as string[];
    const variants = rawTerms.flatMap((term) => {
      const normalized = this.normalizeLooseText(term);
      const withoutDe = normalized.replace(/的/g, '');
      return [normalized, withoutDe];
    });
    return this.dedupeStrings(variants).filter((term) => term.length >= 2);
  }

  private isLikelyProjectTitle(title: string, profile: ResearchQueryProfile): boolean {
    const value = this.cleanText(title);
    if (!value) return false;
    if (value.length > 80) return false;
    if (/[：:｜|]/.test(value)) return false;

    const loose = this.normalizeLooseText(value);
    if (!loose) return false;
    if (profile.aliases.some((alias) => loose === this.normalizeLooseText(alias))) {
      return false;
    }
    if (
      /十大|精选|代表作|代表作品|作品集|合集|盘点|排行榜|新闻|新作|访谈|文章|史诗|资料检索|图像参考/.test(
        value,
      )
    ) {
      return false;
    }
    if (/建筑师|设计师|诗人/.test(value) && profile.aliases.some((alias) => value.includes(alias))) {
      return false;
    }
    return true;
  }

  private normalizeMatchText(value: string): string {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private normalizeLooseText(value: string): string {
    return String(value || '')
      .toLowerCase()
      .replace(/[\s\-_:：|｜·・,，。.!！?？()[\]（）【】"'“”‘’/\\]+/g, '')
      .trim();
  }

  private queryTokens(query: string): string[] {
    return this.dedupeStrings(
      String(query || '')
        .split(/[\s,，。/|｜:：()[\]（）【】"'“”‘’]+/g)
        .map((token) => this.normalizeLooseText(token))
        .filter((token) => token.length >= 3),
    );
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

  private dedupeStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
      const normalized = this.cleanText(value);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(normalized);
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
