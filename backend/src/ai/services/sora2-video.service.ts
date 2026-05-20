import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ModelRoutingService } from "./model-routing.service";
import { TencentVodAigcService } from "./tencent-vod-aigc.service";

type VideoQuality = "hd" | "sd";
type Sora2GenerationModel = "sora-2" | "sora-2-vip" | "sora-2-pro";

// ==================== 旧API (普通Sora2) 配置 ====================
const SORA2_VIDEO_MODELS: Record<VideoQuality, string> = {
  hd: process.env.SORA2_HD_MODEL || "sora-2-pro-reverse",
  sd: process.env.SORA2_SD_MODEL || "sora-2-reverse",
};

const SORA2_FAILED_STATUSES = ["failed", "error", "blocked", "terminated"];
const SORA2_VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".webm", ".mkv"];
const SORA2_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const SORA2_ASYNC_HOST_HINTS = ["asyncdata.", "asyncndata."];
const SORA2_MAX_FOLLOW_DEPTH = 2;
const SORA2_FETCH_TIMEOUT_MS = 120000;
const SORA2_MAX_RETRY = 3;
const SORA2_RETRY_BASE_DELAY_MS = 1200;
const SORA2_POLL_INTERVAL_MS = 5000;
const SORA2_POLL_MAX_ATTEMPTS = 120;
const SORA2_POLL_STATUSES = ["queued", "processing", "downloading", "pending"];
const SORA2_TENCENT_TASK_PREFIX = "tencentvod-sora2-";

// ==================== 新API (Sora2 Pro - newapi.megabyai.cc) 配置 ====================
// 使用 OpenAI 兼容接口 /v1/videos
const SORA2_V2_POLL_INTERVAL_MS = 5000;
const SORA2_V2_POLL_MAX_ATTEMPTS = 180; // 增加到180次，约15分钟
const SORA2_V2_FAILED_STATUSES = ["failed", "error", "cancelled", "FAILURE"];
const SORA2_V2_FETCH_TIMEOUT_MS = 180000; // 增加到3分钟

// Sora2 Pro 模型选择（根据质量和是否图生视频）
const getSora2ProModel = (quality: "standard" | "hd", isImageToVideo: boolean): string => {
  // 根据文档，模型名称为:
  // - sora-2-text-to-video (标准文生视频)
  // - sora-2-pro-text-to-video (Pro文生视频)
  // - sora-2-image-to-video (标准图生视频)
  // - sora-2-pro-image-to-video (Pro图生视频)

  // hd 质量使用 pro 模型，sd 质量使用标准模型
  if (quality === "hd") {
    return isImageToVideo ? "sora-2-pro-image-to-video" : "sora-2-pro-text-to-video";
  }
  return isImageToVideo ? "sora-2-image-to-video" : "sora-2-text-to-video";
};

interface Sora2ResolvedMedia {
  videoUrl?: string;
  thumbnailUrl?: string;
  referencedUrls: string[];
  taskInfo?: Record<string, any> | null;
  taskId?: string;
  status?: string;
  errorMessage?: string;
}

interface GenerateVideoOptions {
  prompt: string;
  referenceImageUrls?: string[];
  quality?: VideoQuality;
  /** APIMart 模型 */
  model?: Sora2GenerationModel;
  /** 画面比例，仅极速 Sora2 支持，例如 '16:9' | '9:16' */
  aspectRatio?: "16:9" | "9:16";
  /** 时长（秒），仅极速 Sora2 支持，例如 '10' | '15' | '25' */
  duration?: "10" | "15" | "25";
  /** APIMart 可选高级参数 */
  watermark?: boolean;
  thumbnail?: boolean;
  privateMode?: boolean;
  style?: string;
  storyboard?: boolean;
  characterUrl?: string;
  characterTimestamps?: string;
  characterTaskId?: string;
}

interface CreateCharacterTaskOptions {
  model?: "sora-2" | "sora-2-pro";
  timestamps: string;
  url?: string;
  fromTask?: string;
}

