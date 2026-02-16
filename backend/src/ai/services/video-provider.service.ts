// Video provider integration (Kling/Vidu/Seedance) with OSS post-processing.
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { VideoProviderRequestDto } from "../dto/video-provider.dto";
import { OssService } from "../../oss/oss.service";
import { Readable } from "node:stream";

// 默认请求超时时间（毫秒）
const DEFAULT_FETCH_TIMEOUT = 180000; // 3分钟
const QUERY_FETCH_TIMEOUT = 60000; // 60秒（避免触发阿里云 ESA 300秒超时限制，采用短超时+快速轮询策略）

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
}

@Injectable()
export class VideoProviderService {
  private readonly logger = new Logger(VideoProviderService.name);
  private readonly doubaoVideoCache = new Map<string, string>();

  constructor(private readonly oss: OssService) {}

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

  private async uploadRemoteVideoToOss(
    sourceUrl: string,
    taskId: string
  ): Promise<string> {
    if (!this.oss.isEnabled()) {
      throw new ServiceUnavailableException("OSS 未配置，无法上传视频");
    }

    const cached = this.doubaoVideoCache.get(taskId);
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

    this.doubaoVideoCache.set(taskId, url);
    return url;
  }

  private async uploadBase64ImageToOSS(
    base64Data: string,
    mimeType: string = "image/png"
  ): Promise<string> {
    try {
      if (base64Data.startsWith("http://") || base64Data.startsWith("https://")) {
        this.logger.log(`📎 Image is already a URL: ${base64Data.substring(0, 100)}...`);
        return base64Data;
      }

      const cleanBase64 = base64Data.includes("base64,")
        ? base64Data.split("base64,")[1]
        : base64Data;

      const imageBuffer = Buffer.from(cleanBase64, "base64");
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const extension = mimeType.split("/")[1] || "png";
      const key = `ai/images/kling-inputs/${timestamp}-${randomId}.${extension}`;

      const result = await this.oss.putStream(
        key,
        require("stream").Readable.from(imageBuffer)
      );

      this.logger.log(`📤 Uploaded image to OSS: ${result.url}`);
      return result.url;
    } catch (error) {
      this.logger.error(`❌ Failed to upload image to OSS: ${error}`);
      throw error;
    }
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
    "kling-o1": process.env.KLING_API_KEY || "sk-kling-xxx",
    vidu: process.env.VIDU_API_KEY || "sk-vidu-xxx",
    doubao:
      process.env.DOUBAO_API_KEY || "0ac5fae84-f299-4db4-8d7e-3f7fc355c6ac",
  };

