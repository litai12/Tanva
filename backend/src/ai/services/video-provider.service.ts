// Video provider integration (Kling/Vidu/Seedance) with OSS post-processing.
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { VideoProviderRequestDto } from "../dto/video-provider.dto";
import type { ReferenceImageItem } from "../dto/video-provider.dto";
import { OssService } from "../../oss/oss.service";
import { Readable } from "node:stream";
import { TencentVodAigcService } from "./tencent-vod-aigc.service";
import {
  ModelRoutingService,
  type ResolvedManagedModelRoute,
} from "./model-routing.service";
import type { TencentVodAigcCreateVideoTaskRequest } from "./tencent-vod-aigc.service";
import { VolcAssetService } from "../../volc-asset/volc-asset.service";

// 默认请求超时时间（毫秒）
const DEFAULT_FETCH_TIMEOUT = 180000; // 3分钟
const QUERY_FETCH_TIMEOUT = 60000; // 60秒（避免触发阿里云 ESA 300秒超时限制，采用短超时+快速轮询策略）
const IMAGE_FETCH_TIMEOUT = 60000;
const MANAGED_IMAGE_KEY_REGEX = /^(projects|uploads|templates|videos|ai)\//i;
const MANAGED_KLING26_TENCENT_TASK_PREFIX = "tencentvod-kling26-";
const MANAGED_KLING30_TENCENT_TASK_PREFIX = "tencentvod-kling30-";
const MANAGED_VIDU_TENCENT_PREFIX = "tencentvod-vidu-";

type ManagedTencentVideoModelKey =
  | "kling-2.6"
  | "kling-3.0"
  | "vidu-q2"
  | "vidu-q3"
  | "seedance-1.5"
  | "seedance-2.0";

const MANAGED_TENCENT_VIDEO_MODEL_META: Record<
  ManagedTencentVideoModelKey,
  { prefix: string; label: string; uploadKeyPrefix: string }
> = {
  "kling-2.6": {
    prefix: MANAGED_KLING26_TENCENT_TASK_PREFIX,
    label: "Kling 2.6",
    uploadKeyPrefix: "kling-2.6",
  },
  "kling-3.0": {
    prefix: MANAGED_KLING30_TENCENT_TASK_PREFIX,
    label: "Kling 3.0",
    uploadKeyPrefix: "kling-3.0",
  },
  "vidu-q2": {
    prefix: `${MANAGED_VIDU_TENCENT_PREFIX}q2-`,
    label: "Vidu Q2",
    uploadKeyPrefix: "vidu-q2",
  },
  "vidu-q3": {
    prefix: `${MANAGED_VIDU_TENCENT_PREFIX}q3-`,
    label: "Vidu Q3",
    uploadKeyPrefix: "vidu-q3",
  },
  "seedance-1.5": {
    prefix: "tencentvod-seedance15-",
    label: "Seedance 1.5-Pro",
    uploadKeyPrefix: "seedance-1.5",
  },
  "seedance-2.0": {
    prefix: "tencentvod-seedance20-",
    label: "Seedance 2.0",
    uploadKeyPrefix: "seedance-2.0",
  },
};

type ViduManagedModelVersion = "q2" | "q3";

type SeedanceManagedModelVersion =
  | "1.5-pro"
  | "2.0"
  | "2.0-pro"
  | "2.0-lite"
  | "2.0-mini";

type ManagedV2ExecutionBranch = "legacy" | "v2_request_profile";

type ManagedV2RequestStage = {
  method?: string;
  path?: string;
  headers?: Record<string, any>;
  query?: Record<string, any>;
  body?: any;
  responseMapping?: Record<string, string[]>;
};

type ManagedV2RequestProfile = {
  enabled?: boolean;
  version?: string;
  transport?: string;
  create?: ManagedV2RequestStage;
  query?: ManagedV2RequestStage;
};

type ManagedV2ParsedTask = {
  modelKey: string;
  vendorKey: string;
  rawTaskId: string;
};

const resolveSeedanceUpstreamModelId = (modelVersion: SeedanceManagedModelVersion): string => {
  switch (modelVersion) {
    case "2.0-pro":
      return "doubao-seedance-2-0-260128";
    case "2.0-lite":
      return "doubao-seedance-2-0-fast-260128";
    case "2.0-mini":
      return "doubao-seedance-2-0-fast-260128";
    case "2.0":
      return "doubao-seedance-2-0-260128";
    default:
      return "doubao-seedance-1-5-pro-251215";
  }
};

const normalizeSeedanceUpstreamModelIdAlias = (
  rawModelId: string,
): string => {
  const normalized = rawModelId.trim().toLowerCase();
  if (!normalized) return rawModelId;

  if (normalized === "doubao-seed-2-0-pro") {
    return "doubao-seedance-2-0-260128";
  }
  if (normalized === "doubao-seed-2-0-lite") {
    return "doubao-seedance-2-0-fast-260128";
  }
  if (normalized === "doubao-seed-2-0-mini") {
    return "doubao-seedance-2-0-fast-260128";
  }
  if (normalized === "doubao-seed-2-0-pro-260215") {
    return "doubao-seedance-2-0-260128";
  }
  if (
    normalized === "doubao-seed-2-0-lite-260428" ||
    normalized === "doubao-seed-2-0-mini-260428"
  ) {
    return "doubao-seedance-2-0-fast-260128";
  }
  if (normalized === "doubao-seedance-2-0") {
    return "doubao-seedance-2-0-260128";
  }

  return rawModelId;
};