export interface Sora2VideoTaskQueryResult {
  id: string;
  status: string;
  progress?: number;
  videoUrl?: string;
  thumbnailUrl?: string;
  raw?: Record<string, any>;
}

type Sora2CharacterInfo = {
  id?: string;
  display_name?: string;
  profile_picture_url?: string;
  username?: string;
};

interface Sora2CharacterTaskResult {
  id?: string;
  status?: string;
  progress?: number;
  result?: {
    characters?: Sora2CharacterInfo[];
    [key: string]: any;
  };
  [key: string]: any;
}

export interface Sora2VideoResult {
  videoUrl: string;
  content: string;
  thumbnailUrl?: string;
  referencedUrls: string[];
  status?: string;
  taskId?: string;
  taskInfo?: Record<string, any> | null;
  videoUrlWatermarked?: string;
  videoUrlRaw?: string;
  watermarkSkipped?: boolean;
  watermarkFailed?: boolean;
  /** 备选方案提示信息 */
  fallbackMessage?: string;
}

@Injectable()
export class Sora2VideoService {
  private readonly logger = new Logger(Sora2VideoService.name);
  private readonly apiBaseV2 =
    (process.env.NEW_API_BASE_URL || "http://localhost:4458").replace(/\/+$/, "");
  private readonly apiKeyV2 = process.env.NEW_API_KEY;

  constructor(
    private readonly modelRoutingService: ModelRoutingService,
    private readonly tencentVodAigcService: TencentVodAigcService,
  ) {}

  /**
   * 主入口方法：优先遵循模型管理路由，其余 legacy 路径走默认自动回退策略
   */
  async generateVideo(
    options: GenerateVideoOptions
  ): Promise<Sora2VideoResult> {
    if (!this.apiKeyV2) {
      throw new ServiceUnavailableException("NEW_API_KEY 未配置");
    }

    this.logger.log(`Sora2 单轨 new-api 路由: ${this.apiBaseV2}`);
    return this.generateVideoV2(options);
  }