  /**
   * 创建生成任务
   */
  async generateVideo(
    options: VideoProviderRequestDto
  ): Promise<VideoGenerationResult> {
    const { provider } = options;
    const apiKey = this.apiKeys[provider];

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
      case "doubao":
        return this.generateDoubao(options, apiKey);
      case "kling":
        return this.generateKling(options, apiKey);
      case "kling-2.6":
        return this.generateKling26(options, apiKey);
      case "kling-o1":
        return this.generateKlingO1(options, apiKey);
      case "vidu":
        return this.generateVidu(options, apiKey);
      default:
        throw new Error(`不支持的供应商: ${provider}`);
    }
  }

  /**
   * 查询任务状态
   */
  async queryTask(
    provider: "kling" | "kling-2.6" | "kling-o1" | "vidu" | "doubao",
    taskId: string
  ): Promise<{ status: string; videoUrl?: string; thumbnailUrl?: string }> {
    const apiKey = this.apiKeys[provider];
    if (!apiKey) throw new Error(`${provider} API Key 未配置`);

    switch (provider) {
      case "doubao":
        return this.queryDoubao(taskId, apiKey);
      case "kling":
        return this.queryKling(taskId, apiKey);
      case "kling-2.6":
        return this.queryKling26(taskId, apiKey);
      case "kling-o1":
        return this.queryKlingO1(taskId, apiKey);
      case "vidu":
        return this.queryVidu(taskId, apiKey);
      default:
        throw new Error(`不支持的供应商: ${provider}`);
    }
  }

  /**
   * 豆包 Seedance 视频生成
   */
  private async generateDoubao(
    options: VideoProviderRequestDto,
    apiKey: string
  ): Promise<VideoGenerationResult> {
    let promptText = options.prompt;
    const params: string[] = [];

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

    if (params.length > 0) {
      promptText = `${promptText} ${params.join(" ")}`;
    }

    const content: any[] = [{ type: "text", text: promptText }];

    if (options.referenceImages && options.referenceImages.length > 0) {
      content.push({
        type: "image_url",
        image_url: { url: options.referenceImages[0] },
      });
    }

    const payload = {
      model: "doubao-seedance-1-5-pro-251215",
      content,
    };
    this.logProviderPayload("doubao", payload);

    const response = await fetch(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
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
    try {
      const response = await fetch(
        `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );

      const data = await response.json();
      this.logger.log(
        `🔍 豆包任务状态查询: taskId=${taskId}, status=${data.status}`
      );

      if (data.status === "succeeded") {
        const upstreamUrl: string | undefined = data.content?.video_url;
        if (!upstreamUrl) {
          throw new ServiceUnavailableException("Seedance 返回空视频链接");
        }
        if (this.isOssPublicUrl(upstreamUrl)) {
          return { status: "succeeded", videoUrl: upstreamUrl };
        }
        const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, taskId);
        return { status: "succeeded", videoUrl: ossUrl };
      }

      if (data.status === "failed") {
        this.logger.error(
          `❌ 豆包任务失败: taskId=${taskId}, error=${JSON.stringify(
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
        `❌ 豆包查询异常: taskId=${taskId}, error=${
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
      model_name: "kling-v1",  // 使用 v1 以确保兼容性
      mode: (options as any).mode || "pro",
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
      payload.image = await this.uploadBase64ImageToOSS(options.referenceImages![0]);
      if (options.prompt) {
        payload.prompt = options.prompt;
      }
    } else if (videoMode === "image2video-tail") {
      payload.model_name = "kling-v1";
      payload.image = await this.uploadBase64ImageToOSS(options.referenceImages![0]);
      payload.image_tail = await this.uploadBase64ImageToOSS(options.referenceImages![1]);
      payload.prompt = options.prompt || KLING_DEFAULT_REFERENCE_PROMPT;
    } else if (videoMode === "multi-image2video") {
      payload.model_name = "kling-v1-6";
      const imageUrls = await Promise.all(
        options.referenceImages!.slice(0, 4).map(img => this.uploadBase64ImageToOSS(img))
      );
      payload.image_list = imageUrls.map(url => ({ image: url }));
      payload.prompt = options.prompt || KLING_DEFAULT_REFERENCE_PROMPT;
    }

    this.logProviderPayload("kling", payload);
    this.logger.log(`🎬 Kling: mode=${videoMode}, images=${imageCount}, endpoint=${endpoint}`);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const textBody = await response.text().catch(() => "");
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => (headers[k] = v));

      this.logger.error(
        `❌ Kling 生成失败: HTTP ${response.status}, mode=${videoMode}, response_text=${textBody.slice(
          0,
          1000
        )}, headers=${JSON.stringify(headers)}`
      );

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

    const payload: any = {
      model_name: "kling-v2-6",
      mode: (options as any).mode || "pro",
      duration: Number(options.duration) === 10 ? "10" : "5",
    };

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
      payload.image = await this.uploadBase64ImageToOSS(options.referenceImages![0]);
      if (options.prompt) {
        payload.prompt = options.prompt;
      }
    } else if (videoMode === "image2video-tail") {
      payload.image = await this.uploadBase64ImageToOSS(options.referenceImages![0]);
      payload.image_tail = await this.uploadBase64ImageToOSS(options.referenceImages![1]);
      payload.prompt = options.prompt || KLING_DEFAULT_REFERENCE_PROMPT;
    } else if (videoMode === "multi-image2video") {
      const imageUrls = await Promise.all(
        options.referenceImages!.slice(0, 4).map(img => this.uploadBase64ImageToOSS(img))
      );
      payload.image_list = imageUrls.map(url => ({ image: url }));
      payload.prompt = options.prompt || KLING_DEFAULT_REFERENCE_PROMPT;
    }

    this.logProviderPayload("kling-2.6", payload);
    this.logger.log(`🎬 Kling 2.6: mode=${videoMode}, images=${imageCount}, endpoint=${endpoint}`);

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
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => (headers[k] = v));

      this.logger.error(
        `❌ Kling 2.6 生成失败: HTTP ${response.status}, mode=${videoMode}, response_text=${textBody.slice(
          0,
          1000
        )}, headers=${JSON.stringify(headers)}`
      );

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
        if (this.isOssPublicUrl(upstreamUrl)) {
          return { status: "succeeded", videoUrl: upstreamUrl };
        }
        const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, `kling26-${taskId}`);
        this.logger.log(`📤 Kling 2.6 视频已上传到 OSS: ${ossUrl}`);
        return { status: "succeeded", videoUrl: ossUrl };
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
    // 确定视频生成模式（智能判断）
    let videoMode = options.videoMode;
    const imageCount = options.referenceImages?.length || 0;
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
      payload.model = "viduq2-turbo";
      payload.images = [options.referenceImages![0]];
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
      payload.off_peak = options.offPeak || false;
    } else if (videoMode === "start-end2video") {
      payload.model = "viduq2-turbo";
      payload.images = [options.referenceImages![0], options.referenceImages![1]];
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
    } else if (videoMode === "reference2video") {
      if (!options.prompt) {
        throw new Error("参考生视频模式需要提供 prompt 参数");
      }
      payload.model = "viduq2";
      payload.images = options.referenceImages!.slice(0, 7);
      payload.prompt = options.prompt;
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
    }

    this.logProviderPayload("vidu", payload);
    this.logger.log(`🎬 Vidu: mode=${videoMode}, images=${imageCount}, endpoint=${endpoint}`);

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
    const hasVideo = !!options.referenceVideo;

    const payload: any = {
      model_name: "kling-video-o1",
      mode: options.mode || "pro",
    };

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
    if (options.aspectRatio) {
      payload.aspect_ratio = options.aspectRatio;
    } else if (imageCount === 0 && !hasVideo) {
      // 文生视频模式，默认 16:9
      payload.aspect_ratio = "16:9";
    }

    // 处理图片列表
    if (imageCount > 0) {
      const imageList: any[] = [];
      for (let i = 0; i < Math.min(imageCount, 7); i++) {
        const imgUrl = await this.uploadBase64ImageToOSS(options.referenceImages![i]);
        const imgItem: any = { image_url: imgUrl };
        // 如果是前两张图，可以设置为首帧/尾帧
        if (i === 0 && imageCount >= 1) {
          imgItem.type = "first_frame";
        } else if (i === 1 && imageCount === 2) {
          imgItem.type = "end_frame";
        }
        imageList.push(imgItem);
      }
      payload.image_list = imageList;
    }

    // 处理参考视频
    if (hasVideo) {
      payload.video_list = [{
        video_url: options.referenceVideo,
        refer_type: options.referenceVideoType || "feature",
        keep_original_sound: options.keepOriginalSound || "no",
      }];
    }

    this.logProviderPayload("kling-o1", payload);
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
        const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, `kling-o1-${taskId}`);
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
}