/**
 * 带超时的 fetch 请求
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = DEFAULT_FETCH_TIMEOUT, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`请求超时 (${timeout}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface VideoGenerationResult {
  taskId: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  videoUrl?: string;
  thumbnailUrl?: string;
  execution?: {
    modelKey?: string;
    vendorKey?: string;
    platformKey?: string;
    route?: "legacy" | "tencent_vod" | "new-api";
    providerChannel?: string;
    routedProvider?: string;
    fallbackUsed?: boolean;
  };
}

@Injectable()
export class VideoProviderService {
  private readonly logger = new Logger(VideoProviderService.name);
  private readonly doubaoVideoCache = new Map<string, { url: string; touchedAt: number }>();
  private readonly doubaoVideoCacheTtlMs = 60 * 60 * 1000;
  private readonly doubaoVideoCacheMaxEntries = 500;
  private readonly managedV2TaskPrefix = "managedv2:";
  private readonly newApiTaskPrefix = "newapi:";
  private readonly newApiBaseUrl = (process.env.NEW_API_BASE_URL || "http://localhost:4458").replace(/\/+$/, "");
  private readonly newApiKey = process.env.NEW_API_KEY || process.env.NEW_API_TOKEN || "";

  constructor(
    private readonly oss: OssService,
    private readonly tencentVodAigcService: TencentVodAigcService,
    private readonly modelRoutingService: ModelRoutingService,
    private readonly volcAssetService: VolcAssetService,
  ) {}

  private getCachedDoubaoVideoUrl(taskId: string): string | null {
    const cached = this.doubaoVideoCache.get(taskId);
    if (!cached) return null;
    if (Date.now() - cached.touchedAt > this.doubaoVideoCacheTtlMs) {
      this.doubaoVideoCache.delete(taskId);
      return null;
    }
    cached.touchedAt = Date.now();
    return cached.url;
  }

  private rememberDoubaoVideoUrl(taskId: string, url: string): void {
    const now = Date.now();
    this.doubaoVideoCache.set(taskId, { url, touchedAt: now });

    for (const [key, value] of this.doubaoVideoCache.entries()) {
      if (now - value.touchedAt > this.doubaoVideoCacheTtlMs) {
        this.doubaoVideoCache.delete(key);
      }
    }

    if (this.doubaoVideoCache.size <= this.doubaoVideoCacheMaxEntries) return;
    const overflow = this.doubaoVideoCache.size - this.doubaoVideoCacheMaxEntries;
    const oldestKeys = Array.from(this.doubaoVideoCache.entries())
      .sort((a, b) => a[1].touchedAt - b[1].touchedAt)
      .slice(0, overflow)
      .map(([key]) => key);
    oldestKeys.forEach((key) => this.doubaoVideoCache.delete(key));
  }

  private withExecutionMetadata(
    result: VideoGenerationResult,
    route: ResolvedManagedModelRoute,
    fallbackUsed: boolean,
  ): VideoGenerationResult {
    return {
      ...result,
      execution: {
        modelKey: route.model.modelKey,
        vendorKey: route.vendor.vendorKey,
        platformKey: route.vendor.platformKey || route.vendor.vendorKey,
        route: route.route,
        providerChannel: route.vendor.platformKey || route.vendor.vendorKey,
        routedProvider: route.vendor.provider || undefined,
        fallbackUsed,
      },
    };
  }

  private summarizeError(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    return String(error);
  }

  private shouldFallbackToAlternativeRoute(error: unknown): boolean {
    if (error instanceof ServiceUnavailableException) return true;
    if (error instanceof BadRequestException) return false;
    const message = this.summarizeError(error);
    return /(暂不支持|未配置|未找到|不可用|unavailable|not support|not supported)/i.test(message);
  }

  private isSeedanceReferenceMediaConflictError(error: unknown): boolean {
    return /first\/last frame content cannot be mixed with reference media content|cannot be mixed with reference media content/i.test(
      this.summarizeError(error),
    );
  }

  private async executeManagedRouteWithFallback(
    modelKey: string,
    preferredVendorKey: string | undefined,
    executor: (route: ResolvedManagedModelRoute) => Promise<VideoGenerationResult>,
  ): Promise<VideoGenerationResult | null> {
    const candidates = await this.modelRoutingService.resolveVideoModelCandidates(
      modelKey,
      preferredVendorKey,
    );
    if (!candidates.length) return null;

    let lastError: unknown = null;
    for (let index = 0; index < candidates.length; index += 1) {
      const route = candidates[index];
      const fallbackUsed = index > 0;
      try {
        const result = await executor(route);
        if (fallbackUsed) {
          this.logger.warn(
            `Video generation fallback succeeded for ${modelKey}: vendor=${route.vendor.vendorKey}, route=${route.route}`,
          );
        }
        return this.withExecutionMetadata(result, route, fallbackUsed);
      } catch (error) {
        lastError = error;
        const canFallback =
          index < candidates.length - 1 && this.shouldFallbackToAlternativeRoute(error);
        this.logger.warn(
          `Video generation route failed for ${modelKey}: vendor=${route.vendor.vendorKey}, route=${route.route}, fallback=${canFallback ? "next" : "stop"}, error=${this.summarizeError(error)}`,
        );
        if (!canFallback) {
          throw error;
        }
      }
    }

    if (lastError) throw lastError;
    return null;
  }

  private resolveOssHosts(): string[] {
    return this.oss.publicHosts();
  }

  private isOssPublicUrl(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      const ossHosts = this.resolveOssHosts();
      return ossHosts.some(
        (ossHost) => host === ossHost || host.endsWith("." + ossHost)
      );
    } catch {
      return false;
    }
  }

  private isAllowedUpstreamHost(hostname: string): boolean {
    const allowed = this.oss.allowedPublicHosts();
    return allowed.some(
      (host) => hostname === host || hostname.endsWith("." + host)
    );
  }

  private extractManagedImageKey(input: string): string | null {
    const trimmed = typeof input === "string" ? input.trim() : "";
    if (!trimmed) return null;

    const normalizeKey = (raw?: string | null): string | null => {
      const value = typeof raw === "string" ? raw.trim().replace(/^\/+/, "") : "";
      if (!value) return null;
      return MANAGED_IMAGE_KEY_REGEX.test(value) ? value : null;
    };

    const normalizedDirect = normalizeKey(trimmed);
    if (normalizedDirect) return normalizedDirect;

    try {
      const parsed = new URL(trimmed);
      const keyFromPath = normalizeKey(parsed.pathname);
      if (keyFromPath) return keyFromPath;

      const keyFromQuery = normalizeKey(parsed.searchParams.get("key"));
      if (keyFromQuery) return keyFromQuery;

      const nestedUrl = parsed.searchParams.get("url");
      if (nestedUrl && nestedUrl !== trimmed) {
        const keyFromNested = this.extractManagedImageKey(nestedUrl);
        if (keyFromNested) return keyFromNested;
      }
    } catch {
      // ignore
    }

    return null;
  }

  private buildBucketOriginUrlForKey(key: string): string | null {
    const normalizedKey = typeof key === "string" ? key.trim().replace(/^\/+/, "") : "";
    if (!normalizedKey) return null;
    const [bucketOriginHost] = this.resolveOssHosts();
    if (!bucketOriginHost) return null;
    return `https://${bucketOriginHost}/${normalizedKey}`;
  }

  private normalizeManagedAssetUrlForUpstream(input: string): string {
    const trimmed = typeof input === "string" ? input.trim() : "";
    if (!trimmed) return "";
    const managedKey = this.extractManagedImageKey(trimmed);
    if (!managedKey) return trimmed;
    return this.buildBucketOriginUrlForKey(managedKey) || this.oss.publicUrl(managedKey);
  }

  private buildImageFetchCandidates(imageUrl: string): string[] {
    const trimmed = typeof imageUrl === "string" ? imageUrl.trim() : "";
    if (!trimmed) return [];

    const candidates: string[] = [];
    const pushCandidate = (candidate?: string | null) => {
      const value = typeof candidate === "string" ? candidate.trim() : "";
      if (!value) return;
      if (!/^https?:\/\//i.test(value)) return;
      if (!candidates.includes(value)) {
        candidates.push(value);
      }
    };

    pushCandidate(trimmed);

    const managedKey = this.extractManagedImageKey(trimmed);
    if (managedKey) {
      pushCandidate(this.buildBucketOriginUrlForKey(managedKey));
      pushCandidate(this.oss.publicUrl(managedKey));
    }

    try {
      const parsed = new URL(trimmed);
      const nestedUrl = parsed.searchParams.get("url");
      if (nestedUrl) {
        pushCandidate(nestedUrl);
        const nestedKey = this.extractManagedImageKey(nestedUrl);
        if (nestedKey) {
          pushCandidate(this.buildBucketOriginUrlForKey(nestedKey));
          pushCandidate(this.oss.publicUrl(nestedKey));
        }
      }
    } catch {
      // ignore
    }

    return candidates;
  }

  private async uploadRemoteVideoToOss(
    sourceUrl: string,
    taskId: string
  ): Promise<string> {
    if (!this.oss.isEnabled()) {
      throw new ServiceUnavailableException("OSS 未配置，无法上传视频");
    }

    const cached = this.getCachedDoubaoVideoUrl(taskId);
    if (cached) return cached;

    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      throw new BadRequestException("视频 URL 无效");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new BadRequestException("视频 URL 协议不支持");
    }

    if (!this.isAllowedUpstreamHost(parsed.hostname)) {
      this.logger.warn(`视频来源域名不在白名单: ${parsed.hostname}`);
      // 不抛出异常，直接返回原始 URL
      return sourceUrl;
    }

    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `视频拉取失败: HTTP ${response.status}`
      );
    }

    const body = response.body;
    if (!body) {
      throw new ServiceUnavailableException("视频响应为空");
    }

    const contentType = response.headers.get("content-type") || "video/mp4";
    const extension =
      contentType.includes("video/") && contentType.split("/")[1]
        ? contentType.split("/")[1].split(";")[0].trim()
        : "mp4";

    // 根据 taskId 前缀确定存储路径
    const provider = taskId.startsWith("vidu-") ? "vidu"
      : taskId.startsWith("kling-") ? "kling"
      : "doubao";
    const key = `ai/videos/${provider}/${taskId}-${Date.now()}.${extension}`;

    const fromWeb = (Readable as unknown as { fromWeb?: (stream: unknown) => Readable })
      .fromWeb;
    const nodeStream =
      typeof fromWeb === "function"
        ? fromWeb(body as unknown)
        : Readable.from(Buffer.from(await response.arrayBuffer()));

    const { url } = await this.oss.putStream(key, nodeStream, {
      headers: { "Content-Type": contentType },
    });

    this.rememberDoubaoVideoUrl(taskId, url);
    return url;
  }

  private async uploadBase64ImageToOSS(
    base64Data: string,
    mimeType: string = "image/png"
  ): Promise<string> {
    try {
      const input = typeof base64Data === "string" ? base64Data.trim() : "";
      if (!input) {
        throw new Error("Empty image input");
      }

      const managedKey = this.extractManagedImageKey(input);
      if (managedKey) {
        return this.normalizeManagedAssetUrlForUpstream(input);
      }

      if (input.startsWith("http://") || input.startsWith("https://")) {
        this.logger.log(`📎 Image is a URL, downloading: ${input.substring(0, 100)}...`);

        // 如果已经是 OSS URL，直接返回
        if (this.isOssPublicUrl(input)) {
          return input;
        }

        // 下载远程图片并上传到 OSS（对托管资源增加 OSS 原始域名候选，避免 CDN 在服务端/上游不可达）
        const fetchCandidates = this.buildImageFetchCandidates(input);
        if (!fetchCandidates.length) {
          throw new Error("Failed to fetch image: no valid candidate URL");
        }

        let imageBuffer: Buffer | null = null;
        let contentType = "image/jpeg";
        const errors: string[] = [];

        for (const candidate of fetchCandidates) {
          try {
            const response = await fetchWithTimeout(candidate, {
              method: "GET",
              timeout: IMAGE_FETCH_TIMEOUT,
            });
            if (!response.ok) {
              errors.push(`${candidate} -> HTTP ${response.status}`);
              continue;
            }
            const nextContentType = response.headers.get("content-type") || "image/jpeg";
            if (!nextContentType.toLowerCase().startsWith("image/")) {
              errors.push(`${candidate} -> invalid content-type ${nextContentType}`);
              continue;
            }
            imageBuffer = Buffer.from(await response.arrayBuffer());
            if (!imageBuffer.length) {
              errors.push(`${candidate} -> empty body`);
              continue;
            }
            contentType = nextContentType;
            break;
          } catch (error) {
            errors.push(
              `${candidate} -> ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }

        if (!imageBuffer) {
          throw new Error(
            `Failed to fetch image from all candidates: ${errors
              .slice(0, 3)
              .join(" | ")}`
          );
        }

        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 8);
        const rawExtension = contentType.split("/")[1]?.split(";")[0] || "jpg";
        const extension = /^[a-z0-9]+$/i.test(rawExtension) ? rawExtension.toLowerCase() : "jpg";
        const key = `ai/images/video-provider-inputs/${timestamp}-${randomId}.${extension}`;

        const result = await this.oss.putStream(
          key,
          Readable.from(imageBuffer)
        );

        this.logger.log(`📤 Downloaded and uploaded image to OSS: ${result.url}`);
        return result.url;
      }

      const cleanBase64 = input.includes("base64,")
        ? input.split("base64,")[1]
        : input;

      const imageBuffer = Buffer.from(cleanBase64, "base64");
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const extension = mimeType.split("/")[1] || "png";
      const key = `ai/images/kling-inputs/${timestamp}-${randomId}.${extension}`;

      const result = await this.oss.putStream(
        key,
        Readable.from(imageBuffer)
      );

      this.logger.log(`📤 Uploaded image to OSS: ${result.url}`);
      return result.url;
    } catch (error) {
      this.logger.error(`❌ Failed to upload image to OSS: ${error}`);
      throw error;
    }
  }

  private async prepareViduReferenceImages(referenceImages?: ReferenceImageItem[]): Promise<string[]> {
    if (!Array.isArray(referenceImages) || referenceImages.length === 0) {
      return [];
    }

    const output: string[] = [];
    for (const image of referenceImages) {
      const raw = typeof image === "string" ? image : image.url;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const normalized = await this.uploadBase64ImageToOSS(trimmed);
      output.push(normalized);
    }
    return output;
  }

  private async splitAndUploadReferenceImages(
    referenceImages: ReferenceImageItem[] | undefined,
  ): Promise<{
    uploadedStringUrls: string[];
    objectItems: Array<Exclude<ReferenceImageItem, string>>;
  }> {
    const rawItems = Array.isArray(referenceImages) ? referenceImages : [];
    const stringItems = rawItems.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    const objectItems = rawItems.filter(
      (item): item is Exclude<ReferenceImageItem, string> => typeof item !== "string",
    );
    const uploadedStringUrls = (
      await Promise.all(stringItems.map((item) => this.uploadBase64ImageToOSS(item)))
    ).filter(Boolean) as string[];
    return { uploadedStringUrls, objectItems };
  }

  private summarizeImageHosts(images: string[]): string {
    const hosts = Array.from(
      new Set(
        images
          .map((image) => {
            try {
              return new URL(image).hostname;
            } catch {
              return "non-url";
            }
          })
          .filter(Boolean)
      )
    );
    return hosts.join(",") || "none";
  }

  private isUpstreamImageFetchFailure(responseText: string): boolean {
    const raw = (responseText || "").toLowerCase();
    return (
      raw.includes("http_request_failed") ||
      raw.includes("upstream") ||
      raw.includes("请求上游地址失败") ||
      raw.includes("failed to get the contents of the file") ||
      raw.includes("failed to get contents of the file") ||
      raw.includes("get the contents of the file") ||
      raw.includes("content of the file")
    );
  }

  private isModelNotSupportedError(responseText: string): boolean {
    const raw = (responseText || "").toLowerCase();
    return (
      raw.includes("model is not supported") ||
      raw.includes("model_not_supported") ||
      raw.includes("不支持")
    );
  }

  private async remoteImageUrlToDataUrl(url: string): Promise<string> {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      timeout: DEFAULT_FETCH_TIMEOUT,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch image url: HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") || "image/png";
    const buf = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${buf.toString("base64")}`;
  }

  private async convertKlingPayloadImagesToDataUrl(payload: any): Promise<any> {
    const next = JSON.parse(JSON.stringify(payload || {}));
    const toDataUrlIfRemote = async (
      value?: string
    ): Promise<string | undefined> => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      if (!trimmed) return trimmed;
      if (!/^https?:\/\//i.test(trimmed)) return trimmed;
      return this.remoteImageUrlToDataUrl(trimmed);
    };

    if (typeof next.image === "string") {
      next.image = await toDataUrlIfRemote(next.image);
    }
    if (typeof next.image_tail === "string") {
      next.image_tail = await toDataUrlIfRemote(next.image_tail);
    }
    if (Array.isArray(next.image_list)) {
      for (let i = 0; i < next.image_list.length; i += 1) {
        const item = next.image_list[i];
        if (item && typeof item.image === "string") {
          item.image = await toDataUrlIfRemote(item.image);
        }
      }
    }
    return next;
  }

  private logProviderPayload(provider: string, payload: any) {
    try {
      const safe = JSON.parse(
        JSON.stringify(payload, (_k, v) => {
          if (typeof v === "string" && v.length > 200) {
            return `${v.slice(0, 200)}...[truncated ${v.length} chars]`;
          }
          if (Array.isArray(v) && v.length > 10) {
            return `[array length ${v.length}]`;
          }
          return v;
        })
      );
      this.logger.debug(
        `🔁 ${provider} request payload: ${JSON.stringify(safe)}`
      );
    } catch {
      this.logger.debug(`🔁 ${provider} request payload (failed to stringify)`);
    }
  }

  // API Keys 优先从环境变量获取，否则使用默认值（仅供参考）
  private readonly apiKeys = {
    kling: process.env.KLING_API_KEY || "sk-kling-xxx",
    "kling-2.6": process.env.KLING_API_KEY || "sk-kling-xxx",
    "kling-o3": process.env.KLING_API_KEY || "sk-kling-xxx",
    vidu: process.env.VIDU_API_KEY || "sk-vidu-xxx",
    "viduq3-pro": process.env.VIDU_API_KEY || "sk-vidu-xxx",
    doubao:
      process.env.DOUBAO_API_KEY || "0ac5fae84-f299-4db4-8d7e-3f7fc355c6ac",
  };

  /**
   * 创建生成任务
   */
  async generateVideo(
    options: VideoProviderRequestDto
  ): Promise<VideoGenerationResult> {
    // 尊享路由：托管分组配置把该模型主路由解析为 tencent_vod 时，走腾讯 VOD 转换链路
    //（generateManaged* → generateXxxViaTencent → TencentVodAigcService → new-api /proxy/tencent/vod）。
    // 其余模型走 new-api。是否走腾讯由托管分组配置决定，这里不硬编码模型清单。
    if (await this.shouldRouteVideoToManagedTencent(options)) {
      return this.generateVideoLegacy(options);
    }
    return this.createNewApiVideoTask(options);
  }

  // Video models that have proper new-api channels (apimart / ark / tencent-vod).
  // These ALWAYS go through new-api /v1/videos so new-api's distributor decides
  // the upstream (apimart vs ark vs the tencent-vod channel) — the backend no
  // longer makes the vod-vs-apimart choice, and every request is logged/billed
  // in new-api. The legacy /proxy/tencent/vod passthrough is reached only via
  // the new-api tencent-vod channel proxying back to /internal/tencent-vod.
  private static readonly NEW_API_VIDEO_MODEL_KEYS = new Set<string>([
    "vidu-q2",
    "vidu-q3",
    "kling-2.6",
    "kling-3.0",
    "kling-o3",
    "seedance-1.5",
    "seedance-2.0",
  ]);

  /** 依据托管分组配置判断该视频请求是否应走腾讯 VOD（尊享）路由。 */
  private async shouldRouteVideoToManagedTencent(
    options: VideoProviderRequestDto
  ): Promise<boolean> {
    const modelKey = this.resolveManagedVideoModelKey(options);
    if (!modelKey) return false;
    // Tencent route removed for managed video models: every model with a new-api
    // channel ALWAYS goes through /v1/videos so new-api's own distributor picks
    // the upstream per route (apimart / ark / its tencent-vod channel). The
    // frontend no longer pins vidu/kling to tencent_vod; this guard also blocks
    // any stale node data still carrying tencent_vod from forcing the legacy
    // direct Tencent VOD path here. (Tencent VOD stays reachable only via
    // new-api's tencent-vod channel calling back into /internal/tencent-vod →
    // createViaTencentVod, which bypasses this decision entirely.)
    if (VideoProviderService.NEW_API_VIDEO_MODEL_KEYS.has(modelKey)) {
      return false;
    }
    try {
      const candidates = await this.modelRoutingService.resolveVideoModelCandidates(
        modelKey,
        options.vendorKey
      );
      return candidates[0]?.route === "tencent_vod";
    } catch (error) {
      this.logger.warn(
        `resolveVideoModelCandidates failed for ${modelKey}: ${this.summarizeError(error)}`
      );
      return false;
    }
  }

  /** 把请求映射到托管模型 key；无对应托管模型时返回 null（走 new-api）。 */
  private resolveManagedVideoModelKey(
    options: VideoProviderRequestDto
  ): string | null {
    const provider = options.provider;
    if (
      (provider === "kling" || provider === "kling-2.6") &&
      options.klingModel === "kling-v3-0"
    ) {
      return "kling-3.0";
    }
    if (
      (provider === "kling" || provider === "kling-2.6") &&
      options.klingModel === "kling-v2-6"
    ) {
      return "kling-2.6";
    }
    if (provider === "kling-o3") return "kling-o3";
    if (provider === "vidu" || provider === "viduq3-pro") {
      try {
        return this.resolveManagedViduModel(options).modelKey;
      } catch {
        return null;
      }
    }
    if (provider === "doubao") {
      try {
        return this.resolveManagedSeedanceModel(options).modelKey;
      } catch {
        return null;
      }
    }
    return null;
  }

  private async generateVideoLegacy(
    options: VideoProviderRequestDto
  ): Promise<VideoGenerationResult> {
    const { provider } = options;

    // 注意：kling-o3 节点前端默认带 klingModel="kling-v3-0"，但 O3(Omni) 与 Kling 3.0
    // 是不同模型。绝不能因 klingModel==="kling-v3-0" 把 O3 路由到 generateManagedKling30
    // (会发成 Kling 3.0，导致“选O3后台显示3.0”串台)。O3 一律走 generateManagedKlingO3。
    if (
      (provider === "kling" || provider === "kling-2.6") &&
      options.klingModel === "kling-v3-0"
    ) {
      return this.generateManagedKling30(options);
    }

    if (
      (provider === "kling" || provider === "kling-2.6") &&
      options.klingModel === "kling-v2-6"
    ) {
      return this.generateManagedKling26(options);
    }

    if (provider === "kling-o3") {
      return this.generateManagedKlingO3(options);
    }

    if (provider === "vidu" || provider === "viduq3-pro") {
      return this.generateManagedVidu(options);
    }

    if (provider === "doubao") {
      return this.generateManagedSeedance(options);
    }

    // wan2.7 never reaches the legacy/managed path (it always routes to new-api),
    // so it has no legacy apiKeys entry — guard the index access.
    const apiKey = this.apiKeys[provider as keyof typeof this.apiKeys];

    if (!apiKey || apiKey.includes("xxx")) {
      throw new ServiceUnavailableException(`${provider} API Key 未配置`);
    }

    this.logger.log(
      `🎬 视频生成任务创建: provider=${provider}, prompt=${options.prompt?.substring(
        0,
        50
      ) || "N/A"}...`
    );

    switch (provider) {
      case "kling":
        return this.generateKling(options, apiKey);
      case "kling-2.6":
        return this.generateKling26(options, apiKey);
      default:
        throw new Error(`不支持的供应商: ${provider}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Tencent VOD via new-api: the new-api `tencent-vod` channel proxies create/
  // poll here so Tencent VOD becomes a first-class new-api channel (logged +
  // billed, distributor-selectable alongside apimart) without re-porting the
  // TC3 signing + per-model request building to Go.
  // Scope: Vidu + Kling only (Seedance uses asset:// refs Tencent can't take).
  // ──────────────────────────────────────────────────────────────────────

  /** Build a VideoProviderRequestDto for the Tencent path from the unified
   * /v1/videos payload forwarded by the new-api tencent-vod adaptor. */
  private buildDtoFromUnifiedForTencent(input: {
    model?: string;
    prompt?: string;
    images?: string[];
    duration?: number;
    size?: string;
    resolution?: string;
    aspect_ratio?: string;
    mode?: string;
  }): VideoProviderRequestDto {
    const model = String(input.model || "").trim().toLowerCase();
    const referenceImages = Array.isArray(input.images)
      ? input.images.filter((u) => typeof u === "string" && u.trim().length > 0)
      : undefined;
    const base = {
      prompt: input.prompt,
      referenceImages,
      duration:
        typeof input.duration === "number" && Number.isFinite(input.duration)
          ? input.duration
          : undefined,
      aspectRatio: (input.aspect_ratio || "").trim() || undefined,
      resolution: (input.resolution || "").trim() || undefined,
      mode: (input.mode === "pro" ? "pro" : input.mode === "std" ? "std" : undefined) as
        | "std"
        | "pro"
        | undefined,
      // The new-api distributor already chose the tencent-vod channel, so force
      // the tencent_vod vendor — generateManaged* re-resolves the route via
      // executeManagedRouteWithFallback and would otherwise honor the config
      // default (which may not be tencent).
      vendorKey: "tencent_vod",
    };
    switch (model) {
      case "vidu-q2":
        return { ...base, provider: "vidu", viduModel: "q2" } as VideoProviderRequestDto;
      case "vidu-q3":
        return { ...base, provider: "viduq3-pro", viduModel: "q3" } as VideoProviderRequestDto;
      case "kling-v2-6":
        return { ...base, provider: "kling", klingModel: "kling-v2-6" } as VideoProviderRequestDto;
      case "kling-v3":
        return { ...base, provider: "kling", klingModel: "kling-v3-0" } as VideoProviderRequestDto;
      case "kling-v3-omni":
        return { ...base, provider: "kling-o3", klingModel: "kling-o3" } as VideoProviderRequestDto;
      default:
        throw new BadRequestException(`tencent-vod 暂不支持模型: ${input.model}`);
    }
  }

  /** Create a Tencent VOD video task (called by the new-api tencent-vod adaptor). */
  async createViaTencentVod(input: {
    model?: string;
    prompt?: string;
    images?: string[];
    duration?: number;
    size?: string;
    resolution?: string;
    aspect_ratio?: string;
    mode?: string;
  }): Promise<{ taskId: string; status: string }> {
    const dto = this.buildDtoFromUnifiedForTencent(input);
    const result = await this.generateVideoLegacy(dto);
    return { taskId: result.taskId, status: result.status };
  }

  /** Poll a Tencent VOD video task (called by the new-api tencent-vod adaptor).
   * Routes via queryTask so BOTH prefixed managed ids (Vidu / Kling 2.6 / 3.0 /
   * Seedance) AND the UNPREFIXED kling-o3 (Omni) id are handled — the latter
   * needs the provider === "kling-o3" branch in queryTask. The provider arg is
   * only consulted for unprefixed ids, so passing "kling-o3" is safe for all. */
  async queryViaTencentVod(
    taskId: string,
  ): Promise<{ status: string; url?: string; reason?: string }> {
    const r = await this.queryTask("kling-o3", taskId);
    return { status: r.status, url: r.videoUrl, reason: r.error };
  }

  /**
   * 查询任务状态
   */
  async queryTask(
    provider: "kling" | "kling-2.6" | "kling-o3" | "vidu" | "viduq3-pro" | "doubao" | "wan2.7",
    taskId: string
  ): Promise<{ status: string; videoUrl?: string; thumbnailUrl?: string; error?: string; inputTokens?: number; outputTokens?: number }> {
    if (taskId.startsWith(this.newApiTaskPrefix)) {
      return this.queryNewApiVideoTask(taskId);
    }

    if (taskId.startsWith(this.managedV2TaskPrefix)) {
      return this.queryManagedV2Task(taskId);
    }

    const managedTencentTask = this.parseManagedTencentTaskId(taskId);
    if (managedTencentTask) {
      return this.queryManagedTencentVideoTask(taskId);
    }

    if (
      (provider === "kling" || provider === "kling-2.6") &&
      taskId.startsWith(MANAGED_KLING26_TENCENT_TASK_PREFIX)
    ) {
      return this.queryManagedTencentVideoTask(taskId);
    }

    if (provider === "kling-o3") {
      return this.queryManagedKlingO3(taskId);
    }

    if (
      (provider === "kling" || provider === "kling-2.6") &&
      taskId.startsWith(MANAGED_KLING30_TENCENT_TASK_PREFIX)
    ) {
      return this.queryManagedTencentVideoTask(taskId);
    }

    if (
      (provider === "vidu" || provider === "viduq3-pro") &&
      taskId.startsWith(MANAGED_VIDU_TENCENT_PREFIX)
    ) {
      return this.queryManagedTencentVideoTask(taskId);
    }

    if (
      provider === "doubao" &&
      (taskId.startsWith("tencentvod-seedance15-") ||
        taskId.startsWith("tencentvod-seedance20-"))
    ) {
      return this.queryManagedTencentVideoTask(taskId);
    }

    // Legacy task IDs (created before new-api migration) can no longer be queried.
    // All new tasks carry the "newapi:" prefix and are handled above.
    throw new ServiceUnavailableException(
      `Task "${taskId}" was created before the new-api migration and can no longer be queried. Please create a new video task.`,
    );
  }

  private async createNewApiVideoTask(
    options: VideoProviderRequestDto,
  ): Promise<VideoGenerationResult> {
    if (!this.newApiKey) {
      throw new ServiceUnavailableException("NEW_API_KEY 未配置");
    }

    const model = this.resolveNewApiVideoModel(options);
    // omni-flash-ext and Vidu (apimart viduq3/viduq2) use aspect_ratio + resolution
    // natively; a WxH size string only encodes 16:9/9:16 and would contradict the
    // 4:3 / 3:4 / 1:1 aspect ratios these models support. See APIMart vidu-q3 docs.
    const usesNativeAspectRatio = model === "omni-flash-ext" || model.startsWith("vidu-");
    const size = usesNativeAspectRatio ? undefined : this.resolveNewApiVideoSize(options);
    const duration = this.resolveNewApiDuration(options);
    const isSeedance2 = /doubao-seedance-2/i.test(model);
    // Seedance 2.0 uses asset:// references so doubao doesn't re-run content moderation
    // on assets that already passed the upload-time check (volcAssetStatus === "active").
    // Other models fall back to raw HTTPS URLs.
    const referenceImages = (isSeedance2
      ? this.extractReferenceImageUrlsWithVolcAssets(options.referenceImages)
      : this.extractReferenceImageUrls(options.referenceImages)
    ).map((url) => this.normalizeFirstPartyAssetUrl(url));
    // Raw URLs for new-api's own asset re-upload path (only needed when not using asset://).
    const referenceImageRawUrls: string[] | undefined = isSeedance2
      ? this.extractReferenceImageUrls(options.referenceImages).map((url) =>
          this.normalizeFirstPartyAssetUrl(url),
        )
      : undefined;
    const referenceVideos = [
      ...(Array.isArray(options.referenceVideos) ? options.referenceVideos : []),
      ...(options.referenceVideo ? [options.referenceVideo] : []),
    ]
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((url) => this.normalizeFirstPartyAssetUrl(url));

    // wan2.7-videoedit requires the source video via metadata.video_url (the
    // new-api apimart adaptor reads it from metadata, not the top-level
    // reference_videos field which TaskSubmitReq does not parse).
    const isWanVideoEdit = model === "wan2.7-videoedit";

    // Kling 首尾帧/参考视频/声音 must ride in `metadata`: new-api's TaskSubmitReq
    // drops unknown top-level fields (sound/reference_videos/…), while the apimart
    // adaptor forwards every non-internal metadata key to the upstream body as-is
    // (Extras passthrough). So `audio`/`video_list`/`image_with_roles` reach Kling
    // upstream only via metadata. See APIMart kling-v2-6 / kling-v3 / kling-v3-omni docs.
    // Kling omni 命名角色(element_list)经独立的 elementImages 字段下发，与 image 桩的
    // 首尾帧/参考图(image_with_roles)分离，避免被当成普通参考图。
    const elementImages = this.extractReferenceImageUrls(options.elementImages).map(
      (url) => this.normalizeFirstPartyAssetUrl(url),
    );
    const kling = this.buildKlingApimartParams(
      options,
      model,
      referenceImages,
      referenceVideos,
      elementImages,
      duration,
    );

    // Seedance 2.0 参考图模式(r2v)：所有图都是“主体参考”，必须经 new-api 的
    // referenceImages 字段下发（doubao adaptor 全部标 role=reference_image）。
    // 若塞进 image/images，adaptor 会把 images[0] 当 first_frame、其余当
    // reference_image，两类 role 混用，Ark 直接 400：
    //   "first/last frame content cannot be mixed with reference media content"。
    // first_frame(i2v) 模式仍走 image/images（adaptor 正确标 first_frame）。
    const seedanceVideoMode = String(options.videoMode || "").trim().toLowerCase();
    // 首/尾帧类模式：首帧走 image（adaptor 标 first_frame），尾帧走独立 lastFrame 字段
    // （adaptor 标 last_frame）。注意 smart_frames(智能多帧) 不在此列——它是“多参考图 +
    // prompt @图N”玩法，所有图都是 reference_image，详见下方 reference 分支。
    const SEEDANCE_FRAME_MODES = new Set([
      "first_frame",
      "last_frame",
      "start_end",
      "start-end",
      "frame",
    ]);
    const isSeedance2FrameMode =
      isSeedance2 && SEEDANCE_FRAME_MODES.has(seedanceVideoMode);
    // 参考图模式(r2v)：全能参考(reference_images)与智能多帧(smart_frames，2-10 图、靠
    // prompt @图N 区分用途)都属此类，所有图标 reference_image，经 referenceImages 字段下发。
    // 兜底：videoMode 缺失/异常时，只要有 ≥2 张参考图又不是首尾帧模式，也全部当“主体参考”，
    // 避免把首图标 first_frame 与其余 reference_image 混用触发 Ark 400。
    // 单图(length<2)仍按首图(i2v)走 image/images，保持原首帧行为。
    const SEEDANCE_REFERENCE_MODES = new Set(["reference_images", "smart_frames"]);
    const isSeedance2ReferenceMode =
      isSeedance2 &&
      !isSeedance2FrameMode &&
      (SEEDANCE_REFERENCE_MODES.has(seedanceVideoMode) || referenceImages.length >= 2);
    // 首尾帧(start_end)：≥2 图时首图=首帧、次图=尾帧；单图退化为纯首帧(i2v)。
    // 注意：seedance 1.5 与 2.0 都经同一个 doubao Ark 适配器下发，Ark 同样禁止首/尾帧与
    // reference_image 混用，所以首尾帧处理必须覆盖两个版本——不能只 gate 在 isSeedance2。
    // 模式取值差异：seedance 2.0 = "start_end"/"start-end"；seedance 1.5 = "start-end2video"
    // （见前端 FlowOverlay seedanceVideoModeForAPI）。否则 1.5 首尾帧会落到默认分支，把次图
    // 当 reference_image 与首帧的 first_frame 混用，触发 Ark 400。
    const isDoubaoSeedance = /doubao-seedance/i.test(model);
    const SEEDANCE_STARTEND_MODES = new Set([
      "start_end",
      "start-end",
      "start-end2video",
    ]);
    const isSeedanceStartEndMode =
      isDoubaoSeedance && SEEDANCE_STARTEND_MODES.has(seedanceVideoMode);
    const buildSeedanceImageFields = (
      urls: string[],
    ): {
      image?: string;
      images?: string[];
      referenceImages?: string[];
      lastFrame?: string;
    } => {
      if (isSeedance2ReferenceMode) {
        return {
          image: undefined,
          images: undefined,
          referenceImages: urls.length > 0 ? urls : undefined,
          lastFrame: undefined,
        };
      }
      if (isSeedanceStartEndMode && urls.length >= 2) {
        // 尾帧只走 lastFrame、绝不放进 images：否则 new-api 归一化会把它并入
        // reference_image 集合，与 first_frame 混用触发 Ark 400。
        return {
          image: urls[0],
          images: undefined,
          referenceImages: undefined,
          lastFrame: urls[1],
        };
      }
      return {
        image: urls[0],
        images: urls.length > 0 ? urls : undefined,
        referenceImages: undefined,
        lastFrame: undefined,
      };
    };
    const seedanceImageFields = buildSeedanceImageFields(referenceImages);

    const metadata = {
      ...(isWanVideoEdit && referenceVideos[0] ? { video_url: referenceVideos[0] } : {}),
      ...(kling?.metadata ?? {}),
    };
    const hasMetadata = Object.keys(metadata).length > 0;

    const payload = this.stripUndefined({
      model,
      prompt: options.prompt || "",
      duration,
      size,
      resolution: this.normalizeResolutionToken(options.resolution),
      // For Kling, image/images selection is decided by buildKlingApimartParams
      // (omni 首尾帧 uses image_with_roles and suppresses image_urls to satisfy the
      // upstream mutual-exclusion rule).
      image: kling ? kling.image : seedanceImageFields.image,
      images: kling ? kling.images : seedanceImageFields.images,
      // Seedance 2.0 r2v：参考图经此字段下发，new-api 全部标 reference_image。
      referenceImages: kling ? undefined : seedanceImageFields.referenceImages,
      // Seedance 2.0 首尾帧：尾帧经此字段下发，new-api 标 last_frame（与 first_frame 成对）。
      lastFrame: kling ? undefined : seedanceImageFields.lastFrame,
      // Kling reference video now rides in metadata.video_list (see above); the
      // top-level reference_videos field is dropped by new-api for Kling anyway.
      reference_videos: kling
        ? undefined
        : referenceVideos.length > 0
        ? referenceVideos
        : undefined,
      metadata: hasMetadata ? metadata : undefined,
      audio_urls: options.audioUrls?.length ? options.audioUrls : undefined,
      mode: options.mode,
      // Kling audio is carried as metadata.audio (boolean) by buildKlingApimartParams.
      sound: kling ? undefined : options.sound,
      aspect_ratio: options.aspectRatio,
      watermark: options.watermark,
      generate_audio: options.generateAudio,
      provider_options: {
        sourceProvider: options.provider,
        videoMode: options.videoMode,
        klingModel: options.klingModel,
        viduModel: options.viduModel,
        viduModelVariant: options.viduModelVariant,
        seedanceModel: options.seedanceModel,
        managedModelKey: options.managedModelKey,
        // Fallback raw URLs for new-api to perform its own asset upload if AK/SK is configured.
        referenceImageRawUrls,
      },
    });

    this.logger.log(
      `new-api 视频任务创建: model=${model}, provider=${options.provider}, duration=${duration}, size=${size}`,
    );

    let result: any;
    const hasAssetRefs = isSeedance2 && referenceImages.some((u) => u.startsWith("asset://"));
    try {
      result = await this.requestNewApiJson("/v1/videos", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      // 安全网：凡 seedance2 命中“首帧与参考媒体混用”400（无论上面模式判定是否漏判），
      // 一律改走 Ark content/role 直连兜底——该路径把所有图都标 reference_image，不会混用。
      if (isSeedance2 && this.isSeedanceReferenceMediaConflictError(err)) {
        this.logger.warn(
          "Seedance 2.0 经 new-api 被识别为首帧+参考图混用，改走 Ark content/role 直连兜底",
        );
        return this.generateManagedSeedance(options);
      }
      if (hasAssetRefs && this.isAssetServiceNotActivatedError(err)) {
        // new-api 上游账号未开通 Asset Service，降级使用 HTTPS 直链重试
        const rawUrls = referenceImageRawUrls ?? this.extractReferenceImageUrls(options.referenceImages);
        this.logger.warn(
          `new-api 上游账号未开通 Asset Service，降级 HTTPS 直链重试 ${rawUrls.length} 张图片: ${err?.message?.slice(0, 120)}`,
        );
        const fallbackPayload = {
          ...payload,
          ...buildSeedanceImageFields(rawUrls),
          provider_options: { ...payload.provider_options, referenceImageRawUrls: undefined },
        };
        result = await this.requestNewApiJson("/v1/videos", {
          method: "POST",
          body: JSON.stringify(fallbackPayload),
        });
      } else if (hasAssetRefs && this.isStaleAssetError(err)) {
        // asset:// 引用已失效（旧资产组被删），重新上传图片取得新 asset ID 再重试
        const rawUrls = referenceImageRawUrls ?? this.extractReferenceImageUrls(options.referenceImages);
        this.logger.warn(
          `asset:// 引用失效，重新上传 ${rawUrls.length} 张图片获取新 asset ID: ${err?.message?.slice(0, 120)}`,
        );
        const refreshedImages = await this.reuploadImagesAsAssets(rawUrls);
        const fallbackPayload = {
          ...payload,
          ...buildSeedanceImageFields(refreshedImages),
          provider_options: { ...payload.provider_options, referenceImageRawUrls: undefined },
        };
        result = await this.requestNewApiJson("/v1/videos", {
          method: "POST",
          body: JSON.stringify(fallbackPayload),
        });
      } else {
        throw err;
      }
    }
    const rawTaskId = this.extractTaskId(result);
    if (!rawTaskId) {
      throw new ServiceUnavailableException(`new-api 未返回视频任务 ID: ${JSON.stringify(result)}`);
    }

    const taskId = `${this.newApiTaskPrefix}${rawTaskId}`;
    const videoUrl = this.extractVideoUrl(result);
    const thumbnailUrl = this.extractThumbnailUrl(result);
    return {
      taskId,
      status: videoUrl ? "succeeded" : "queued",
      videoUrl,
      thumbnailUrl,
      execution: {
        modelKey: options.managedModelKey || model,
        vendorKey: "new-api",
        platformKey: "new-api",
        route: "new-api",
        providerChannel: "new-api",
        routedProvider: options.provider,
        fallbackUsed: false,
      },
    };
  }

  private async queryNewApiVideoTask(
    taskId: string,
  ): Promise<{ status: string; videoUrl?: string; thumbnailUrl?: string; error?: string }> {
    if (!this.newApiKey) {
      throw new ServiceUnavailableException("NEW_API_KEY 未配置");
    }

    const rawTaskId = taskId.slice(this.newApiTaskPrefix.length);
    const result = await this.requestNewApiJson(
      `/v1/videos/${encodeURIComponent(rawTaskId)}?t=${Date.now()}`,
      { method: "GET" },
    );
    const status = this.normalizeNewApiStatus(result);
    const upstreamVideoUrl = this.extractVideoUrl(result);
    const thumbnailUrl = this.extractThumbnailUrl(result);

    if (status === "succeeded" && !upstreamVideoUrl) {
      this.logger.warn(
        `new-api task ${rawTaskId} succeeded but no video URL found. raw keys: ${Object.keys(result || {}).join(",")}; data keys: ${Object.keys(result?.data || {}).join(",")}`,
      );
    }

    if (status === "failed") {
      const error =
        result?.data?.error?.message ||
        result?.data?.error?.code ||
        result?.error?.message ||
        result?.error?.code ||
        result?.fail_reason ||
        result?.data?.fail_reason ||
        result?.message ||
        result?.data?.message ||
        undefined;
      return { status, thumbnailUrl, error };
    }

    if (!upstreamVideoUrl || status !== "succeeded") {
      return { status, thumbnailUrl };
    }

    const videoUrl = this.isOssPublicUrl(upstreamVideoUrl)
      ? upstreamVideoUrl
      : await this.uploadRemoteVideoToOss(upstreamVideoUrl, `new-api-${rawTaskId}`);
    return { status, videoUrl, thumbnailUrl };
  }

  private resolveNewApiVideoModel(options: VideoProviderRequestDto): string {
    const explicit = String(
      options.managedModelKey || options.seedanceModel || options.klingModel || options.viduModel || "",
    )
      .trim()
      .toLowerCase();
    // ALL Seedance models route through the ark-doubao channel (direct official
    // VolcEngine) using snapshot ids — NOT the apimart reseller.
    // Fast/lite/mini share the doubao-seedance-2-0-fast upstream.
    //
    // The authoritative sub-selector is seedanceModel (the node updates it
    // directly). managedModelKey can lag behind it — e.g. a "seedance-2.0" node
    // whose sub-selector was switched to 1.5-pro still carries
    // managedModelKey="seedance-2.0" — so for Seedance we must trust
    // seedanceModel first, mirroring the kling branch below. Using the
    // managedModelKey-first `explicit` here silently ran 1.5-pro as 2.0.
    // Order matters: fast/lite/mini and 1.5 before the generic 2.0 branch.
    if (options.provider === "doubao" || explicit.includes("seedance") || explicit.includes("seed-")) {
      const seedanceHint = String(options.seedanceModel || options.managedModelKey || explicit)
        .trim()
        .toLowerCase();
      if (
        seedanceHint.includes("2.0-fast") || seedanceHint.includes("2-0-fast") ||
        seedanceHint.includes("seed-2.0-lite") || seedanceHint.includes("seed-2.0-mini")
      ) {
        return "doubao-seedance-2-0-fast-260128";
      }
      if (seedanceHint.includes("1.5") || seedanceHint.includes("1-5")) {
        return "doubao-seedance-1-5-pro-251215";
      }
      return "doubao-seedance-2-0-260128";
    }
    if (explicit.includes("wan2.7") || explicit.includes("wan-2.7")) {
      return "wan2.7-videoedit";
    }
    if (explicit === "omni-flash-ext") {
      return "omni-flash-ext";
    }
    if (options.provider === "kling-o3" || explicit.includes("omni") || explicit.includes("o3")) {
      return "kling-v3-omni";
    }
    if (options.provider === "kling" || options.provider === "kling-2.6") {
      // The authoritative version is klingModel (kling-v2-6 / kling-v3-0). The
      // node's managedModelKey can lag behind its sub-selector (e.g. a "kling-3.0"
      // node with klingModel switched to kling-v2-6), so don't trust the
      // managedModelKey-first `explicit` here — mirror the vidu branch below.
      const klingHint = String(options.klingModel || explicit).trim().toLowerCase();
      return klingHint.includes("2-6") || klingHint.includes("2.6") ? "kling-v2-6" : "kling-v3";
    }
    if (options.provider === "vidu" || options.provider === "viduq3-pro") {
      const viduVariant = String(
        options.viduModelVariant || options.viduModel || explicit,
      )
        .trim()
        .toLowerCase();
      // Q2 family keeps the Vidu Q2 upstream (vidu-q2 → viduq2); everything
      // else (q3 / q3-pro / q3-turbo / q3-mix) resolves to Vidu Q3.
      return viduVariant.startsWith("q2") ? "vidu-q2" : "vidu-q3";
    }
    return explicit || "kling-v3";
  }

  /**
   * Build the Kling-specific portion of the apimart `/v1/videos` request.
   *
   * APIMart's Kling field contract (confirmed against docs.apimart.ai):
   *  - 首尾帧 (v2-6 / v3): `image_urls[0]` = 首帧, `image_urls[1]` = 尾帧 (≤2). There is
   *    NO `image_tail` field — the ordered images[] flatten already produces this.
   *  - 首尾帧 (omni / kling-v3-omni): explicit `image_with_roles=[{url,role}]` with role
   *    ∈ first_frame|last_frame|reference. Mutually exclusive with `image_urls`, so we
   *    suppress top-level image/images in that case.
   *  - 参考视频 (omni): `video_list=[{video_url, refer_type:base|feature, keep_original_sound:yes|no}]`.
   *  - 声音: boolean `audio` (NOT `sound`). v2-6 requires pro mode + single image; omni is
   *    mutually exclusive with video_list. There is NO voice/timbre/audio-upload field.
   *
   * Returns null for non-Kling models (leaves the generic payload path untouched).
   */
  private buildKlingApimartParams(
    options: VideoProviderRequestDto,
    model: string,
    referenceImages: string[],
    referenceVideos: string[],
    elementImages: string[] = [],
    duration?: number,
  ): { image?: string; images?: string[]; metadata: Record<string, any> } | null {
    const isV26 = model === "kling-v2-6";
    const isV3 = model === "kling-v3";
    const isOmni = model === "kling-v3-omni";
    if (!isV26 && !isV3 && !isOmni) return null;

    const mode = String(options.mode || "std").trim().toLowerCase();
    const wantSound = String(options.sound || "").trim().toLowerCase() === "on";
    const hasVideo = referenceVideos.length > 0;
    const videoMode = String(options.videoMode || "").trim().toLowerCase();
    const frameMode =
      videoMode === "frame" || videoMode === "start_end" || videoMode === "start-end";
    // 参考图模式：多张主体参考图（≥3 或显式 reference），用 image_with_roles role=reference 表达。
    const referenceMode =
      videoMode === "reference" ||
      videoMode === "reference_images" ||
      (!frameMode && !hasVideo && referenceImages.length >= 3);
    const twoImages = referenceImages.length >= 2;

    const metadata: Record<string, any> = {};
    let image: string | undefined = referenceImages[0];
    let images: string[] | undefined =
      referenceImages.length > 0 ? referenceImages : undefined;

    // ── 负向提示词 → negative_prompt（omni 文档支持；apimart 经 metadata 透传到上游顶层）。 ──
    if (isOmni) {
      const negativePrompt = String(options.negativePrompt || "").trim();
      if (negativePrompt) metadata.negative_prompt = negativePrompt;
    }

    // ── 声音 → boolean `audio`, honoring APIMart's mutual-exclusion rules (fail-closed). ──
    let audio = wantSound;
    if (isV26 && audio && (mode !== "pro" || twoImages)) {
      this.logger.warn(
        "Kling v2-6 audio 需 pro 模式且仅单图(与尾帧互斥)，本次强制关闭 audio",
      );
      audio = false;
    }
    if (isOmni && audio && hasVideo) {
      this.logger.warn(
        "Kling omni audio 与参考视频(video_list)互斥，本次强制关闭 audio",
      );
      audio = false;
    }
    metadata.audio = audio;

    // ── omni 首尾帧 → image_with_roles (suppress image_urls to avoid mutual-exclusion). ──
    if (isOmni && frameMode && twoImages) {
      metadata.image_with_roles = [
        { url: referenceImages[0], role: "first_frame" },
        { url: referenceImages[1], role: "last_frame" },
      ];
      image = undefined;
      images = undefined;
    }

    // ── omni 多主体参考 → image_with_roles role=reference（与 image_urls 互斥，清顶层 image/images）。 ──
    if (isOmni && referenceMode && referenceImages.length > 0 && !hasVideo) {
      metadata.image_with_roles = referenceImages.map((url) => ({
        url,
        role: "reference",
      }));
      image = undefined;
      images = undefined;
    }

    // ── omni 命名角色 → element_list=[{name,description,element_input_urls}]（@name 引用）。 ──
    // 上游硬约束（apimart kling-v3-omni 文档 + 实测）：description 必填（空串直接
    // kling_element_create_failed）；element_input_urls 每主体 2-4 张，第 1 张为正面照、
    // 其余为参考图（单图会报 "at least 1 reference image required"，同 URL 复制可过）。
    if (isOmni && elementImages.length > 0) {
      const elementName = String(options.elementName || "").trim() || "role1";
      const elementDescription =
        String(options.elementDescription || "").trim() ||
        `提示词中@${elementName}引用的主体角色，以参考图为准`;
      let elementUrls = elementImages.slice(0, 4);
      if (elementImages.length > 4) {
        this.logger.warn(
          `Kling omni element_input_urls 上限 4 张，已截断（原 ${elementImages.length} 张）`,
        );
      }
      if (elementUrls.length === 1) {
        elementUrls = [elementUrls[0], elementUrls[0]];
      }
      metadata.element_list = [
        {
          name: elementName,
          description: elementDescription,
          element_input_urls: elementUrls,
        },
      ];
      // 主体需经 prompt 的 @name 引用才会绑定进画面，否则上游会无视 element_list。
      // prompt 缺少对本主体的引用时自动前置（经 metadata.prompt 覆盖顶层 prompt——
      // apimart Extras 合并时同名字段以 metadata 为准）。判断用具体的 @name 而非任意
      // @，避免 prompt 里的 @图N 等其它 @ 引用误判为已绑定主体。
      const promptText = String(options.prompt || "").trim();
      if (promptText && !promptText.includes(`@${elementName}`)) {
        metadata.prompt = `@${elementName} ${promptText}`;
        this.logger.warn(
          `Kling omni prompt 未引用主体 @${elementName}，已自动前置`,
        );
      }
    }

    // ── omni 参考视频 → video_list (refer_type / keep_original_sound from user choice). ──
    if (isOmni && hasVideo) {
      const referType =
        String(options.referenceVideoType || "").trim().toLowerCase() === "feature"
          ? "feature"
          : "base";
      const keepOriginalSound =
        String(options.keepOriginalSound || "").trim().toLowerCase() === "yes"
          ? "yes"
          : "no";
      metadata.video_list = [
        {
          video_url: referenceVideos[0],
          refer_type: referType,
          keep_original_sound: keepOriginalSound,
        },
      ];
      // APIMart omni 规则：refer_type=feature 时 image_urls 仅允许首帧；base 不定义
      // 首尾帧。统一只保留首帧做参考，避免与 video_list 冲突。
      delete metadata.image_with_roles;
      image = referenceImages[0];
      images = referenceImages[0] ? [referenceImages[0]] : undefined;
    }

    // ── omni duration 上游范围 3-15s；超界经 metadata.duration 收敛（覆盖顶层 duration）。 ──
    let effectiveDuration = duration;
    if (isOmni && typeof duration === "number" && Number.isFinite(duration)) {
      const clamped = Math.max(3, Math.min(15, Math.round(duration)));
      if (clamped !== duration) {
        metadata.duration = clamped;
        effectiveDuration = clamped;
        this.logger.warn(
          `Kling omni duration ${duration}s 超出上游 3-15s 范围，已收敛为 ${clamped}s`,
        );
      }
    }

    // ── omni 多分镜 → multi_shot / shot_type / multi_prompt（复用历史 storyboard 校验）。 ──
    // multi_shot 与参考视频(video_list)互斥，上游报 "multi shot is not supported with
    // video input"。连了参考视频时跳过分镜，保证视频输入可用。
    if (isOmni && !hasVideo) {
      this.applyKlingOmniStoryboard(options, metadata, effectiveDuration);
    }

    return { image, images, metadata };
  }

  /**
   * 把历史 storyboard 模式（single / intelligence / customize）翻译成 APIMart kling-v3-omni
   * 的 multi_shot / shot_type / multi_prompt 字段，写进 metadata（经 apimart Extras 透传到上游）。
   * 复用 Tencent 渠道的 multi_prompt 解析/校验逻辑（parseTencentKlingCustomStoryboardShots）。
   */
  private applyKlingOmniStoryboard(
    options: VideoProviderRequestDto,
    metadata: Record<string, any>,
    duration?: number,
  ): void {
    const rawMode = String(options.klingStoryboardMode || "").trim().toLowerCase();
    if (!rawMode || rawMode === "single") {
      return;
    }

    if (rawMode === "intelligence" || rawMode === "smart") {
      if (!String(options.prompt || "").trim()) {
        throw new BadRequestException("可灵 Omni 智能分镜模式需要填写提示词");
      }
      metadata.multi_shot = true;
      metadata.shot_type = "intelligence";
      return;
    }

    if (rawMode === "customize" || rawMode === "custom") {
      const scriptRaw = String(options.klingStoryboardScript || "").trim();
      if (!scriptRaw) {
        throw new BadRequestException("可灵 Omni 自定义分镜模式需要填写分镜脚本 JSON");
      }
      const shots = this.parseTencentKlingCustomStoryboardShots(scriptRaw);
      const totalShotDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);
      const taskDuration = Number(duration);
      if (Number.isFinite(taskDuration) && taskDuration > 0 && totalShotDuration !== taskDuration) {
        throw new BadRequestException(
          `可灵 Omni 自定义分镜总时长需等于任务时长：当前分镜总时长 ${totalShotDuration}s，任务时长 ${taskDuration}s`,
        );
      }
      metadata.multi_shot = true;
      metadata.shot_type = "customize";
      metadata.multi_prompt = shots;
      return;
    }

    throw new BadRequestException(
      "可灵 Omni 分镜模式无效，仅支持 single / intelligence / customize",
    );
  }

  private resolveNewApiDuration(options: VideoProviderRequestDto): number {
    const duration = Number(options.duration || 5);
    if (!Number.isFinite(duration) || duration <= 0) return 5;
    return Math.max(1, Math.min(30, Math.round(duration)));
  }

  private resolveNewApiVideoSize(options: VideoProviderRequestDto): string | undefined {
    const resolution = this.normalizeResolutionToken(options.resolution);
    const aspectRatio = String(options.aspectRatio || "").trim();
    if (resolution === "1080p") {
      return aspectRatio === "9:16" ? "1080x1920" : "1920x1080";
    }
    if (resolution === "720p") {
      return aspectRatio === "9:16" ? "720x1280" : "1280x720";
    }
    return undefined;
  }

  private normalizeResolutionToken(value: unknown): string | undefined {
    if (typeof value !== "string" || !value.trim()) return undefined;
    return value.trim().toLowerCase();
  }

  private extractReferenceImageUrls(items: ReferenceImageItem[] | undefined): string[] {
    if (!Array.isArray(items)) return [];
    return items
      .map((item) => (typeof item === "string" ? item : item?.url))
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());
  }

  // 存量画布数据中的第一方资产 URL 可能带历史坏 host（公网 NoSuchBucket），Kling/apimart
  // 等上游按 URL 直接拉取会失败（element 创建报"拉不到文件"、任务卡到超时）。命中坏 host
  // 时按同 key 用当前 OSS 配置重建公网 URL；query 一并丢弃——坏桶上签出的参数本就无效。
  private static readonly LEGACY_BROKEN_ASSET_HOSTS = new Set([
    "tanva-ai.tos-cn-guangzhou.volces.com",
  ]);

  private normalizeFirstPartyAssetUrl(url: string): string {
    if (!url || !/^https?:\/\//i.test(url)) return url;
    try {
      const parsed = new URL(url);
      if (!VideoProviderService.LEGACY_BROKEN_ASSET_HOSTS.has(parsed.hostname)) {
        return url;
      }
      const key = parsed.pathname.replace(/^\/+/, "");
      if (!key) return url;
      const rebuilt = this.oss.publicUrl(key);
      this.logger.warn(
        `第一方资产 URL 命中历史坏 host，已按当前 OSS 配置重建: ${parsed.hostname}/${key} -> ${rebuilt}`,
      );
      return rebuilt;
    } catch {
      return url;
    }
  }

  // Seedance 2.0: use asset:// for active volc assets; fall back to raw URL otherwise.
  private extractReferenceImageUrlsWithVolcAssets(items: ReferenceImageItem[] | undefined): string[] {
    if (!Array.isArray(items)) return [];
    return items
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item.volcAssetStatus === "active" && item.volcAssetId) {
          return `asset://${item.volcAssetId}`;
        }
        return (item.url || "").trim();
      })
      .filter((url): url is string => url.length > 0);
  }

  private isStaleAssetError(err: any): boolean {
    const msg = String(err?.message || "").toLowerCase();
    return msg.includes("is not found") && (msg.includes("asset") || msg.includes("image_url"));
  }

  private isAssetServiceNotActivatedError(err: any): boolean {
    const msg = String(err?.message || "").toLowerCase();
    return msg.includes("not activated the asset service") || msg.includes("asset service");
  }

  // 对每张图片重新调用 Volcengine 上传，返回新的 asset:// URL 列表。
  // VolcAssetService 未配置时降级返回原始 HTTPS URL。
  private async reuploadImagesAsAssets(rawUrls: string[]): Promise<string[]> {
    if (!this.volcAssetService.isConfigured()) {
      this.logger.warn("VolcAssetService 未配置，降级使用 HTTPS 直链");
      return rawUrls;
    }
    const results = await Promise.allSettled(
      rawUrls.map((url) => this.volcAssetService.uploadAsset("system", url, "image")),
    );
    return results.map((r, i) => {
      if (r.status === "fulfilled") {
        return `asset://${r.value.assetId}`;
      }
      this.logger.warn(`重新上传第 ${i + 1} 张图片失败，降级 HTTPS: ${(r as PromiseRejectedResult).reason?.message}`);
      return rawUrls[i];
    });
  }

  private async requestNewApiJson(path: string, init: RequestInit): Promise<any> {
    const response = await fetch(`${this.newApiBaseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.newApiKey}`,
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    const data = text ? this.safeJsonParse(text) ?? text : {};
    if (!response.ok) {
      const message =
        typeof data === "object" && data
          ? (data as any).error?.message || (data as any).message || JSON.stringify(data)
          : String(data || `HTTP ${response.status}`);
      throw new ServiceUnavailableException(`new-api 视频接口失败: ${message}`);
    }
    return data;
  }

  // APIMart (e.g. Vidu) wraps the task in a `data` array:
  // {code, data:[{status, task_id, url}]}. Other new-api models return `data`
  // as a plain object. Unwrap the first array entry so the field probes below
  // work for both shapes — otherwise status stays "processing" forever and the
  // frontend hangs on 生成中. See APIMart vidu-q3 docs.
  private firstNewApiDataEntry(result: any): any {
    const data = result?.data;
    return Array.isArray(data) ? data[0] : data;
  }

  private extractTaskId(result: any): string | null {
    const data = this.firstNewApiDataEntry(result);
    const value =
      result?.id ||
      result?.task_id ||
      result?.taskId ||
      data?.id ||
      data?.task_id ||
      data?.taskId;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private normalizeNewApiStatus(result: any): string {
    const data = this.firstNewApiDataEntry(result);
    const raw = String(
      result?.status ||
      data?.status ||
      data?.task_status ||
      result?.task_status ||
      ""
    ).toLowerCase();
    if (["succeeded", "success", "succeed", "completed", "complete", "finished", "finish"].includes(raw)) {
      return "succeeded";
    }
    if (["failed", "failure", "error", "cancelled", "canceled"].includes(raw)) {
      return "failed";
    }
    return raw || "processing";
  }

  private extractVideoUrl(result: any): string | undefined {
    const isHttpUrl = (v: unknown): v is string =>
      typeof v === "string" && /^https?:\/\//i.test(v);

    // flat fields
    const flat = [
      result?.video_url,
      result?.videoUrl,
      result?.url,
      result?.metadata?.url,          // new-api OpenAI Video 格式: SetMetadata("url", ...)
      result?.data?.video_url,
      result?.data?.videoUrl,
      result?.data?.url,
      result?.data?.metadata?.url,
      result?.output?.video_url,
      result?.output?.url,
      result?.output?.video?.url,
      result?.video?.url,
    ];
    for (const v of flat) {
      if (isHttpUrl(v)) return v;
    }

    // OpenAI Sora format: generations[].url
    if (Array.isArray(result?.generations)) {
      for (const item of result.generations) {
        if (isHttpUrl(item?.url)) return item.url;
        if (isHttpUrl(item?.video?.url)) return item.video.url;
      }
    }

    // Kling native format: data.task_result.videos[].url
    if (Array.isArray(result?.data?.task_result?.videos)) {
      for (const item of result.data.task_result.videos) {
        if (isHttpUrl(item?.url)) return item.url;
      }
    }

    // Generic nested arrays
    for (const arr of [result?.data, result?.results, result?.data?.videos, result?.output?.videos]) {
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (isHttpUrl(item?.url)) return item.url;
          if (isHttpUrl(item?.video_url)) return item.video_url;
        }
      }
    }

    return undefined;
  }

  private extractThumbnailUrl(result: any): string | undefined {
    const data = this.firstNewApiDataEntry(result);
    const candidates = [
      result?.thumbnail_url,
      result?.thumbnailUrl,
      result?.poster,
      data?.thumbnail_url,
      data?.thumbnailUrl,
      data?.poster,
    ];
    return candidates.find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
  }

  private stripUndefined(payload: Record<string, any>): Record<string, any> {
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    );
  }

  private safeJsonParse(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private async generateManagedKlingO3(
    options: VideoProviderRequestDto
  ): Promise<VideoGenerationResult> {
    const managedResult = await this.executeManagedRouteWithFallback(
      "kling-o3",
      options.vendorKey,
      async (route) => {
      if (this.shouldUseManagedV2RequestProfile(route)) {
        return this.createManagedV2Task("kling-o3", options, route);
      }
      if (route.route === "tencent_vod") {
        return this.generateKlingOmniViaTencent(options, route.vendor);
      }

      const apiKey = this.apiKeys["kling-o3"];
      if (!apiKey || apiKey.includes("xxx")) {
        throw new ServiceUnavailableException("kling-o3 API Key 未配置");
      }
      return this.generateKlingO1(options, apiKey);
      },
    );
    if (managedResult) return managedResult;

    const apiKey = this.apiKeys["kling-o3"];
    if (!apiKey || apiKey.includes("xxx")) {
      throw new ServiceUnavailableException("kling-o3 API Key 未配置");
    }
    return this.generateKlingO1(options, apiKey);
  }

  private async generateManagedKling26(
    options: VideoProviderRequestDto
  ): Promise<VideoGenerationResult> {
    const managedResult = await this.executeManagedRouteWithFallback(
      "kling-2.6",
      options.vendorKey,
      async (route) => {
      if (this.shouldUseManagedV2RequestProfile(route)) {
        return this.createManagedV2Task("kling-2.6", options, route);
      }
      if (route.route === "tencent_vod") {
        const result = await this.generateKlingViaTencent(
          options,
          route.vendor,
          "2.6"
        );
        return this.withManagedTencentTaskPrefix("kling-2.6", result);
      }

      const apiKey = this.apiKeys["kling-2.6"];
      if (!apiKey || apiKey.includes("xxx")) {
        throw new ServiceUnavailableException("kling-2.6 API Key 未配置");
      }
      return this.generateKling26(options, apiKey);
      },
    );
    if (managedResult) return managedResult;

    const apiKey = this.apiKeys["kling-2.6"];
    if (!apiKey || apiKey.includes("xxx")) {
      throw new ServiceUnavailableException("kling-2.6 API Key 未配置");
    }
    return this.generateKling26(options, apiKey);
  }

  private async generateManagedKling30(
    options: VideoProviderRequestDto
  ): Promise<VideoGenerationResult> {
    const managedResult = await this.executeManagedRouteWithFallback(
      "kling-3.0",
      options.vendorKey,
      async (route) => {
      if (this.shouldUseManagedV2RequestProfile(route)) {
        return this.createManagedV2Task("kling-3.0", options, route);
      }
      if (route.route === "tencent_vod") {
        const result = await this.generateKlingViaTencent(
          options,
          route.vendor,
          "3.0"
        );
        return {
          ...result,
          taskId: `${MANAGED_KLING30_TENCENT_TASK_PREFIX}${result.taskId}`,
        };
      }

      const klingO3ApiKey = this.apiKeys["kling-o3"];
      if (!klingO3ApiKey || klingO3ApiKey.includes("xxx")) {
        throw new ServiceUnavailableException("kling-o3 API Key 未配置");
      }

      return this.generateKlingO1(
        {
          ...options,
          provider: "kling-o3",
        },
        klingO3ApiKey,
      );
      },
    );
    if (managedResult) return managedResult;

    const klingO3ApiKey = this.apiKeys["kling-o3"];
    if (!klingO3ApiKey || klingO3ApiKey.includes("xxx")) {
      throw new ServiceUnavailableException("kling-o3 API Key 未配置");
    }

    return this.generateKlingO1(
      {
        ...options,
        provider: "kling-o3",
      },
      klingO3ApiKey,
    );
  }

  private async queryManagedKlingO3(taskId: string) {
    const route = await this.modelRoutingService.resolveVideoModel("kling-o3");
    if (route?.route === "tencent_vod") {
      return this.queryTencentManagedVideoTask(taskId, "kling-o3", "Kling 3.0-Omni");
    }

    const apiKey = this.apiKeys["kling-o3"];
    if (!apiKey || apiKey.includes("xxx")) {
      throw new ServiceUnavailableException("kling-o3 API Key 未配置");
    }
    return this.queryKlingO1(taskId, apiKey);
  }

  private async generateManagedVidu(
    options: VideoProviderRequestDto
  ): Promise<VideoGenerationResult> {
    const resolved = this.resolveManagedViduModel(options);
    const managedResult = await this.executeManagedRouteWithFallback(
      resolved.modelKey,
      options.vendorKey,
      async (route) => {
      if (this.shouldUseManagedV2RequestProfile(route)) {
        return this.createManagedV2Task(resolved.modelKey, options, route);
      }

      if (route.route === "tencent_vod") {
        const result = await this.generateViduViaTencent(
          options,
          route.vendor,
          resolved.modelVersion,
        );
        return this.withManagedTencentTaskPrefix(resolved.modelKey, result);
      }

      const apiKey = this.apiKeys[resolved.legacyProvider];
      if (!apiKey || apiKey.includes("xxx")) {
        throw new ServiceUnavailableException(`${resolved.legacyProvider} API Key 未配置`);
      }

      if (resolved.modelVersion === "q2") {
        return this.generateVidu(options, apiKey);
      }

      if (resolved.modelVersion === "q3") {
        return this.generateViduQ3Pro(options, apiKey);
      }

      throw new ServiceUnavailableException(
        `旧链路暂不支持 ${resolved.label}，请在模型管理切换到腾讯 VOD`
      );
      },
    );
    if (managedResult) return managedResult;

    throw new ServiceUnavailableException(`未找到 ${resolved.label} 的可用生成链路`);
  }

  private async generateManagedSeedance(
    options: VideoProviderRequestDto
  ): Promise<VideoGenerationResult> {
    const resolved = this.resolveManagedSeedanceModel(options);
    const managedResult = await this.executeManagedRouteWithFallback(
      resolved.modelKey,
      options.vendorKey,
      async (route) => {
      if (this.shouldUseManagedV2RequestProfile(route)) {
        return this.createManagedV2Task(resolved.modelKey, options, route);
      }

      if (route.route === "tencent_vod") {
        const result = await this.generateSeedanceViaTencent(
          options,
          route.vendor,
          resolved.modelVersion
        );
        return this.withManagedTencentTaskPrefix(resolved.modelKey, result);
      }

      const apiKey = this.apiKeys.doubao;
      if (!apiKey || apiKey.includes("xxx")) {
        throw new ServiceUnavailableException("doubao API Key 未配置");
      }
      return this.generateDoubao(options, apiKey, resolved.modelVersion);
      },
    );
    if (managedResult) return managedResult;

    throw new ServiceUnavailableException(`未找到 ${resolved.label} 的可用生成链路`);
  }

  private shouldUseManagedV2RequestProfile(route: ResolvedManagedModelRoute): boolean {
    const branch = String(route.vendor?.metadata?.executionBranch || "legacy").trim();
    const profile = route.vendor?.metadata?.requestProfile;
    return branch === "v2_request_profile" && !!profile && profile.enabled !== false;
  }

  private getManagedV2RequestProfile(route: ResolvedManagedModelRoute): ManagedV2RequestProfile | null {
    const profile = route.vendor?.metadata?.requestProfile;
    if (!profile || typeof profile !== "object") {
      return null;
    }
    return profile as ManagedV2RequestProfile;
  }

  private buildManagedV2TaskId(modelKey: string, vendorKey: string, rawTaskId: string): string {
    return `${this.managedV2TaskPrefix}${encodeURIComponent(modelKey)}:${encodeURIComponent(vendorKey)}:${encodeURIComponent(rawTaskId)}`;
  }

  private parseManagedV2TaskId(taskId: string): ManagedV2ParsedTask | null {
    if (!taskId.startsWith(this.managedV2TaskPrefix)) {
      return null;
    }
    const payload = taskId.slice(this.managedV2TaskPrefix.length);
    const first = payload.indexOf(":");
    const second = payload.indexOf(":", first + 1);
    if (first < 0 || second < 0) {
      return null;
    }

    try {
      return {
        modelKey: decodeURIComponent(payload.slice(0, first)),
        vendorKey: decodeURIComponent(payload.slice(first + 1, second)),
        rawTaskId: decodeURIComponent(payload.slice(second + 1)),
      };
    } catch {
      return null;
    }
  }

  private getProviderApiKey(provider: string): string {
    const key = this.apiKeys[provider as keyof typeof this.apiKeys];
    if (!key || key.includes("xxx")) {
      throw new ServiceUnavailableException(`${provider} API Key 未配置`);
    }
    return key;
  }

  private buildManagedV2PromptText(options: VideoProviderRequestDto): string {
    return typeof options.prompt === "string" ? options.prompt.trim() : "";
  }

  private normalizeManagedV2ReferenceVideos(options: VideoProviderRequestDto): string[] {
    const candidates = [
      ...(Array.isArray(options.referenceVideos) ? options.referenceVideos : []),
      options.referenceVideo,
    ];

    return candidates
      .map((item) =>
        typeof item === "string" ? this.normalizeManagedAssetUrlForUpstream(item) : ""
      )
      .filter((item, index, array) => !!item && array.indexOf(item) === index);
  }

  private normalizeManagedV2ReferenceAudios(options: VideoProviderRequestDto): string[] {
    return (Array.isArray(options.audioUrls) ? options.audioUrls : [])
      .map((item) =>
        typeof item === "string" ? this.normalizeManagedAssetUrlForUpstream(item) : ""
      )
      .filter((item, index, array) => !!item && array.indexOf(item) === index);
  }

  private normalizeSeedanceApiResolution(
    modelKey: string,
    route: ResolvedManagedModelRoute,
    resolution: unknown,
  ): string | undefined {
    const normalized = typeof resolution === "string" ? resolution.trim() : "";
    if (!normalized) return undefined;
    if (!modelKey.startsWith("seedance-")) return normalized;
    if (route.vendor.vendorKey !== "seedance_api") return normalized;

    const upper = normalized.toUpperCase();
    if (upper === "480P") return "480p";
    if (upper === "720P") return "720p";
    if (upper === "1080P") return "1080p";
    return normalized;
  }

  private async buildManagedV2RequestContext(
    modelKey: string,
    options: VideoProviderRequestDto,
    route: ResolvedManagedModelRoute,
  ) {
    // Object items (volc asset references) are passed through as-is; string items go through OSS upload.
    const { uploadedStringUrls, objectItems } = await this.splitAndUploadReferenceImages(options.referenceImages);

    const promptText = this.buildManagedV2PromptText(options);
    const referenceVideos = this.normalizeManagedV2ReferenceVideos(options);
    const referenceAudios = this.normalizeManagedV2ReferenceAudios(options);
    const resolutionForRequest = this.normalizeSeedanceApiResolution(
      modelKey,
      route,
      options.resolution,
    );
    const content: any[] = [];

    if (promptText) {
      content.push({ type: "text", text: promptText });
    }

    // String items: already resolved to HTTPS URLs via OSS upload
    for (const imageUrl of uploadedStringUrls) {
      content.push({
        type: "image_url",
        image_url: { url: imageUrl },
        role: "reference_image",
      });
    }

    // Object items: apply asset:// substitution for sd2 active assets, fallback to HTTPS URL
    const isSeedance20 = modelKey === "seedance-2.0";
    for (const item of objectItems) {
      let url: string;
      if (isSeedance20 && item.volcAssetStatus === "active" && item.volcAssetId) {
        url = `asset://${item.volcAssetId}`;
      } else {
        url = item.url;
      }
      content.push({
        type: "image_url",
        image_url: { url },
        role: "reference_image",
      });
    }

    for (const videoUrl of referenceVideos) {
      content.push({
        type: "video_url",
        video_url: { url: videoUrl },
        role: "reference_video",
      });
    }

    for (const audioUrl of referenceAudios) {
      content.push({
        type: "audio_url",
        audio_url: { url: audioUrl },
        role: "reference_audio",
      });
    }

    const objectItemUrls = objectItems.map((item) =>
      isSeedance20 && item.volcAssetStatus === "active" && item.volcAssetId
        ? `asset://${item.volcAssetId}`
        : item.url,
    );
    const allResolvedUrls = [...uploadedStringUrls, ...objectItemUrls];

    const transport = String(route.vendor?.metadata?.requestProfile?.transport || "").trim();
    const baseContext: Record<string, any> = {
      request: {
        ...options,
        resolution: resolutionForRequest,
        prompt: options.prompt || "",
        promptWithParams: promptText,
        seedanceUpstreamModelId:
          modelKey.startsWith("seedance-")
            ? resolveSeedanceUpstreamModelId(this.resolveManagedSeedanceModel(options).modelVersion)
            : undefined,
        referenceImages: allResolvedUrls,
        referenceImage: allResolvedUrls[0] || "",
        referenceVideos,
        referenceVideo: referenceVideos[0] || "",
        audioUrls: referenceAudios,
        generateAudio: options.generateAudio,
        content,
      },
      vendor: {
        vendorKey: route.vendor.vendorKey,
        provider: route.vendor.provider || options.provider,
        modelKey,
        modelName: route.vendor.modelName || "",
        modelVersion: route.vendor.modelVersion || "",
      },
    };

    if (transport !== "tencent_vod_aigc_video") {
      const apiKey = this.getProviderApiKey(route.vendor.provider || options.provider);
      baseContext.auth = {
        bearer: `Bearer ${apiKey}`,
      };
    }

    if (modelKey.startsWith("vidu-")) {
      const resolved = this.resolveManagedViduModel(options);
      const vodRequest = this.buildViduTencentCreateTaskRequest(
        options,
        route.vendor,
        resolved.modelVersion
      );
      return {
        ...baseContext,
        vod: {
          prompt: vodRequest.prompt || "",
          fileInfos: vodRequest.fileInfos || [],
          lastFrameUrl: vodRequest.lastFrameUrl || "",
          aspectRatio: vodRequest.aspectRatio || "",
          duration: vodRequest.duration || "",
          resolution: vodRequest.resolution || "",
          modelName: vodRequest.modelName,
          modelVersion: vodRequest.modelVersion,
          storageMode: vodRequest.storageMode || "Temporary",
          enhancePrompt: vodRequest.enhancePrompt || "Enabled",
        },
      };
    }

    if (modelKey.startsWith("seedance-")) {
      const resolved = this.resolveManagedSeedanceModel(options);
      const vodRequest = this.buildSeedanceTencentCreateTaskRequest(
        options,
        route.vendor,
        resolved.modelVersion
      );
      return {
        ...baseContext,
        vod: {
          prompt: vodRequest.prompt || "",
          fileInfos: vodRequest.fileInfos || [],
          lastFrameUrl: vodRequest.lastFrameUrl || "",
          aspectRatio: vodRequest.aspectRatio || "",
          duration: vodRequest.duration || "",
          resolution: vodRequest.resolution || "",
          modelName: vodRequest.modelName,
          modelVersion: vodRequest.modelVersion,
          audioGeneration: vodRequest.audioGeneration || "Disabled",
          storageMode: vodRequest.storageMode || "Temporary",
          enhancePrompt: vodRequest.enhancePrompt || "Enabled",
        },
      };
    }

    return baseContext;
  }

  private buildViduTencentCreateTaskRequest(
    options: VideoProviderRequestDto,
    vendorConfig: { modelName?: string; modelVersion?: string },
    fallbackModelVersion: ViduManagedModelVersion
  ): TencentVodAigcCreateVideoTaskRequest {
    const normalizedImages = Array.isArray(options.referenceImages)
      ? options.referenceImages
          .map((item) => typeof item === "string" ? item : item.url)
          .map((item) => this.normalizeManagedAssetUrlForUpstream(item))
          .filter((item) => typeof item === "string" && item.trim().length > 0)
      : [];

    const normalizedPrompt =
      typeof options.prompt === "string" && options.prompt.trim()
        ? options.prompt.trim()
        : "";

    const resolvedModelVersion =
      (vendorConfig.modelVersion || fallbackModelVersion).trim().toLowerCase() as ViduManagedModelVersion;

    const explicitVideoMode = String(options.videoMode || "")
      .trim()
      .toLowerCase();
    const forceStartEndMode =
      explicitVideoMode === "start-end2video" ||
      explicitVideoMode === "start_end" ||
      explicitVideoMode === "start-end";

    if (forceStartEndMode && normalizedImages.length < 2) {
      throw new BadRequestException("Vidu 首尾帧模式至少需要 2 张图片（图1/图2）");
    }

    const isStartEndCandidate =
      forceStartEndMode ||
      (normalizedImages.length >= 2 &&
        !normalizedPrompt &&
        resolvedModelVersion === "q2");

    const primaryImages = isStartEndCandidate ? normalizedImages.slice(0, 1) : normalizedImages;
    const lastFrameUrl = isStartEndCandidate ? normalizedImages[1] : undefined;

    const fileInfos = primaryImages.map((url, index) => ({
      type: "Url" as const,
      category: "Image" as const,
      url,
      objectId: `id${index + 1}`,
      usage: undefined,
    }));

    if (!normalizedPrompt && fileInfos.length === 0) {
      throw new BadRequestException("文生视频模式需要提供提示词");
    }

    const resolutionRaw =
      typeof options.resolution === "string" && options.resolution.trim()
        ? options.resolution.trim().toUpperCase()
        : "720P";

    const duration =
      typeof options.duration === "number" && Number.isFinite(options.duration)
        ? Math.max(1, Math.min(16, Math.round(options.duration)))
        : resolvedModelVersion.startsWith("q3")
        ? 8
        : 5;

    return {
      modelName: vendorConfig.modelName || "Vidu",
      modelVersion: vendorConfig.modelVersion || fallbackModelVersion,
      prompt: normalizedPrompt || undefined,
      fileInfos,
      aspectRatio: options.aspectRatio,
      duration,
      resolution: resolutionRaw,
      storageMode: "Temporary",
      enhancePrompt: "Enabled",
      lastFrameUrl,
    };
  }

  private buildSeedanceTencentCreateTaskRequest(
    options: VideoProviderRequestDto,
    vendorConfig: { modelName?: string; modelVersion?: string },
    fallbackModelVersion: SeedanceManagedModelVersion
  ): TencentVodAigcCreateVideoTaskRequest {
    const normalizedImages = Array.isArray(options.referenceImages)
      ? options.referenceImages
          .map((item) => typeof item === "string" ? item : item.url)
          .map((item) => this.normalizeManagedAssetUrlForUpstream(item))
          .filter((item) => typeof item === "string" && item.trim().length > 0)
      : [];

    const normalizedPrompt =
      typeof options.prompt === "string" && options.prompt.trim()
        ? options.prompt.trim()
        : "";

    if (!normalizedPrompt && normalizedImages.length === 0) {
      throw new BadRequestException("Seedance 需要提供提示词或至少 1 张参考图");
    }

    const fileInfos = normalizedImages.map((url, index) => ({
      type: "Url" as const,
      category: "Image" as const,
      url,
      objectId: `id${index + 1}`,
    }));

    const requestedResolution =
      typeof options.resolution === "string" && options.resolution.trim()
        ? options.resolution.trim().toUpperCase()
        : "720P";
    const resolvedModelVersion =
      (vendorConfig.modelVersion || fallbackModelVersion).trim().toLowerCase();
    const resolution = (() => {
      if (resolvedModelVersion === "1.5-pro") return "720P";
      const allow1080 =
        resolvedModelVersion === "2.0" || resolvedModelVersion === "2.0-pro";
      if (
        requestedResolution === "480P" ||
        requestedResolution === "720P" ||
        (allow1080 && requestedResolution === "1080P")
      ) {
        return requestedResolution;
      }
      return "720P";
    })();
    const duration =
      typeof options.duration === "number" && Number.isFinite(options.duration)
        ? resolvedModelVersion === "1.5-pro"
          ? Math.max(4, Math.min(12, Math.round(options.duration)))
          : Math.max(4, Math.min(15, Math.round(options.duration)))
        : 5;

    return {
      modelName: vendorConfig.modelName || "Seedance",
      modelVersion: vendorConfig.modelVersion || fallbackModelVersion,
      prompt: normalizedPrompt || undefined,
      fileInfos,
      aspectRatio: options.aspectRatio,
      duration,
      resolution,
      audioGeneration:
        resolvedModelVersion === "1.5-pro"
          ? "Disabled"
          : options.generateAudio
          ? "Enabled"
          : "Disabled",
      storageMode: "Temporary",
      enhancePrompt: "Enabled",
    };
  }

  private resolveTemplatePath(source: any, path: string): any {
    const normalized = path.trim();
    if (!normalized) return undefined;
    return normalized.split(".").reduce((acc, segment) => {
      if (acc == null) return undefined;
      if (/^\d+$/.test(segment)) {
        const index = Number(segment);
        return Array.isArray(acc) ? acc[index] : undefined;
      }
      return acc[segment];
    }, source);
  }

  private renderTemplateValue(value: any, context: any): any {
    if (typeof value === "string") {
      const exact = value.match(/^\{\{\s*([^}]+)\s*\}\}$/);
      if (exact) {
        return this.resolveTemplatePath(context, exact[1]);
      }

      return value.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, token) => {
        const resolved = this.resolveTemplatePath(context, token);
        if (resolved == null) return "";
        if (typeof resolved === "object") {
          return JSON.stringify(resolved);
        }
        return String(resolved);
      });
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => this.renderTemplateValue(item, context))
        .filter((item) => item !== undefined && item !== null && item !== "");
    }

    if (value && typeof value === "object") {
      const next: Record<string, any> = {};
      Object.entries(value).forEach(([key, item]) => {
        const rendered = this.renderTemplateValue(item, context);
        if (rendered !== undefined && rendered !== null && rendered !== "") {
          next[key] = rendered;
        }
      });
      return next;
    }

    return value;
  }

  private readMappedValue(source: any, paths?: string[]): any {
    if (!Array.isArray(paths)) return undefined;
    for (const path of paths) {
      const value = this.resolveTemplatePath(source, path);
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }
    return undefined;
  }

  private async executeManagedV2Stage(
    stage: ManagedV2RequestStage,
    context: any,
  ): Promise<{ raw: any; mapped: Record<string, any> }> {
    const method = String(stage.method || "GET").toUpperCase();
    const url = String(this.renderTemplateValue(stage.path || "", context) || "").trim();
    if (!url) {
      throw new ServiceUnavailableException("V2 请求配置缺少 path");
    }

    const headers = (this.renderTemplateValue(stage.headers || {}, context) || {}) as Record<string, any>;
    const query = (this.renderTemplateValue(stage.query || {}, context) || {}) as Record<string, any>;
    const body = this.renderTemplateValue(stage.body, context);
    if (
      body &&
      typeof body === "object" &&
      typeof (body as Record<string, any>).model === "string"
    ) {
      const modelKey = String(context?.vendor?.modelKey || "").trim().toLowerCase();
      const vendorKey = String(context?.vendor?.vendorKey || "").trim().toLowerCase();
      if (modelKey === "seedance-2.0" && vendorKey === "seedance_api") {
        const before = String((body as Record<string, any>).model || "").trim();
        if (before) {
          const after = normalizeSeedanceUpstreamModelIdAlias(before);
          if (after !== before) {
            this.logger.warn(
              `[Seedance2] normalize v2 request model alias in-stage: ${before} -> ${after}`,
            );
            (body as Record<string, any>).model = after;
          }
          this.logger.log(
            `[Seedance2] v2 create/query model=${String((body as Record<string, any>).model || "").trim()}`,
          );
        }
      }
    }

    const finalUrl = new URL(url);
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      finalUrl.searchParams.set(key, String(value));
    });

    const requestHeaders = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key, String(value)])
    );
    const timeout = method === "GET" ? QUERY_FETCH_TIMEOUT : DEFAULT_FETCH_TIMEOUT;
    const runStageRequest = async (bodyOverride: any) => {
      const response = await fetchWithTimeout(finalUrl.toString(), {
        method,
        headers: requestHeaders,
        body:
          bodyOverride === undefined || bodyOverride === null || method === "GET"
            ? undefined
            : JSON.stringify(bodyOverride),
        timeout,
      });
      const raw = await response.json().catch(async () => ({
        message: await response.text().catch(() => ""),
      }));
      return { response, raw };
    };

    let { response, raw } = await runStageRequest(body);

    if (!response.ok) {
      const errorMessage =
        this.readMappedValue(raw, stage.responseMapping?.error) ||
        raw?.error?.message ||
        raw?.message ||
        `HTTP ${response.status}`;
      const modelKey = String(context?.vendor?.modelKey || "").trim().toLowerCase();
      const vendorKey = String(context?.vendor?.vendorKey || "").trim().toLowerCase();
      const currentModel =
        body && typeof body === "object" ? String((body as Record<string, any>).model || "").trim() : "";
      const currentModelNormalized = currentModel.toLowerCase();
      const shouldRetryWithSeedance20Base =
        method !== "GET" &&
        modelKey === "seedance-2.0" &&
        vendorKey === "seedance_api" &&
        currentModelNormalized === "doubao-seedance-2-0-fast-260128" &&
        /model|not valid|invalid|not support|does not support/i.test(String(errorMessage || ""));

      if (shouldRetryWithSeedance20Base) {
        const retryBody =
          body && typeof body === "object"
            ? { ...(body as Record<string, any>), model: "doubao-seedance-2-0-260128" }
            : body;
        this.logger.warn(
          `[Seedance2] retry create with fallback model: ${currentModel} -> doubao-seedance-2-0-260128`,
        );
        const retried = await runStageRequest(retryBody);
        response = retried.response;
        raw = retried.raw;
        if (!response.ok) {
          throw new Error(
            this.readMappedValue(raw, stage.responseMapping?.error) ||
              raw?.error?.message ||
              raw?.message ||
              `HTTP ${response.status}`
          );
        }
      } else {
        throw new Error(errorMessage);
      }
    }

    const mapped = Object.fromEntries(
      Object.entries(stage.responseMapping || {}).map(([key, paths]) => [
        key,
        this.readMappedValue(raw, paths),
      ])
    );

    return { raw, mapped };
  }

  private async createManagedV2Task(
    modelKey: string,
    options: VideoProviderRequestDto,
    route: ResolvedManagedModelRoute,
  ): Promise<VideoGenerationResult> {
    const profile = this.getManagedV2RequestProfile(route);
    if (!profile?.create) {
      throw new ServiceUnavailableException(`V2 配置缺少 create 阶段: ${modelKey}`);
    }

    const context = await this.buildManagedV2RequestContext(modelKey, options, route);
    const transport = String(profile.transport || "").trim();

    let rawTaskId = "";
    if (transport === "tencent_vod_aigc_video") {
      const payload = this.renderTemplateValue(profile.create.body || {}, context) as TencentVodAigcCreateVideoTaskRequest;
      const result = await this.tencentVodAigcService.createVideoTask(payload);
      rawTaskId = String(result.taskId || "").trim();
    } else {
      if (
        modelKey === "seedance-2.0" &&
        route.vendor.vendorKey === "seedance_api"
      ) {
        const renderedBody = this.renderTemplateValue(profile.create.body || {}, context) as Record<string, any>;
        if (typeof renderedBody?.model === "string" && renderedBody.model.trim().length > 0) {
          const before = renderedBody.model.trim();
          const after = normalizeSeedanceUpstreamModelIdAlias(before);
          if (after !== before) {
            this.logger.warn(
              `[Seedance2] normalize upstream model alias: ${before} -> ${after}`,
            );
            renderedBody.model = after;
          }
        }
        const normalizedProfile = {
          ...profile,
          create: {
            ...profile.create,
            body: renderedBody,
          },
        } as ManagedV2RequestProfile;
        const { mapped } = await this.executeManagedV2Stage(
          normalizedProfile.create!,
          context,
        );
        rawTaskId = String(mapped.taskId || mapped.id || "").trim();
      } else {
        const { mapped } = await this.executeManagedV2Stage(profile.create, context);
        rawTaskId = String(mapped.taskId || mapped.id || "").trim();
      }
    }

    if (!rawTaskId) {
      throw new ServiceUnavailableException(`V2 创建任务未返回 taskId: ${modelKey}`);
    }

    return {
      taskId: this.buildManagedV2TaskId(modelKey, route.vendor.vendorKey, rawTaskId),
      status: "queued",
    };
  }

  private normalizeManagedV2Status(
    route: ResolvedManagedModelRoute,
    status: any,
  ): "queued" | "processing" | "succeeded" | "failed" {
    const normalized = String(status || "").trim().toLowerCase();
    if (!normalized) return "queued";

    const polling =
      route.vendor?.metadata?.polling && typeof route.vendor.metadata.polling === "object"
        ? (route.vendor.metadata.polling as Record<string, any>)
        : {};

    const successStatuses = Array.isArray(polling.successStatuses)
      ? polling.successStatuses.map((item: unknown) => String(item).trim().toLowerCase())
      : ["succeeded", "success", "completed", "done", "finish", "finished"];
    const failedStatuses = Array.isArray(polling.failedStatuses)
      ? polling.failedStatuses.map((item: unknown) => String(item).trim().toLowerCase())
      : ["failed", "error", "canceled", "cancelled", "timeout", "expired", "fail"];
    const processingStatuses = Array.isArray(polling.processingStatuses)
      ? polling.processingStatuses.map((item: unknown) => String(item).trim().toLowerCase())
      : ["running", "processing", "pending", "queued", "submitted", "waiting"];

    if (successStatuses.includes(normalized)) return "succeeded";
    if (failedStatuses.includes(normalized)) return "failed";
    if (processingStatuses.includes(normalized)) return normalized === "queued" ? "queued" : "processing";
    return "processing";
  }

  private extractTencentVodTerminalError(raw: any): string | null {
    const aigcTask = raw?.AigcVideoTask || raw?.AIGCVideoTask || raw?.Response?.AigcVideoTask || raw?.Response?.AIGCVideoTask;
    const procedureTask = raw?.ProcedureTask || raw?.Response?.ProcedureTask;

    const errCode = Number(aigcTask?.ErrCode || procedureTask?.ErrCode || 0);
    const errCodeExt = String(aigcTask?.ErrCodeExt || procedureTask?.ErrCodeExt || "").trim();
    const message = String(aigcTask?.Message || procedureTask?.Message || raw?.Message || raw?.Response?.Message || "").trim();

    if (errCode > 0 || errCodeExt || message) {
      return [errCode > 0 ? `ErrCode=${errCode}` : "", errCodeExt, message]
        .filter(Boolean)
        .join(" ");
    }

    return null;
  }

  private async queryManagedV2Task(taskId: string) {
    const parsed = this.parseManagedV2TaskId(taskId);
    if (!parsed) {
      return { status: "processing" };
    }

    const route = await this.modelRoutingService.resolveVideoModelByVendor(
      parsed.modelKey,
      parsed.vendorKey,
      { includeDisabled: true },
    );
    if (!route || !this.shouldUseManagedV2RequestProfile(route)) {
      throw new ServiceUnavailableException(`未找到 V2 任务配置: ${parsed.modelKey}/${parsed.vendorKey}`);
    }

    const profile = this.getManagedV2RequestProfile(route);
    if (!profile?.query) {
      throw new ServiceUnavailableException(`V2 配置缺少 query 阶段: ${parsed.modelKey}`);
    }

    const transport = String(profile.transport || "").trim();
    let mapped: Record<string, any> = {};

    if (transport === "tencent_vod_aigc_video") {
      const result = await this.tencentVodAigcService.queryVideoTask(parsed.rawTaskId);
      mapped = {
        status: result.status,
        videoUrl: result.videoUrl,
        fileId: result.fileId,
        requestId: result.requestId,
        error: this.extractTencentVodTerminalError(result.raw),
      };
    } else {
      const apiKey = this.getProviderApiKey(route.vendor.provider || "doubao");
      const context = {
        task: { id: parsed.rawTaskId },
        auth: { bearer: `Bearer ${apiKey}` },
      };
      ({ mapped } = await this.executeManagedV2Stage(profile.query, context));
    }

    const status = this.normalizeManagedV2Status(route, mapped.status);

    if (status === "succeeded") {
      const upstreamUrl = String(mapped.videoUrl || "").trim();
      if (!upstreamUrl) {
        throw new ServiceUnavailableException(
          String(mapped.error || "").trim() || "V2 查询成功但返回空视频链接"
        );
      }
      if (this.isOssPublicUrl(upstreamUrl)) {
        return { status, videoUrl: upstreamUrl };
      }
      const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, parsed.rawTaskId);
      return { status, videoUrl: ossUrl };
    }

    if (status === "failed") {
      return {
        status,
        error: String(mapped.error || "生成失败"),
      };
    }

    return { status };
  }

  private withManagedTencentTaskPrefix(
    modelKey: ManagedTencentVideoModelKey,
    result: VideoGenerationResult,
  ): VideoGenerationResult {
    const meta = MANAGED_TENCENT_VIDEO_MODEL_META[modelKey];
    return {
      ...result,
      taskId: `${meta.prefix}${result.taskId}`,
    };
  }

  private parseManagedTencentTaskId(taskId: string): {
    modelKey: ManagedTencentVideoModelKey;
    rawTaskId: string;
  } | null {
    for (const [modelKey, meta] of Object.entries(MANAGED_TENCENT_VIDEO_MODEL_META) as Array<
      [ManagedTencentVideoModelKey, (typeof MANAGED_TENCENT_VIDEO_MODEL_META)[ManagedTencentVideoModelKey]]
    >) {
      if (taskId.startsWith(meta.prefix)) {
        return {
          modelKey,
          rawTaskId: taskId.slice(meta.prefix.length),
        };
      }
    }
    return null;
  }

  private async queryManagedTencentVideoTask(taskId: string) {
    const parsed = this.parseManagedTencentTaskId(taskId);
    if (!parsed) {
      return { status: "processing" };
    }

    const meta = MANAGED_TENCENT_VIDEO_MODEL_META[parsed.modelKey];
    return this.queryTencentManagedVideoTask(parsed.rawTaskId, meta.uploadKeyPrefix, meta.label);
  }

  private resolveManagedViduModel(options: VideoProviderRequestDto): {
    modelKey: ManagedTencentVideoModelKey;
    modelVersion: ViduManagedModelVersion;
    legacyProvider: "vidu" | "viduq3-pro";
    label: string;
  } {
    const normalized = String(options.viduModel || "").trim().toLowerCase();
    const isQ2Family =
      normalized === "" ||
      normalized === "q2" ||
      normalized === "q2-pro" ||
      normalized === "q2pro" ||
      normalized === "q2-turbo" ||
      normalized === "q2turbo";
    const isQ3Family =
      normalized === "q3" ||
      normalized === "q3-pro" ||
      normalized === "q3pro" ||
      normalized === "q3-turbo" ||
      normalized === "q3turbo" ||
      normalized === "q3-mix" ||
      normalized === "q3mix";
    if (!isQ2Family && !isQ3Family) {
      throw new BadRequestException("暂不支持该 Vidu 模型版本，仅支持 q2 / q3");
    }

    if (isQ3Family) {
      return {
        modelKey: "vidu-q3",
        modelVersion: "q3",
        legacyProvider: "viduq3-pro",
        label: "Vidu Q3",
      };
    }

    return {
      modelKey: "vidu-q2",
      modelVersion: "q2",
      legacyProvider: "vidu",
      label: "Vidu Q2",
    };
  }

  private resolveManagedSeedanceModel(options: VideoProviderRequestDto): {
    modelKey: "seedance-1.5" | "seedance-2.0";
    modelVersion: SeedanceManagedModelVersion;
    label: string;
  } {
    const normalized = String(options.seedanceModel || "").trim().toLowerCase();
    if (
      normalized === "seed-2.0-pro" ||
      normalized === "seed-2-0-pro" ||
      normalized === "seedance-2.0-pro" ||
      normalized === "2.0-pro"
    ) {
      return {
        modelKey: "seedance-2.0",
        modelVersion: "2.0-pro",
        label: "Seed 2.0 Pro",
      };
    }
    if (
      normalized === "seed-2.0-lite" ||
      normalized === "seedance-2.0-lite" ||
      normalized === "seed-2-0-lite" ||
      normalized === "2.0-lite"
    ) {
      return {
        modelKey: "seedance-2.0",
        modelVersion: "2.0-lite",
        label: "Seed 2.0 Lite",
      };
    }
    if (
      normalized === "seed-2.0-mini" ||
      normalized === "seed-2-0-mini" ||
      normalized === "seedance-2.0-mini" ||
      normalized === "2.0-mini"
    ) {
      return {
        modelKey: "seedance-2.0",
        modelVersion: "2.0-mini",
        label: "Seed 2.0 Mini",
      };
    }
    if (normalized === "seedance-2.0-fast" || normalized === "2.0-fast") {
      return {
        modelKey: "seedance-2.0",
        modelVersion: "2.0",
        label: "Seedance 2.0",
      };
    }
    if (normalized === "seedance-2.0" || normalized === "2.0") {
      return {
        modelKey: "seedance-2.0",
        modelVersion: "2.0",
        label: "Seedance 2.0",
      };
    }

    return {
      modelKey: "seedance-1.5",
      modelVersion: "1.5-pro",
      label: "Seedance 1.5-Pro",
    };
  }

  private async generateKlingOmniViaTencent(
    options: VideoProviderRequestDto,
    vendorConfig: { modelName?: string; modelVersion?: string }
  ): Promise<VideoGenerationResult> {
    return this.generateKlingViaTencent(options, vendorConfig, "3.0-Omni");
  }

  private isTencentKling3ModelVersion(modelVersion: string): boolean {
    const normalized = String(modelVersion || "").trim().toLowerCase();
    return normalized === "3.0" || normalized === "3.0-omni";
  }

  private normalizeTencentKlingStoryboardMode(
    rawMode: unknown
  ): "single" | "intelligence" | "customize" {
    const normalized = String(rawMode || "")
      .trim()
      .toLowerCase();
    if (!normalized || normalized === "single" || normalized === "none" || normalized === "off") {
      return "single";
    }
    if (normalized === "intelligence" || normalized === "smart") {
      return "intelligence";
    }
    if (normalized === "customize" || normalized === "custom") {
      return "customize";
    }
    throw new BadRequestException(
      "Tencent Kling 分镜模式无效，仅支持 single / intelligence / customize"
    );
  }

  private parseTencentKlingCustomStoryboardShots(
    script: string
  ): Array<{ index: number; prompt: string; duration: number }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script);
    } catch {
      throw new BadRequestException("腾讯 Kling 自定义分镜脚本 JSON 格式无效");
    }

    const source = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as any).multi_prompt)
      ? (parsed as any).multi_prompt
      : null;

    if (!source) {
      throw new BadRequestException(
        "腾讯 Kling 自定义分镜脚本需为数组，格式示例：[{\"index\":1,\"prompt\":\"...\",\"duration\":2}]"
      );
    }

    if (source.length < 1 || source.length > 6) {
      throw new BadRequestException("腾讯 Kling 自定义分镜数量需在 1 到 6 之间");
    }

    return source.map((item: any, position: number) => {
      if (!item || typeof item !== "object") {
        throw new BadRequestException(`腾讯 Kling 自定义分镜第 ${position + 1} 项格式无效`);
      }
      const prompt = String((item as any).prompt || "").trim();
      if (!prompt) {
        throw new BadRequestException(`腾讯 Kling 自定义分镜第 ${position + 1} 项缺少 prompt`);
      }
      if (prompt.length > 512) {
        throw new BadRequestException(
          `腾讯 Kling 自定义分镜第 ${position + 1} 项 prompt 长度不能超过 512`
        );
      }

      const durationRaw = Number((item as any).duration);
      const duration = Math.round(durationRaw);
      if (!Number.isFinite(durationRaw) || duration < 1) {
        throw new BadRequestException(
          `腾讯 Kling 自定义分镜第 ${position + 1} 项 duration 必须为大于等于 1 的数字`
        );
      }

      const indexRaw = Number((item as any).index);
      const index =
        Number.isFinite(indexRaw) && Math.round(indexRaw) >= 1
          ? Math.round(indexRaw)
          : position + 1;

      return {
        index,
        prompt,
        duration,
      };
    });
  }

  private buildTencentKlingStoryboardExtInfo(
    options: VideoProviderRequestDto,
    modelVersion: string,
    taskDuration: number
  ): string | undefined {
    if (!this.isTencentKling3ModelVersion(modelVersion)) {
      return undefined;
    }

    const storyboardMode = this.normalizeTencentKlingStoryboardMode(
      options.klingStoryboardMode
    );
    const additionalParameters: Record<string, any> = {};

    if (storyboardMode === "single") {
      additionalParameters.multi_shot = false;
    } else if (storyboardMode === "intelligence") {
      if (!String(options.prompt || "").trim()) {
        throw new BadRequestException("腾讯 Kling 智能分镜模式需要填写提示词");
      }
      additionalParameters.multi_shot = true;
      additionalParameters.shot_type = "intelligence";
      additionalParameters.short_type = "intelligence";
    } else {
      const scriptRaw = String(options.klingStoryboardScript || "").trim();
      if (!scriptRaw) {
        throw new BadRequestException("腾讯 Kling 自定义分镜模式需要填写分镜脚本 JSON");
      }
      const shots = this.parseTencentKlingCustomStoryboardShots(scriptRaw);
      const totalShotDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);
      if (totalShotDuration !== taskDuration) {
        throw new BadRequestException(
          `腾讯 Kling 自定义分镜总时长需等于任务时长：当前分镜总时长 ${totalShotDuration}s，任务时长 ${taskDuration}s`
        );
      }
      additionalParameters.multi_shot = true;
      additionalParameters.shot_type = "customize";
      additionalParameters.short_type = "customize";
      additionalParameters.multi_prompt = shots;
    }

    return JSON.stringify({
      AdditionalParameters: JSON.stringify(additionalParameters),
    });
  }

  private async generateKlingViaTencent(
    options: VideoProviderRequestDto,
    vendorConfig: { modelName?: string; modelVersion?: string },
    fallbackModelVersion: string
  ): Promise<VideoGenerationResult> {
    const referenceAudios = this.normalizeManagedV2ReferenceAudios(options);
    if (referenceAudios.length > 0) {
      this.logger.warn(
        `Tencent Kling (${fallbackModelVersion}) does not support audio URL reference input; audioUrls will be ignored`,
      );
    }

    const normalizedImages = Array.isArray(options.referenceImages)
      ? options.referenceImages
          .map((item) => typeof item === "string" ? item : item.url)
          .map((item) => this.normalizeManagedAssetUrlForUpstream(item))
          .filter((item) => typeof item === "string" && item.trim().length > 0)
      : [];
    const normalizedReferenceVideo =
      typeof options.referenceVideo === "string"
        ? this.normalizeManagedAssetUrlForUpstream(options.referenceVideo)
        : "";

    const modelVersion = vendorConfig.modelVersion || fallbackModelVersion;
    const normalizedModelVersion = String(modelVersion || "").trim().toLowerCase();
    const isKling26Model =
      normalizedModelVersion === "2.6" || normalizedModelVersion === "2.6.0";
    const isKling30Family = this.isTencentKling3ModelVersion(modelVersion);
    const hasReferenceVideo =
      typeof normalizedReferenceVideo === "string" && normalizedReferenceVideo.trim().length > 0;
    const isStartEndMode = isKling26Model && normalizedImages.length >= 2;

    if (hasReferenceVideo && !isKling30Family) {
      throw new BadRequestException(`腾讯 VOD Kling ${fallbackModelVersion} 暂不支持视频参考模式`);
    }

    const firstFrameUrl = normalizedImages[0];
    const lastFrameUrl =
      !hasReferenceVideo && isStartEndMode && normalizedImages.length >= 2
        ? normalizedImages[1]
        : undefined;
    const imageFileInfos = firstFrameUrl
      ? isStartEndMode
        ? [
            {
              type: "Url" as const,
              category: "Image" as const,
              url: firstFrameUrl,
              usage: "FirstFrame" as const,
            },
          ]
        : normalizedImages.map((url, index) => ({
            type: "Url" as const,
            category: "Image" as const,
            url,
            objectId: `id${index + 1}`,
            usage: "Reference" as const,
          }))
      : [];
    const normalizedReferenceVideoType: "feature" | "base" =
      String(options.referenceVideoType || "").trim().toLowerCase() === "base"
        ? "base"
        : "feature";
    const normalizedKeepOriginalSound: "Enabled" | "Disabled" =
      String(options.keepOriginalSound || "").trim().toLowerCase() === "yes"
        ? "Enabled"
        : "Disabled";
    const videoFileInfos = hasReferenceVideo
      ? [
          {
            type: "Url" as const,
            category: "Video" as const,
            url: normalizedReferenceVideo,
            referenceType: normalizedReferenceVideoType,
            keepOriginalSound: normalizedKeepOriginalSound,
          },
        ]
      : [];
    const fileInfos = [...imageFileInfos, ...videoFileInfos];

    const rawResolution =
      typeof options.resolution === "string" && options.resolution.trim()
        ? options.resolution.trim().toUpperCase()
        : "";
    const defaultResolution = options.mode === "pro" ? "1080P" : "720P";
    const resolutionRaw = isKling26Model
      ? rawResolution === "720P" || rawResolution === "1080P"
        ? rawResolution
        : defaultResolution
      : rawResolution || defaultResolution;

    const requestedDuration =
      typeof options.duration === "number" && Number.isFinite(options.duration)
        ? Math.round(options.duration)
        : undefined;
    const duration = isKling26Model
      ? requestedDuration === 10
        ? 10
        : 5
      : requestedDuration !== undefined
      ? Math.max(3, Math.min(15, requestedDuration))
      : 5;

    if (hasReferenceVideo && duration > 10) {
      throw new BadRequestException("腾讯 Kling 视频参考模式仅支持 3~10 秒时长");
    }

    const normalizedSound =
      typeof options.sound === "string" ? options.sound.trim().toLowerCase() : "";
    let audioGeneration: "Enabled" | "Disabled";
    if (normalizedSound === "on") {
      audioGeneration = "Enabled";
    } else if (normalizedSound === "off") {
      audioGeneration = "Disabled";
    } else {
      audioGeneration = options.mode === "pro" ? "Enabled" : "Disabled";
    }

    if (isKling26Model && isStartEndMode && audioGeneration === "Enabled") {
      this.logger.warn(
        "Tencent Kling 2.6 start-end mode only supports no-audio, forcing OutputConfig.AudioGeneration=Disabled",
      );
      audioGeneration = "Disabled";
    }

    const extInfo = this.buildTencentKlingStoryboardExtInfo(
      options,
      modelVersion,
      duration
    );

    const { taskId } = await this.tencentVodAigcService.createVideoTask({
      modelName: vendorConfig.modelName || "Kling",
      modelVersion,
      prompt: options.prompt,
      fileInfos,
      lastFrameUrl,
      aspectRatio: options.aspectRatio,
      duration,
      resolution: resolutionRaw,
      audioGeneration,
      storageMode: "Temporary",
      enhancePrompt: "Enabled",
      extInfo,
    });

    return {
      taskId,
      status: "queued",
    };
  }

  private async generateViduViaTencent(
    options: VideoProviderRequestDto,
    vendorConfig: { modelName?: string; modelVersion?: string },
    fallbackModelVersion: ViduManagedModelVersion
  ): Promise<VideoGenerationResult> {
    const request = this.buildViduTencentCreateTaskRequest(
      options,
      vendorConfig,
      fallbackModelVersion
    );
    const { taskId } = await this.tencentVodAigcService.createVideoTask(request);

    return {
      taskId,
      status: "queued",
    };
  }

  private async generateSeedanceViaTencent(
    options: VideoProviderRequestDto,
    vendorConfig: { modelName?: string; modelVersion?: string },
    fallbackModelVersion: SeedanceManagedModelVersion
  ): Promise<VideoGenerationResult> {
    const request = this.buildSeedanceTencentCreateTaskRequest(
      options,
      vendorConfig,
      fallbackModelVersion
    );
    const { taskId } = await this.tencentVodAigcService.createVideoTask(request);

    return {
      taskId,
      status: "queued",
    };
  }

  private async queryTencentManagedVideoTask(
    taskId: string,
    uploadKeyPrefix: string,
    modelLabel: string
  ) {
    const result = await this.tencentVodAigcService.queryVideoTask(taskId);
    const normalizedStatus = String(result.status || "").trim().toLowerCase();
    const terminalError = this.extractTencentVodTerminalError(result.raw);

    if (
      normalizedStatus === "finish" ||
      normalizedStatus === "finished" ||
      normalizedStatus === "success" ||
      normalizedStatus === "succeed" ||
      normalizedStatus === "succeeded" ||
      normalizedStatus === "completed"
    ) {
      if (terminalError && !result.videoUrl) {
        return { status: "failed", error: terminalError } as any;
      }
      if (!result.videoUrl) {
        this.logger.warn(
          `Tencent VOD ${modelLabel} completed without videoUrl yet, continue polling: ${JSON.stringify(
            {
              taskId,
              status: result.status,
              fileId: result.fileId,
              requestId: result.requestId,
              terminalError,
              procedureStatus: (result.raw?.ProcedureTask as any)?.Status || null,
              procedureErrCode: (result.raw?.ProcedureTask as any)?.ErrCode || null,
              procedureMessage: (result.raw?.ProcedureTask as any)?.Message || null,
            }
          )}`
        );
        return { status: "processing" };
      }
      const ossUrl = this.isOssPublicUrl(result.videoUrl)
        ? result.videoUrl
        : await this.uploadRemoteVideoToOss(result.videoUrl, `${uploadKeyPrefix}-${taskId}`);
      return { status: "succeeded", videoUrl: ossUrl };
    }

    if (
      normalizedStatus === "failed" ||
      normalizedStatus === "fail" ||
      normalizedStatus === "error" ||
      normalizedStatus === "cancelled" ||
      normalizedStatus === "timeout" ||
      normalizedStatus === "exception"
    ) {
      const message =
        (result.raw?.ProcedureTask as any)?.Message ||
        (result.raw?.AigcVideoTask as any)?.Message ||
        "生成失败";
      return { status: "failed", error: message } as any;
    }

    return { status: "processing" };
  }

  /**
   * Seedance 1.5 Pro视频生成
   */
  private async generateDoubao(
    options: VideoProviderRequestDto,
    apiKey: string,
    modelVersion: SeedanceManagedModelVersion = "1.5-pro"
  ): Promise<VideoGenerationResult> {
    const normalizedPrompt =
      typeof options.prompt === "string" ? options.prompt.trim() : "";
    let promptText = normalizedPrompt;
    const params: string[] = [];
    const isSeedance2Model =
      modelVersion === "2.0" ||
      modelVersion === "2.0-pro" ||
      modelVersion === "2.0-lite" ||
      modelVersion === "2.0-mini";

    if (options.aspectRatio) {
      params.push(`--ratio ${options.aspectRatio}`);
    }
    if (options.duration) {
      params.push(`--dur ${options.duration}`);
    }
    if (options.camerafixed !== undefined) {
      params.push(`--camerafixed ${options.camerafixed}`);
    }
    if (options.watermark !== undefined) {
      params.push(`--watermark ${options.watermark}`);
    }

    if (!isSeedance2Model && params.length > 0) {
      promptText = `${promptText} ${params.join(" ")}`;
    }

    const content: any[] = [];
    const referenceVideos = this.normalizeManagedV2ReferenceVideos(options);
    const referenceAudios = this.normalizeManagedV2ReferenceAudios(options);

    if (promptText) {
      content.push({ type: "text", text: promptText });
    }

    // 处理参考图片：如果是 base64，先上传到 OSS；volc asset 对象在 sd2 时使用 asset:// 协议
    const { uploadedStringUrls, objectItems } = await this.splitAndUploadReferenceImages(options.referenceImages);

    for (const imageUrl of uploadedStringUrls) {
      content.push({
        type: "image_url",
        image_url: { url: imageUrl },
        role: "reference_image",
      });
      this.logger.log(`📸 Seedance 参考图片已处理: ${imageUrl.substring(0, 100)}...`);
    }

    for (const item of objectItems) {
      let url: string;
      if (isSeedance2Model && item.volcAssetStatus === "active" && item.volcAssetId) {
        url = `asset://${item.volcAssetId}`;
      } else {
        url = item.url;
      }
      content.push({
        type: "image_url",
        image_url: { url },
        role: "reference_image",
      });
      this.logger.log(`📸 Seedance 参考图片 (asset/url): ${url.substring(0, 100)}`);
    }

    for (const videoUrl of referenceVideos) {
      content.push({
        type: "video_url",
        video_url: { url: videoUrl },
        role: "reference_video",
      });
    }

    for (const audioUrl of referenceAudios) {
      content.push({
        type: "audio_url",
        audio_url: { url: audioUrl },
        role: "reference_audio",
      });
    }

    if (!content.length) {
      throw new BadRequestException("Seedance 需要提供提示词或至少一种参考素材");
    }

    const modelId = resolveSeedanceUpstreamModelId(modelVersion);

    const payload: Record<string, any> = {
      model: modelId,
      content,
    };

    if (isSeedance2Model) {
      if (typeof options.generateAudio === "boolean") {
        payload.generate_audio = options.generateAudio;
      }
      if (typeof options.videoMode === "string" && options.videoMode.trim()) {
        payload.video_mode = options.videoMode.trim();
      }
      if (typeof options.aspectRatio === "string" && options.aspectRatio.trim()) {
        payload.ratio = options.aspectRatio.trim();
      }
      if (typeof options.duration === "number" && Number.isFinite(options.duration)) {
        payload.duration = options.duration;
      }
      if (typeof options.resolution === "string" && options.resolution.trim()) {
        payload.resolution = options.resolution.trim().toUpperCase();
      }
      if (typeof options.watermark === "boolean") {
        payload.watermark = options.watermark;
      }
    }

    this.logProviderPayload("doubao", payload);

    const response = await fetchWithTimeout(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        timeout: DEFAULT_FETCH_TIMEOUT,
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.error?.message || error.message || `HTTP ${response.status}`
      );
    }

    const data = await response.json();
    return {
      taskId: data.id || data.platform_id,
      status: "queued",
    };
  }

  private async queryDoubao(taskId: string, apiKey: string) {
    const extractTokenUsage = (payload: any): { inputTokens?: number; outputTokens?: number } => {
      const usage = payload?.usage || payload?.token_usage || payload?.billing || payload?.meta?.usage || {};
      const inputCandidates = [
        usage?.input_tokens,
        usage?.prompt_tokens,
        usage?.in_tokens,
        payload?.input_tokens,
        payload?.prompt_tokens,
      ];
      const outputCandidates = [
        usage?.output_tokens,
        usage?.completion_tokens,
        usage?.out_tokens,
        payload?.output_tokens,
        payload?.completion_tokens,
      ];
      const input = inputCandidates
        .map((value) => Number(value))
        .find((value) => Number.isFinite(value) && value >= 0);
      const output = outputCandidates
        .map((value) => Number(value))
        .find((value) => Number.isFinite(value) && value >= 0);
      return {
        ...(typeof input === "number" ? { inputTokens: Math.floor(input) } : {}),
        ...(typeof output === "number" ? { outputTokens: Math.floor(output) } : {}),
      };
    };
    try {
      const response = await fetchWithTimeout(
        `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: QUERY_FETCH_TIMEOUT,
        }
      );

      const data = await response.json();
      this.logger.log(
        `🔍 Seedance 1.5 Pro任务状态查询: taskId=${taskId}, status=${data.status}`
      );

      if (data.status === "succeeded") {
        const upstreamUrl: string | undefined = data.content?.video_url;
        if (!upstreamUrl) {
          throw new ServiceUnavailableException("Seedance 返回空视频链接");
        }
        const tokenUsage = extractTokenUsage(data);
        if (this.isOssPublicUrl(upstreamUrl)) {
          return { status: "succeeded", videoUrl: upstreamUrl, ...tokenUsage };
        }
        const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, taskId);
        return { status: "succeeded", videoUrl: ossUrl, ...tokenUsage };
      }

      if (data.status === "failed") {
        this.logger.error(
          `❌ Seedance 1.5 Pro任务失败: taskId=${taskId}, error=${JSON.stringify(
            data.error || data.reason || data
          )}`
        );
        return {
          status: "failed",
          error: data.error?.message || data.reason || "生成失败",
        };
      }

      return { status: data.status || "queued" };
    } catch (error) {
      this.logger.error(
        `❌ Seedance 1.5 Pro查询异常: taskId=${taskId}, error=${
          error instanceof Error ? error.message : error
        }`
      );
      throw error;
    }
  }

  /**
   * 可灵 Kling 视频生成
   */
  private async generateKling(
    options: VideoProviderRequestDto,
    apiKey: string
  ): Promise<VideoGenerationResult> {
    let videoMode = options.videoMode;
    const imageCount = options.referenceImages?.length || 0;
    const hasPrompt = !!options.prompt;
    const KLING_DEFAULT_REFERENCE_PROMPT = "参考图片内容生成视频";

    if (!videoMode) {
      if (imageCount === 0) {
        videoMode = "text2video";
      } else if (imageCount === 1) {
        videoMode = "image2video";
      } else if (imageCount === 2) {
        videoMode = "image2video-tail";
      } else {
        videoMode = "multi-image2video";
      }
    }

    const endpointMap: Record<string, string> = {
      "image2video": "https://models.kapon.cloud/kling/v1/videos/image2video",
      "image2video-tail": "https://models.kapon.cloud/kling/v1/videos/image2video",
      "multi-image2video": "https://models.kapon.cloud/kling/v1/videos/multi-image2video",
      "text2video": "https://models.kapon.cloud/kling/v1/videos/text2video",
    };
    const endpoint = endpointMap[videoMode] || endpointMap["text2video"];

    const payload: any = {
      model_name: (options as any).klingModel || "kling-v2-6",
      mode: (options as any).mode || "std",
      duration: options.duration === 10 ? "10" : "5",
    };

    if (options.aspectRatio) {
      payload.aspect_ratio = options.aspectRatio;
    }

    if (videoMode === "text2video") {
      if (!options.prompt) {
        throw new Error("文生视频需要提供 prompt 参数");
      }
      payload.prompt = options.prompt;
    } else if (videoMode === "image2video") {
      const img0 = options.referenceImages![0];
      payload.image = await this.uploadBase64ImageToOSS(typeof img0 === "string" ? img0 : img0.url);
      if (options.prompt) {
        payload.prompt = options.prompt;
      }
    } else if (videoMode === "image2video-tail") {
      const img0 = options.referenceImages![0];
      const img1 = options.referenceImages![1];
      payload.image = await this.uploadBase64ImageToOSS(typeof img0 === "string" ? img0 : img0.url);
      payload.image_tail = await this.uploadBase64ImageToOSS(typeof img1 === "string" ? img1 : img1.url);
      payload.prompt = options.prompt || KLING_DEFAULT_REFERENCE_PROMPT;
    } else if (videoMode === "multi-image2video") {
      payload.model_name = "kling-v1-6";
      const imageUrls = await Promise.all(
        options.referenceImages!.slice(0, 4).map(img => this.uploadBase64ImageToOSS(typeof img === "string" ? img : img.url))
      );
      payload.image_list = imageUrls.map(url => ({ image: url }));
      payload.prompt = options.prompt || KLING_DEFAULT_REFERENCE_PROMPT;
    }

    this.logProviderPayload("kling", payload);
    this.logger.log(`🎬 Kling: mode=${videoMode}, images=${imageCount}, endpoint=${endpoint}`);

    let response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let textBody = await response.text().catch(() => "");
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => (headers[k] = v));

      this.logger.error(
        `❌ Kling 生成失败: HTTP ${response.status}, mode=${videoMode}, response_text=${textBody.slice(
          0,
          1000
        )}, headers=${JSON.stringify(headers)}`
      );

      const shouldRetryWithModelFallback =
        this.isModelNotSupportedError(textBody) &&
        payload.model_name === "kling-v2-1";

      if (shouldRetryWithModelFallback) {
        try {
          const fallbackPayload = { ...payload, model_name: "kling-v2-6" };
          this.logger.warn(
            `Kling model kling-v2-1 is not supported upstream, retrying with kling-v2-6: mode=${videoMode}`
          );
          this.logProviderPayload("kling-retry-model-fallback", fallbackPayload);
          response = await fetch(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(fallbackPayload),
          });
          if (response.ok) {
            const data = await response.json();
            return {
              taskId: data.data?.task_id,
              status: "queued",
            };
          }
          textBody = await response.text().catch(() => "");
          this.logger.error(
            `Kling model fallback retry failed: HTTP ${response.status}, mode=${videoMode}, response_text=${textBody.slice(
              0,
              1000
            )}`
          );
        } catch (retryError) {
          this.logger.error(
            `Kling model fallback retry exception: ${
              retryError instanceof Error ? retryError.message : String(retryError)
            }`
          );
        }
      }

      const shouldRetryWithDataUrl =
        this.isUpstreamImageFetchFailure(textBody) &&
        (videoMode === "image2video" ||
          videoMode === "image2video-tail" ||
          videoMode === "multi-image2video");

      if (shouldRetryWithDataUrl) {
        try {
          const retryPayload = await this.convertKlingPayloadImagesToDataUrl(payload);
          this.logger.warn(
            `Kling upstream failed to fetch image URL, retrying with data-url payload: mode=${videoMode}`
          );
          this.logProviderPayload("kling-retry-dataurl", retryPayload);
          response = await fetch(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(retryPayload),
          });
          if (response.ok) {
            const data = await response.json();
            return {
              taskId: data.data?.task_id,
              status: "queued",
            };
          }
          textBody = await response.text().catch(() => "");
          this.logger.error(
            `Kling data-url retry failed: HTTP ${response.status}, mode=${videoMode}, response_text=${textBody.slice(
              0,
              1000
            )}`
          );
        } catch (retryError) {
          this.logger.error(
            `Kling data-url retry exception: ${
              retryError instanceof Error ? retryError.message : String(retryError)
            }`
          );
        }
      }

      let error: any = {};
      if (textBody) {
        try {
          error = JSON.parse(textBody);
        } catch {
          error = {};
        }
      }
      throw new Error(
        error.error?.message ||
          error.message ||
          textBody ||
          `HTTP ${response.status}`
      );
    }

    const data = await response.json();
    return {
      taskId: data.data?.task_id,
      status: "queued",
    };
  }

  private async queryKling(taskId: string, apiKey: string) {
    try {
      // Kling 的查询路径在 Kapon 上区分不同模式
      // 依次尝试 text2video、image2video、multi-image2video 路径
      const endpoints = [
        `https://models.kapon.cloud/kling/v1/videos/text2video/${taskId}`,
        `https://models.kapon.cloud/kling/v1/videos/image2video/${taskId}`,
        `https://models.kapon.cloud/kling/v1/videos/multi-image2video/${taskId}`,
      ];

      let data: any = null;

      for (const endpoint of endpoints) {
        const response = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const result = await response.json().catch(() => ({}));

        // 如果获取到有效数据，使用该结果
        if (result.data && result.code === 0) {
          data = result;
          break;
        }
      }

      if (!data || !data.data) {
        throw new Error("无法查询到任务状态");
      }

      this.logger.log(
        `🔍 Kling 任务状态查询: taskId=${taskId}, status=${data.data?.task_status}`
      );

      if (data.data?.task_status === "succeed") {
        const upstreamUrl: string | undefined = data.data.task_result?.videos?.[0]?.url;
        if (!upstreamUrl) {
          throw new ServiceUnavailableException("Kling 返回空视频链接");
        }
        // 如果已经是 OSS URL，直接返回
        if (this.isOssPublicUrl(upstreamUrl)) {
          return { status: "succeeded", videoUrl: upstreamUrl };
        }
        // 上传到 OSS
        const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, `kling-${taskId}`);
        this.logger.log(`📤 Kling 视频已上传到 OSS: ${ossUrl}`);
        return { status: "succeeded", videoUrl: ossUrl };
      }

      if (data.data?.task_status === "failed") {
        this.logger.error(
          `❌ Kling 任务失败: taskId=${taskId}, error=${JSON.stringify(
            data.data.task_result || data
          )}`
        );
        return {
          status: "failed",
          error: data.data?.task_status_msg || "生成失败",
        };
      }

      return { status: data.data?.task_status || "processing" };
    } catch (error) {
      this.logger.error(
        `❌ Kling 查询异常: taskId=${taskId}, error=${
          error instanceof Error ? error.message : error
        }`
      );
      throw error;
    }
  }

  /**
   * 可灵 Kling 2.6 视频生成 (使用 kling-v2-6 模型)
   */
  private async generateKling26(
    options: VideoProviderRequestDto,
    apiKey: string
  ): Promise<VideoGenerationResult> {
    let videoMode = options.videoMode;
    const imageCount = options.referenceImages?.length || 0;
    const KLING_DEFAULT_REFERENCE_PROMPT = "参考图片内容生成视频";

    if (!videoMode) {
      if (imageCount === 0) {
        videoMode = "text2video";
      } else if (imageCount === 1) {
        videoMode = "image2video";
      } else if (imageCount === 2) {
        videoMode = "image2video-tail";
      } else {
        videoMode = "multi-image2video";
      }
    }

    const endpointMap: Record<string, string> = {
      "image2video": "https://models.kapon.cloud/kling/v1/videos/image2video",
      "image2video-tail": "https://models.kapon.cloud/kling/v1/videos/image2video",
      "multi-image2video": "https://models.kapon.cloud/kling/v1/videos/multi-image2video",
      "text2video": "https://models.kapon.cloud/kling/v1/videos/text2video",
    };
    const endpoint = endpointMap[videoMode] || endpointMap["text2video"];

    const mode = (options as any).mode || "std";
    const normalizedSound =
      typeof options.sound === "string" ? options.sound.trim().toLowerCase() : "";
    const payload: any = {
      model_name: (options as any).klingModel || "kling-v2-6",
      mode: mode,
      duration: Number(options.duration) === 10 ? "10" : "5",
    };

    if (normalizedSound === "on") {
      payload.sound = "on";
    } else if (normalizedSound === "off") {
      payload.sound = "off";
    } else if (mode === "pro") {
      payload.sound = "on";
    }
    if (typeof payload.sound === "string") {
      this.logger.log(`🎵 Kling 2.6 音频参数: sound=${payload.sound}`);
    }

    this.logger.log(`🎬 Kling 2.6 参数: duration=${options.duration}, 转换后=${Number(options.duration) === 10 ? "10" : "5"}`);

    if (options.aspectRatio) {
      payload.aspect_ratio = options.aspectRatio;
    }

    if (videoMode === "text2video") {
      if (!options.prompt) {
        throw new Error("文生视频需要提供 prompt 参数");
      }
      payload.prompt = options.prompt;
    } else if (videoMode === "image2video") {
      const img0 = options.referenceImages![0];
      payload.image = await this.uploadBase64ImageToOSS(typeof img0 === "string" ? img0 : img0.url);
      if (options.prompt) {
        payload.prompt = options.prompt;
      }
    } else if (videoMode === "image2video-tail") {
      const img0 = options.referenceImages![0];
      const img1 = options.referenceImages![1];
      payload.image = await this.uploadBase64ImageToOSS(typeof img0 === "string" ? img0 : img0.url);
      payload.image_tail = await this.uploadBase64ImageToOSS(typeof img1 === "string" ? img1 : img1.url);
      payload.prompt = options.prompt || KLING_DEFAULT_REFERENCE_PROMPT;
      // 首尾帧模式不支持音效，且 kling-v2-6/std 不支持 image_tail，必须用 pro
      payload.mode = "pro";
      payload.sound = "off";
    } else if (videoMode === "multi-image2video") {
      const imageUrls = await Promise.all(
        options.referenceImages!.slice(0, 4).map(img => this.uploadBase64ImageToOSS(typeof img === "string" ? img : img.url))
      );
      payload.image_list = imageUrls.map(url => ({ image: url }));
      payload.prompt = options.prompt || KLING_DEFAULT_REFERENCE_PROMPT;
    }

    this.logProviderPayload("kling-2.6", payload);
    this.logger.log(`🎬 Kling 2.6: mode=${videoMode}, images=${imageCount}, endpoint=${endpoint}`);

    let response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      timeout: DEFAULT_FETCH_TIMEOUT,
    });

    if (!response.ok) {
      let textBody = await response.text().catch(() => "");
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => (headers[k] = v));

      this.logger.error(
        `❌ Kling 2.6 生成失败: HTTP ${response.status}, mode=${videoMode}, response_text=${textBody.slice(
          0,
          1000
        )}, headers=${JSON.stringify(headers)}`
      );

      const shouldRetryWithDataUrl =
        this.isUpstreamImageFetchFailure(textBody) &&
        (videoMode === "image2video" ||
          videoMode === "image2video-tail" ||
          videoMode === "multi-image2video");

      if (shouldRetryWithDataUrl) {
        try {
          const retryPayload = await this.convertKlingPayloadImagesToDataUrl(payload);
          this.logger.warn(
            `Kling 2.6 upstream failed to fetch image URL, retrying with data-url payload: mode=${videoMode}`
          );
          this.logProviderPayload("kling-2.6-retry-dataurl", retryPayload);
          response = await fetchWithTimeout(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(retryPayload),
            timeout: DEFAULT_FETCH_TIMEOUT,
          });
          if (response.ok) {
            const data = await response.json();
            return {
              taskId: data.data?.task_id,
              status: "queued",
            };
          }
          textBody = await response.text().catch(() => "");
          this.logger.error(
            `Kling 2.6 data-url retry failed: HTTP ${response.status}, mode=${videoMode}, response_text=${textBody.slice(
              0,
              1000
            )}`
          );
        } catch (retryError) {
          this.logger.error(
            `Kling 2.6 data-url retry exception: ${
              retryError instanceof Error ? retryError.message : String(retryError)
            }`
          );
        }
      }

      let error: any = {};
      if (textBody) {
        try {
          error = JSON.parse(textBody);
        } catch {
          error = {};
        }
      }
      throw new Error(
        error.error?.message ||
          error.message ||
          textBody ||
          `HTTP ${response.status}`
      );
    }

    const data = await response.json();
    return {
      taskId: data.data?.task_id,
      status: "queued",
    };
  }

  private async queryKling26(taskId: string, apiKey: string) {
    try {
      const endpoints = [
        `https://models.kapon.cloud/kling/v1/videos/text2video/${taskId}`,
        `https://models.kapon.cloud/kling/v1/videos/image2video/${taskId}`,
        `https://models.kapon.cloud/kling/v1/videos/multi-image2video/${taskId}`,
      ];

      let data: any = null;

      for (const endpoint of endpoints) {
        const response = await fetchWithTimeout(endpoint, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: QUERY_FETCH_TIMEOUT,
        });
        const result = await response.json().catch(() => ({}));

        if (result.data && result.code === 0) {
          data = result;
          break;
        }
      }

      if (!data || !data.data) {
        throw new Error("无法查询到任务状态");
      }

      this.logger.log(
        `🔍 Kling 2.6 任务状态查询: taskId=${taskId}, status=${data.data?.task_status}`
      );

      if (data.data?.task_status === "succeed") {
        const upstreamUrl: string | undefined = data.data.task_result?.videos?.[0]?.url;
        if (!upstreamUrl) {
          throw new ServiceUnavailableException("Kling 2.6 返回空视频链接");
        }

        // 处理缩略图
        let thumbnailUrl: string | undefined;
        const upstreamThumbnail = data.data.task_result?.videos?.[0]?.cover_image_url;
        if (upstreamThumbnail) {
          if (this.isOssPublicUrl(upstreamThumbnail)) {
            thumbnailUrl = upstreamThumbnail;
          } else {
            try {
              thumbnailUrl = await this.uploadRemoteVideoToOss(upstreamThumbnail, `kling26-thumb-${taskId}`);
              this.logger.log(`📤 Kling 2.6 缩略图已上传到 OSS: ${thumbnailUrl}`);
            } catch (error) {
              this.logger.warn(`⚠️ Kling 2.6 缩略图上传失败: ${error}`);
            }
          }
        }

        if (this.isOssPublicUrl(upstreamUrl)) {
          return { status: "succeeded", videoUrl: upstreamUrl, thumbnailUrl };
        }
        const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, `kling26-${taskId}`);
        this.logger.log(`📤 Kling 2.6 视频已上传到 OSS: ${ossUrl}`);
        return { status: "succeeded", videoUrl: ossUrl, thumbnailUrl };
      }

      if (data.data?.task_status === "failed") {
        this.logger.error(
          `❌ Kling 2.6 任务失败: taskId=${taskId}, error=${JSON.stringify(
            data.data.task_result || data
          )}`
        );
        return {
          status: "failed",
          error: data.data?.task_status_msg || "生成失败",
        };
      }

      return { status: data.data?.task_status || "processing" };
    } catch (error) {
      // 超时或网络错误时，不抛异常，返回 processing 状态让前端继续轮询
      const isTimeout = error instanceof Error && error.message.includes('超时');
      this.logger.warn(
        `⚠️ Kling 2.6 查询${isTimeout ? '超时' : '异常'}: taskId=${taskId}, error=${
          error instanceof Error ? error.message : error
        }，将继续轮询`
      );
      // 返回 processing 状态，让前端继续轮询而不是报错
      return { status: "processing" };
    }
  }

  /**
   * Vidu 视频生成
   */
  private async generateVidu(
    options: VideoProviderRequestDto,
    apiKey: string
  ): Promise<VideoGenerationResult> {
    const preparedReferenceImages = await this.prepareViduReferenceImages(
      options.referenceImages
    );

    // 确定视频生成模式（智能判断）
    let videoMode = options.videoMode;
    const imageCount = preparedReferenceImages.length;
    const hasPrompt = !!options.prompt;

    // 如果没有指定模式，根据图片数量和是否有prompt智能判断
    if (!videoMode) {
      if (imageCount === 0) {
        // 0张图：文生视频
        videoMode = "text2video";
      } else if (imageCount === 1) {
        // 1张图：有prompt用参考生视频，无prompt用图生视频
        videoMode = hasPrompt ? "reference2video" : "img2video";
      } else if (imageCount === 2) {
        // 2张图：有prompt用参考生视频，无prompt用首尾帧
        videoMode = hasPrompt ? "reference2video" : "start-end2video";
      } else {
        // 3+张图：参考生视频
        videoMode = "reference2video";
      }
    }

    const endpointMap: Record<string, string> = {
      "img2video": "https://models.kapon.cloud/vidu/ent/v2/img2video",
      "start-end2video": "https://models.kapon.cloud/vidu/ent/v2/start-end2video",
      "reference2video": "https://models.kapon.cloud/vidu/ent/v2/reference2video",
      "text2video": "https://models.kapon.cloud/vidu/ent/v2/text2video",
    };
    const endpoint = endpointMap[videoMode] || endpointMap["text2video"];
    const payload: any = {};

    if (videoMode === "text2video") {
      if (!options.prompt) {
        throw new Error("文生视频模式需要提供 prompt 参数");
      }
      payload.model = "viduq2";
      payload.prompt = options.prompt;
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
      payload.style = options.style || "general";
      payload.off_peak = options.offPeak || false;
    } else if (videoMode === "img2video") {
      payload.model = "viduq2";
      payload.images = [preparedReferenceImages[0]];
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
      payload.aspect_ratio = options.aspectRatio || "16:9";
      payload.off_peak = options.offPeak || false;
    } else if (videoMode === "start-end2video") {
      payload.model = "viduq2";
      payload.images = [preparedReferenceImages[0], preparedReferenceImages[1]];
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
      payload.aspect_ratio = options.aspectRatio || "16:9";
    } else if (videoMode === "reference2video") {
      if (!options.prompt) {
        throw new Error("参考生视频模式需要提供 prompt 参数");
      }
      payload.model = "viduq2";
      payload.images = preparedReferenceImages.slice(0, 7);
      payload.prompt = options.prompt;
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
    }

    payload.aspect_ratio = options.aspectRatio || "16:9";

    this.logProviderPayload("vidu", payload);
    this.logger.log(
      `🎬 Vidu: mode=${videoMode}, images=${imageCount}, hosts=${this.summarizeImageHosts(
        preparedReferenceImages
      )}, endpoint=${endpoint}`
    );

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      this.logger.error(
        `❌ Vidu 生成失败: HTTP ${response.status}, error=${JSON.stringify(
          error
        )}`
      );
      throw new Error(
        error.error?.message || error.message || `HTTP ${response.status}`
      );
    }

    const data = await response.json();
    return {
      taskId: data.task_id || data.id,
      status: "queued",
    };
  }

  private async queryVidu(taskId: string, apiKey: string) {
    try {
      const response = await fetch(
        `https://models.kapon.cloud/vidu/ent/v2/tasks/${taskId}/creations`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );
      const data = await response.json();

      this.logger.log(
        `🔍 Vidu 任务状态查询: taskId=${taskId}, state=${data.state}`
      );

      if (data.state === "success") {
        const upstreamUrl: string | undefined = data.creations?.[0]?.url;
        if (!upstreamUrl) {
          throw new ServiceUnavailableException("Vidu 返回空视频链接");
        }
        // 如果已经是 OSS URL，直接返回
        if (this.isOssPublicUrl(upstreamUrl)) {
          return { status: "succeeded", videoUrl: upstreamUrl };
        }
        // 上传到 OSS
        const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, `vidu-${taskId}`);
        this.logger.log(`📤 Vidu 视频已上传到 OSS: ${ossUrl}`);
        return { status: "succeeded", videoUrl: ossUrl };
      }

      if (data.state === "failed") {
        this.logger.error(
          `❌ Vidu 任务失败: taskId=${taskId}, error=${JSON.stringify(
            data.error || data
          )}`
        );
        return {
          status: "failed",
          error: data.error?.message || "生成失败",
        };
      }

      return { status: data.state || "processing" };
    } catch (error) {
      this.logger.error(
        `❌ Vidu 查询异常: taskId=${taskId}, error=${
          error instanceof Error ? error.message : error
        }`
      );
      throw error;
    }
  }

  /**
   * 可灵 Kling O1 (Omni Video) 视频生成
   * 支持：文生视频、图片参考、首尾帧、视频编辑
   */
  private async generateKlingO1(
    options: VideoProviderRequestDto,
    apiKey: string
  ): Promise<VideoGenerationResult> {
    const endpoint = "https://models.kapon.cloud/kling/v1/videos/omni-video";
    const imageCount = options.referenceImages?.length || 0;
    const hasVideo =
      typeof options.referenceVideo === "string" &&
      options.referenceVideo.trim().length > 0;
    const normalizedReferenceVideo = hasVideo
      ? this.normalizeManagedAssetUrlForUpstream(options.referenceVideo!)
      : undefined;

    const payload: any = {
      model_name: "kling-v3-omni",
      mode: options.mode || "std",
    };

    const normalizedSound =
      typeof options.sound === "string" ? options.sound.trim().toLowerCase() : "";
    if (normalizedSound === "on") {
      payload.sound = "on";
    } else if (normalizedSound === "off") {
      payload.sound = "off";
    } else if ((options.mode || "std") === "pro") {
      payload.sound = "on";
    }

    // 处理 prompt（Kling O1 要求 prompt 必填）
    if (options.prompt) {
      payload.prompt = options.prompt;
    } else if (imageCount > 0) {
      // 有图片但没有 prompt，使用默认描述
      payload.prompt = "根据参考图片生成视频";
    } else {
      // 既没有图片也没有 prompt，使用通用默认值
      payload.prompt = "生成视频";
    }

    // 处理时长 (3-10秒)
    if (options.duration) {
      const dur = Math.max(3, Math.min(10, options.duration));
      payload.duration = String(dur);
    } else {
      payload.duration = "5";
    }

    // 处理画面比例
    // Kling O1 要求：没有首帧图片且不是视频编辑模式时必须指定 aspect_ratio
    const isVideoEdit = hasVideo && options.referenceVideoType === "base";
    const hasFirstFrame = imageCount > 0 && !hasVideo; // 只有无视频时才会设置首帧

    if (options.aspectRatio) {
      payload.aspect_ratio = options.aspectRatio;
    } else if (!hasFirstFrame && !isVideoEdit) {
      // 没有首帧且不是视频编辑模式，默认 16:9
      payload.aspect_ratio = "16:9";
    }

    // 处理图片列表
    if (imageCount > 0) {
      const imageList: any[] = [];
      for (let i = 0; i < Math.min(imageCount, 7); i++) {
        const imgRaw = options.referenceImages![i];
        const imgUrl = await this.uploadBase64ImageToOSS(typeof imgRaw === "string" ? imgRaw : imgRaw.url);
        const imgItem: any = { image_url: imgUrl };
        // 只有在无视频输入时，才可以设置首尾帧
        if (!hasVideo) {
          if (i === 0 && imageCount >= 1) {
            imgItem.type = "first_frame";
          } else if (i === 1 && imageCount === 2) {
            imgItem.type = "end_frame";
          }
        }
        imageList.push(imgItem);
      }
      payload.image_list = imageList;
    }

    // 处理参考视频
    if (hasVideo) {
      payload.video_list = [{
        video_url: normalizedReferenceVideo,
        refer_type: options.referenceVideoType || "feature",
        keep_original_sound: options.keepOriginalSound || "no",
      }];
    }

    this.logProviderPayload("kling-o3", payload);
    this.logger.log(`🎬 Kling O1: images=${imageCount}, hasVideo=${hasVideo}, endpoint=${endpoint}`);

    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      timeout: DEFAULT_FETCH_TIMEOUT,
    });

    if (!response.ok) {
      const textBody = await response.text().catch(() => "");
      this.logger.error(
        `❌ Kling O1 生成失败: HTTP ${response.status}, response_text=${textBody.slice(0, 1000)}`
      );
      let error: any = {};
      if (textBody) {
        try {
          error = JSON.parse(textBody);
        } catch {}
      }
      throw new Error(
        error.error?.message || error.message || textBody || `HTTP ${response.status}`
      );
    }

    const data = await response.json();
    return {
      taskId: data.data?.task_id,
      status: "queued",
    };
  }

  private async queryKlingO1(taskId: string, apiKey: string) {
    try {
      const endpoint = `https://models.kapon.cloud/kling/v1/videos/omni-video/${taskId}`;
      const response = await fetchWithTimeout(endpoint, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: QUERY_FETCH_TIMEOUT,
      });
      const data = await response.json();

      this.logger.log(
        `🔍 Kling O1 任务状态查询: taskId=${taskId}, status=${data.data?.task_status}`
      );

      if (data.data?.task_status === "succeed") {
        const upstreamUrl: string | undefined = data.data.task_result?.videos?.[0]?.url;
        if (!upstreamUrl) {
          throw new ServiceUnavailableException("Kling O1 返回空视频链接");
        }
        if (this.isOssPublicUrl(upstreamUrl)) {
          return { status: "succeeded", videoUrl: upstreamUrl };
        }
        const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, `kling-o3-${taskId}`);
        this.logger.log(`📤 Kling O1 视频已上传到 OSS: ${ossUrl}`);
        return { status: "succeeded", videoUrl: ossUrl };
      }

      if (data.data?.task_status === "failed") {
        this.logger.error(
          `❌ Kling O1 任务失败: taskId=${taskId}, error=${JSON.stringify(
            data.data.task_result || data
          )}`
        );
        return {
          status: "failed",
          error: data.data?.task_status_msg || "生成失败",
        };
      }

      return { status: data.data?.task_status || "processing" };
    } catch (error) {
      // 超时或网络错误时，不抛异常，返回 processing 状态让前端继续轮询
      const isTimeout = error instanceof Error && error.message.includes('超时');
      this.logger.warn(
        `⚠️ Kling O1 查询${isTimeout ? '超时' : '异常'}: taskId=${taskId}, error=${
          error instanceof Error ? error.message : error
        }，将继续轮询`
      );
      // 返回 processing 状态，让前端继续轮询而不是报错
      return { status: "processing" };
    }
  }

  /**
   * Vidu Q3 Pro 视频生成
   */
  private async generateViduQ3Pro(
    options: VideoProviderRequestDto,
    apiKey: string
  ): Promise<VideoGenerationResult> {
    const preparedReferenceImages = await this.prepareViduReferenceImages(
      options.referenceImages
    );

    // 确定视频生成模式
    let videoMode = options.videoMode;
    const imageCount = preparedReferenceImages.length;
    const hasPrompt = !!options.prompt;

    // 智能判断模式
    if (!videoMode) {
      if (imageCount === 0) {
        videoMode = "text2video";
      } else if (imageCount === 1) {
        videoMode = hasPrompt ? "reference2video" : "img2video";
      } else if (imageCount === 2) {
        videoMode = hasPrompt ? "reference2video" : "start-end2video";
      } else if (imageCount === 3) {
        videoMode = "start-mid-end2video";
      } else {
        throw new Error("viduq3-pro 最多支持3张图片");
      }
    }

    const endpointMap: Record<string, string> = {
      "img2video": "https://models.kapon.cloud/vidu/ent/v2/img2video",
      "start-end2video": "https://models.kapon.cloud/vidu/ent/v2/start-end2video",
      "start-mid-end2video": "https://models.kapon.cloud/vidu/ent/v2/start-mid-end2video",
      "reference2video": "https://models.kapon.cloud/vidu/ent/v2/reference2video",
      "text2video": "https://models.kapon.cloud/vidu/ent/v2/text2video",
    };
    const endpoint = endpointMap[videoMode] || endpointMap["text2video"];
    const payload: any = {};

    if (videoMode === "text2video") {
      if (!options.prompt) {
        throw new Error("文生视频模式需要提供 prompt 参数");
      }
      payload.model = "viduq3-pro";
      payload.prompt = options.prompt;
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
      payload.style = options.style || "general";
    } else if (videoMode === "img2video") {
      payload.model = "viduq3-pro";
      payload.images = [preparedReferenceImages[0]];
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
      payload.aspect_ratio = options.aspectRatio || "16:9";
    } else if (videoMode === "start-end2video") {
      payload.model = "viduq3-pro";
      payload.images = [preparedReferenceImages[0], preparedReferenceImages[1]];
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
      payload.aspect_ratio = options.aspectRatio || "16:9";
    } else if (videoMode === "start-mid-end2video") {
      payload.model = "viduq3-pro";
      payload.images = [
        preparedReferenceImages[0],
        preparedReferenceImages[1],
        preparedReferenceImages[2],
      ];
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
      payload.aspect_ratio = options.aspectRatio || "16:9";
    } else if (videoMode === "reference2video") {
      if (!options.prompt) {
        throw new Error("参考生视频模式需要提供 prompt 参数");
      }
      payload.model = "viduq3-pro";
      payload.images = preparedReferenceImages.slice(0, 7);
      payload.prompt = options.prompt;
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
    }

    payload.aspect_ratio = options.aspectRatio || "16:9";

    this.logProviderPayload("viduq3-pro", payload);
    this.logger.log(
      `🎬 Vidu Q3 Pro: mode=${videoMode}, images=${imageCount}, hosts=${this.summarizeImageHosts(
        preparedReferenceImages
      )}, endpoint=${endpoint}`
    );

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Vidu Q3 Pro API 错误: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    this.logger.log(`✅ Vidu Q3 Pro 任务创建成功: taskId=${data.id}`);

    return {
      taskId: data.id,
      status: "queued",
    };
  }

  /**
   * Vidu Q3 Pro 任务查询
   */
  private async queryViduQ3Pro(taskId: string, apiKey: string) {
    try {
      const response = await fetch(
        `https://models.kapon.cloud/vidu/ent/v2/tasks/${taskId}/creations`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );
      const data = await response.json();

      this.logger.log(
        `🔍 Vidu Q3 Pro 任务状态查询: taskId=${taskId}, state=${data.state}`
      );

      if (data.state === "success") {
        const upstreamUrl: string | undefined = data.creations?.[0]?.url;
        if (!upstreamUrl) {
          throw new ServiceUnavailableException("Vidu Q3 Pro 返回空视频链接");
        }
        if (this.isOssPublicUrl(upstreamUrl)) {
          return { status: "succeeded", videoUrl: upstreamUrl };
        }
        const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, `viduq3-pro-${taskId}`);
        this.logger.log(`📤 Vidu Q3 Pro 视频已上传到 OSS: ${ossUrl}`);
        return { status: "succeeded", videoUrl: ossUrl };
      }

      if (data.state === "failed") {
        this.logger.error(
          `❌ Vidu Q3 Pro 任务失败: taskId=${taskId}, error=${JSON.stringify(
            data.error || data
          )}`
        );
        return {
          status: "failed",
          error: data.error?.message || "生成失败",
        };
      }

      return { status: data.state === "processing" ? "processing" : "queued" };
    } catch (error) {
      this.logger.warn(
        `⚠️ Vidu Q3 Pro 查询异常: taskId=${taskId}, error=${
          error instanceof Error ? error.message : error
        }，将继续轮询`
      );
      return { status: "processing" };
    }
  }
}