  async createCharacterTask(options: CreateCharacterTaskOptions) {
    if (!this.apiKeyV2) {
      throw new ServiceUnavailableException("NEW_API_KEY 未配置");
    }
    if (!options.url && !options.fromTask) {
      throw new BadRequestException("参数 url 和 fromTask 需二选一");
    }

    const payload: Record<string, any> = {
      model: options.model || "sora-2",
      timestamps: options.timestamps,
    };
    if (options.url) payload.url = options.url;
    if (options.fromTask) payload.from_task = options.fromTask;

    const response = await fetch(`${this.apiBaseV2}/v1/characters_tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKeyV2}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        data?.error?.message || data?.message || `HTTP ${response.status}`;
      throw new ServiceUnavailableException(`创建角色失败: ${message}`);
    }

    const taskId =
      data?.data?.[0]?.task_id ||
      data?.data?.task_id ||
      data?.task_id ||
      data?.id;
    if (!taskId) {
      throw new ServiceUnavailableException("创建角色失败：未返回任务ID");
    }

    return {
      success: true,
      taskId,
      status: data?.data?.[0]?.status || data?.status || "submitted",
      raw: data,
    };
  }

  async queryCharacterTask(taskId: string) {
    if (!this.apiKeyV2) {
      throw new ServiceUnavailableException("NEW_API_KEY 未配置");
    }
    const response = await fetch(
      `${this.apiBaseV2}/v1/characters_tasks/${encodeURIComponent(taskId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKeyV2}`,
        },
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        data?.error?.message || data?.message || `HTTP ${response.status}`;
      throw new ServiceUnavailableException(`查询角色失败: ${message}`);
    }

    const payload: Sora2CharacterTaskResult = data?.data || data || {};
    const chars = Array.isArray(payload?.result?.characters)
      ? payload.result?.characters
      : [];

    return {
      id: payload?.id || taskId,
      status: payload?.status || "unknown",
      progress: typeof payload?.progress === "number" ? payload.progress : undefined,
      characters: chars.map((item) => ({
        id: item?.id,
        displayName: item?.display_name,
        username: item?.username,
        profilePictureUrl: item?.profile_picture_url,
      })),
      raw: data,
    };
  }

  async queryVideoTask(taskId: string): Promise<Sora2VideoTaskQueryResult> {
    if (taskId?.startsWith(SORA2_TENCENT_TASK_PREFIX)) {
      return this.queryTencentVideoTask(taskId);
    }

    if (!this.apiKeyV2) {
      throw new ServiceUnavailableException("NEW_API_KEY 未配置");
    }
    if (!taskId || !taskId.trim()) {
      throw new BadRequestException("taskId 不能为空");
    }

    // Poll new-api's OpenAI-Video endpoint; new-api fetches upstream status internally.
    const response = await fetch(
      `${this.apiBaseV2}/v1/videos/${encodeURIComponent(taskId.trim())}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKeyV2}`,
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      }
    );

    const dataRaw = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        dataRaw?.error?.message || dataRaw?.message || `HTTP ${response.status}`;
      throw new ServiceUnavailableException(`查询视频任务失败: ${message}`);
    }

    // new-api returns OpenAI Video format: { id, status, progress, metadata:{url,thumbnail_url} }
    const statusRaw = String(dataRaw?.status || "unknown");
    const progress =
      typeof dataRaw?.progress === "number" ? dataRaw.progress : undefined;
    const videoUrl: string | undefined = dataRaw?.metadata?.url;
    const thumbnailUrl: string | undefined = dataRaw?.metadata?.thumbnail_url;

    return {
      id: String(dataRaw?.id || dataRaw?.task_id || taskId.trim()),
      status: statusRaw,
      progress,
      videoUrl,
      thumbnailUrl,
      raw: dataRaw,
    };
  }

  private async waitForTencentVideoResult(taskId: string): Promise<{
    status: string;
    videoUrl?: string;
    raw?: Record<string, any>;
  }> {
    let lastStatus = "processing";
    let lastRaw: Record<string, any> | undefined;

    await this.delay(5000);
    for (let attempt = 1; attempt <= 120; attempt++) {
      const result = await this.tencentVodAigcService.queryVideoTask(taskId);
      lastStatus = String(result.status || "processing");
      lastRaw = result.raw;
      const normalized = this.normalizeTencentStatus(lastStatus);

      if (normalized === "success") {
        if (result.videoUrl) {
          return {
            status: lastStatus,
            videoUrl: result.videoUrl,
            raw: result.raw,
          };
        }
      }

      if (normalized === "failed") {
        throw new ServiceUnavailableException(
          `腾讯 VOD Sora2 任务失败: ${lastStatus}`
        );
      }

      await this.delay(3000);
    }

    throw new ServiceUnavailableException(
      `腾讯 VOD Sora2 轮询超时，最后状态: ${lastStatus}`
    );
  }

  private async queryTencentVideoTask(taskId: string): Promise<Sora2VideoTaskQueryResult> {
    const rawTaskId = taskId.slice(SORA2_TENCENT_TASK_PREFIX.length).trim();
    if (!rawTaskId) {
      throw new BadRequestException("taskId 不能为空");
    }

    const result = await this.tencentVodAigcService.queryVideoTask(rawTaskId);
    const normalized = this.normalizeTencentStatus(result.status);
    if (normalized === "success" && result.videoUrl) {
      return {
        id: taskId,
        status: "completed",
        progress: 100,
        videoUrl: result.videoUrl,
        raw: result.raw,
      };
    }

    if (normalized === "failed") {
      return {
        id: taskId,
        status: "failed",
        raw: result.raw,
      };
    }

    return {
      id: taskId,
      status: "processing",
      progress: 50,
      raw: result.raw,
    };
  }

  private normalizeTencentStatus(status?: string): "processing" | "success" | "failed" {
    const value = String(status || "").trim().toLowerCase();
    if (
      [
        "finish",
        "finished",
        "success",
        "succeed",
        "succeeded",
        "completed",
        "complete",
        "done",
      ].includes(value)
    ) {
      return "success";
    }

    if (["failed", "fail", "error", "cancelled", "timeout", "exception"].includes(value)) {
      return "failed";
    }

    return "processing";
  }

  private normalizeApimartTaskPayload(
    payload: any,
    taskId?: string
  ): Record<string, any> {
    if (!payload || typeof payload !== "object") {
      return {};
    }

    const root = payload as Record<string, any>;
    const raw = root.data ?? root;

    if (Array.isArray(raw)) {
      const objects = raw.filter(
        (item): item is Record<string, any> =>
          !!item && typeof item === "object" && !Array.isArray(item)
      );

      const matched =
        taskId &&
        objects.find((item) => {
          const candidate =
            item.task_id ?? item.taskId ?? item.id ?? item.video_id ?? item.job_id;
          if (candidate === undefined || candidate === null) return false;
          return String(candidate) === taskId;
        });

      const selected = matched || objects[0];
      const normalizedRoot = root.data === raw ? { ...root, data: raw } : { ...root };
      return selected ? { ...normalizedRoot, ...selected } : normalizedRoot;
    }

    if (raw && typeof raw === "object") {
      const rawObj = raw as Record<string, any>;
      if (rawObj === root) return rawObj;
      return { ...root, ...rawObj };
    }

    return root;
  }

  private extractApimartMedia(data: any): {
    videoUrl?: string;
    thumbnailUrl?: string;
  } {
    if (!data) return {};
    const pickUrl = (candidates: unknown[]): string | undefined => {
      for (const item of candidates) {
        if (typeof item === "string" && item.startsWith("http")) return item;
        if (Array.isArray(item)) {
          const first = item
            .map((entry) => {
              if (typeof entry === "string" && entry.startsWith("http")) return entry;
              if (entry && typeof entry === "object") {
                const obj = entry as Record<string, any>;
                return (
                  (typeof obj.url === "string" && obj.url.startsWith("http") && obj.url) ||
                  (typeof obj.video_url === "string" &&
                    obj.video_url.startsWith("http") &&
                    obj.video_url) ||
                  (typeof obj.thumbnail_url === "string" &&
                    obj.thumbnail_url.startsWith("http") &&
                    obj.thumbnail_url) ||
                  undefined
                );
              }
              return undefined;
            })
            .find((value) => typeof value === "string");
          if (first) return first;
        }
      }
      return undefined;
    };

    const resultObj = data?.result || {};
    let videoUrl = pickUrl([
      data?.video_url,
      data?.video,
      data?.videoUrl,
      data?.url,
      data?.download_url,
      data?.file_url,
      data?.output,
      data?.outputs,
      data?.videos,
      resultObj?.video_url,
      resultObj?.video,
      resultObj?.videoUrl,
      resultObj?.url,
      resultObj?.download_url,
      resultObj?.file_url,
      resultObj?.output,
      resultObj?.outputs,
      resultObj?.videos,
      data?.resource_url,
      data?.resource?.url,
      resultObj?.resource_url,
      resultObj?.resource?.url,
    ]);

    let thumbnailUrl = pickUrl([
      data?.thumbnail_url,
      data?.thumbnail,
      data?.thumbnailUrl,
      resultObj?.thumbnail_url,
      resultObj?.thumbnail,
      resultObj?.thumbnailUrl,
      resultObj?.cover_url,
      data?.cover_url,
      resultObj?.poster_url,
      data?.poster_url,
    ]);

    // Fallback: recursively scan all URLs and infer media type by key/path.
    if (!videoUrl || !thumbnailUrl) {
      const discovered: Array<{ url: string; path: string }> = [];
      const visit = (value: unknown, path: string) => {
        if (!value) return;
        if (typeof value === "string") {
          if (value.startsWith("http")) {
            discovered.push({ url: value, path: path.toLowerCase() });
          }
          return;
        }
        if (Array.isArray(value)) {
          value.forEach((item, index) => visit(item, `${path}[${index}]`));
          return;
        }
        if (typeof value === "object") {
          Object.entries(value as Record<string, unknown>).forEach(([key, item]) =>
            visit(item, path ? `${path}.${key}` : key)
          );
        }
      };
      visit(data, "");

      if (!thumbnailUrl) {
        thumbnailUrl = discovered.find((item) => {
          const p = item.path;
          return (
            /(thumb|thumbnail|cover|poster|preview|snapshot|image)/i.test(p) ||
            this.isLikelyImageUrl(item.url)
          );
        })?.url;
      }

      if (!videoUrl) {
        videoUrl =
          discovered.find((item) => {
            const p = item.path;
            return /(video|resource|output|download|file|result)/i.test(p) && !this.isLikelyImageUrl(item.url);
          })?.url ||
          discovered.find((item) => this.isLikelyVideoUrl(item.url))?.url ||
          discovered.find((item) => !this.isLikelyImageUrl(item.url))?.url;
      }
    }

    return { videoUrl, thumbnailUrl };
  }

  /**
   * Sora2 Pro (新API - newapi.megabyai.cc)
   * 使用 OpenAI 兼容接口 /v1/videos
   */
  private async generateVideoV2(
    options: GenerateVideoOptions
  ): Promise<Sora2VideoResult> {
    const startedAt = Date.now();

    // 判断是否为图生视频
    const isImageToVideo =
      options.referenceImageUrls && options.referenceImageUrls.length > 0;

    // 根据参数选择模型
    const duration = options.duration || "10";
    const orientation = options.aspectRatio === "9:16" ? "portrait" : "landscape";
    const qualityLevel = options.quality === "hd" ? "hd" : "standard";

    const model = options.model === "sora-2" ? "sora-2" : "sora-2-pro";

    this.logger.log(
      `Sora2 Pro 视频生成开始 (model=${model}, duration=${duration}, orientation=${orientation}, quality=${qualityLevel}, isImageToVideo=${!!isImageToVideo})`
    );

    // 根据文档构建请求体
    // 文生视频: { model, prompt, duration, size }
    // 图生视频: { model, prompt, images, duration, size, metadata }
    const size = orientation === "portrait" ? "720x1280" : "1280x720";

    const createPayload: Record<string, any> = {
      model,
      prompt: options.prompt,
      duration: Number(duration),
      size,
    };

    this.logger.log(`Sora2 Pro 完整请求体: ${JSON.stringify(createPayload)}`);

    // 图生视频：添加 images 数组
    if (isImageToVideo) {
      const images = options.referenceImageUrls!.filter(
        (url) => typeof url === "string" && url.trim().length > 0
      );
      if (images.length > 0) {
        createPayload.images = images;
        createPayload.metadata = {
          aspect_ratio: orientation,
          remove_watermark: true,
        };
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      SORA2_V2_FETCH_TIMEOUT_MS
    );

    let taskId: string;
    try {
      const createResponse = await fetch(
        `${this.apiBaseV2}/v1/videos`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKeyV2}`,
          },
          body: JSON.stringify(createPayload),
          signal: controller.signal,
        }
      );

      if (!createResponse.ok) {
        const errorData = await createResponse.json().catch(() => ({}));
        const message =
          errorData?.error?.message ||
          errorData?.message ||
          `HTTP ${createResponse.status}`;
        this.logger.error(
          `Sora2 Pro 创建任务失败: HTTP ${createResponse.status}, 错误: ${message}, 完整响应: ${JSON.stringify(errorData)}`
        );

        // 检测配额不足错误
        if (message.toLowerCase().includes('quota') || message.toLowerCase().includes('not enough')) {
          throw new ServiceUnavailableException("服务金额不足，请联系管理员");
        }

        if (createResponse.status >= 500) {
          throw new ServiceUnavailableException("服务器不稳定，请稍后再试");
        }
        throw new ServiceUnavailableException(
          `Sora2 Pro 创建任务失败: ${message}`
        );
      }

      const createResult = await createResponse.json();
      this.logger.log(
        `Sora2 Pro 创建任务响应: ${JSON.stringify(createResult)}`
      );

      // 提取 taskId
      taskId =
        createResult?.task_id ||
        createResult?.id ||
        createResult?.data?.task_id ||
        createResult?.data?.id;

      if (!taskId) {
        throw new ServiceUnavailableException(
          `Sora2 Pro 未返回任务ID, 响应: ${JSON.stringify(createResult)}`
        );
      }

      this.logger.log(`Sora2 Pro 任务已创建: ${taskId}`);
    } catch (error) {
      if ((error as any)?.name === "AbortError") {
        throw new ServiceUnavailableException("服务器不稳定，请稍后再试");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    // 2. 轮询任务状态
    const pollResult = await this.pollV2TaskUntilComplete(taskId);

    if (!pollResult) {
      throw new ServiceUnavailableException("服务器不稳定，请稍后再试");
    }

    if (
      pollResult.status &&
      SORA2_V2_FAILED_STATUSES.includes(pollResult.status)
    ) {
      throw new ServiceUnavailableException("服务器不稳定，请稍后再试");
    }

    if (!pollResult.videoUrl) {
      throw new ServiceUnavailableException("服务器不稳定，请稍后再试");
    }

    const elapsedTime = ((Date.now() - startedAt) / 1000).toFixed(2);
    this.logger.log(`Sora2 Pro 视频生成成功，耗时 ${elapsedTime}s`);

    return {
      videoUrl: pollResult.videoUrl,
      content: `视频已生成（Sora2 Pro，任务ID: ${taskId}）`,
      thumbnailUrl: pollResult.thumbnailUrl,
      referencedUrls: pollResult.videoUrl ? [pollResult.videoUrl] : [],
      status: pollResult.status,
      taskId,
      taskInfo: pollResult.taskInfo,
    };
  }

  /**
   * 轮询Sora2 Pro任务状态
   */
  private async pollV2TaskUntilComplete(
    taskId: string
  ): Promise<Sora2ResolvedMedia | null> {
    let attempt = 0;

    while (attempt < SORA2_V2_POLL_MAX_ATTEMPTS) {
      attempt += 1;
      await this.delay(SORA2_V2_POLL_INTERVAL_MS);

      try {
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          SORA2_V2_FETCH_TIMEOUT_MS
        );

        let response: Response;
        try {
          response = await fetch(
            `${this.apiBaseV2}/v1/videos/${taskId}?t=${Date.now()}`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${this.apiKeyV2}`,
                "Cache-Control": "no-cache",
                Pragma: "no-cache",
              },
              signal: controller.signal,
            }
          );
        } catch (fetchError) {
          if ((fetchError as any)?.name === "AbortError") {
            this.logger.warn(`Sora2 Pro 轮询超时 (attempt ${attempt})`);
            continue;
          }
          throw fetchError;
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          this.logger.warn(`Sora2 Pro 轮询失败: HTTP ${response.status}`);
          continue;
        }

        const result = await response.json().catch(() => ({}));
        this.logger.debug(`Sora2 Pro 轮询响应: ${JSON.stringify(result)}`);

        const data = this.normalizeApimartTaskPayload(result, taskId);
        const statusRaw = String(data?.status || result?.status || "");
        const status = statusRaw.toLowerCase();

        // 检查失败状态
        if (
          status &&
          SORA2_V2_FAILED_STATUSES.some(
            (failedStatus) => failedStatus.toLowerCase() === status
          )
        ) {
          return {
            status,
            errorMessage:
              data?.error?.message || data?.message || data?.fail_reason,
            referencedUrls: [],
            taskInfo: data,
          };
        }

        // 尝试提取视频URL（兼容多种字段名）
        const { videoUrl, thumbnailUrl } = this.extractApimartMedia(data);
        this.logger.log(
          `Sora2 Pro poll: task=${taskId}, attempt=${attempt}, status=${
            statusRaw || "unknown"
          }, hasVideo=${!!videoUrl}, hasThumbnail=${!!thumbnailUrl}`
        );

        if (videoUrl) {
          this.logger.log(
            `Sora2 Pro media resolved: task=${taskId}, attempt=${attempt}, videoUrl=${this.toLogSnippet(
              videoUrl,
              220
            )}, thumbnailUrl=${this.toLogSnippet(thumbnailUrl, 220)}`
          );
          return {
            videoUrl,
            thumbnailUrl,
            status: status || "completed",
            referencedUrls: [videoUrl],
            taskInfo: data,
            taskId,
          };
        }

        if (status === "completed" || status === "succeeded" || status === "success") {
          this.logger.warn(
            `Sora2 Pro task succeeded but no video URL parsed(task=${taskId}, attempt=${attempt}): raw=${JSON.stringify(
              result
            ).slice(0, 900)}, normalized=${JSON.stringify(data).slice(0, 900)}`
          );
        }
      } catch (error) {
        this.logger.warn(
          `Sora2 Pro 轮询异常: ${
            error instanceof Error ? error.message : error
          }`
        );
      }
    }

    this.logger.warn(`Sora2 Pro 任务 ${taskId} 轮询超时`);
    return null;
  }

  /**
   * 从Sora2 Pro响应中提取视频URL
   */
  private extractV2VideoUrl(data: any): string | undefined {
    if (!data) return undefined;

    // 常见字段名
    const candidates: unknown[] = [
      data.video_url,
      data.output,
      data.output_url,
      data.video,
      data.url,
      data.result,
      data.resource_url,
      data.media_url,
      data.file_url,
      data?.data?.video_url,
      data?.data?.output,
      data?.data?.url,
      data?.task_result?.video_url,
      data?.task_result?.url,
      data?.task_result?.output,
    ];

    for (const value of candidates) {
      if (typeof value === "string" && value.startsWith("http")) {
        return value;
      }
      if (Array.isArray(value)) {
        const firstUrl = value.find(
          (v) => typeof v === "string" && v.startsWith("http")
        );
        if (firstUrl) return firstUrl;
      }
    }
    return undefined;
  }


  private tryParseJson(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  private normalizeUrlCandidate(value: string): string {
    return value
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[,.;)\]\s]+$/g, "");
  }

  private extractUrlsFromText(text: string): string[] {
    const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    return matches.map((value) => this.normalizeUrlCandidate(value));
  }

  private collectUrlsFromObject(value: unknown, bucket: Set<string>) {
    if (!value) return;
    if (typeof value === "string") {
      if (value.startsWith("http")) {
        bucket.add(this.normalizeUrlCandidate(value));
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => this.collectUrlsFromObject(item, bucket));
      return;
    }
    if (typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach((item) =>
        this.collectUrlsFromObject(item, bucket)
      );
    }
  }

  private pickFirstMatchingUrl(
    urls: Iterable<string>,
    matcher: (url: string) => boolean
  ): string | undefined {
    for (const url of urls) {
      if (matcher(url)) {
        return url;
      }
    }
    return undefined;
  }

  private isLikelyVideoUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return SORA2_VIDEO_EXTENSIONS.some((ext) => lower.includes(ext));
  }

  private isLikelyImageUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return SORA2_IMAGE_EXTENSIONS.some((ext) => lower.includes(ext));
  }

  private isAsyncTaskUrl(url: string): boolean {
    return SORA2_ASYNC_HOST_HINTS.some((mark) => url.includes(mark));
  }

  private toLogSnippet(value: unknown, maxLength: number = 1200): string {
    if (value === undefined || value === null) return "null";
    try {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return text.length > maxLength
        ? `${text.slice(0, maxLength)}...(truncated)`
        : text;
    } catch {
      return String(value);
    }
  }

  private isRetryableVideoError(error: unknown): boolean {
    const code = (error as any)?.code as string | undefined;
    const message =
      error instanceof Error ? error.message : String(error ?? "");
    if (code?.startsWith("HTTP_5")) return true;
    if (code === "NETWORK_ERROR") return true;
    if (/load failed/i.test(message)) return true;
    if (/failed to fetch/i.test(message)) return true;
    if (/network.*error/i.test(message)) return true;
    if (/timeout/i.test(message)) return true;
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
