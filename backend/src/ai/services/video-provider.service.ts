import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { VideoProviderRequestDto } from "../dto/video-provider.dto";
import { OssService } from "../../oss/oss.service";

export interface VideoGenerationResult {
  taskId: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  videoUrl?: string;
  thumbnailUrl?: string;
}

@Injectable()
export class VideoProviderService {
  private readonly logger = new Logger(VideoProviderService.name);

  constructor(private readonly oss: OssService) {}

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
      `🎬 视频生成任务创建: provider=${provider}, prompt=${options.prompt.substring(
        0,
        50
      )}...`
    );

    switch (provider) {
      case "doubao":
        return this.generateDoubao(options, apiKey);
      case "kling":
        return this.generateKling(options, apiKey);
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
    provider: "kling" | "vidu" | "doubao",
    taskId: string
  ): Promise<{ status: string; videoUrl?: string; thumbnailUrl?: string }> {
    const apiKey = this.apiKeys[provider];
    if (!apiKey) throw new Error(`${provider} API Key 未配置`);

    switch (provider) {
      case "doubao":
        return this.queryDoubao(taskId, apiKey);
      case "kling":
        return this.queryKling(taskId, apiKey);
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
        return {
          status: "succeeded",
          videoUrl: data.content?.video_url,
        };
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
      model_name: "kling-v2-1",
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
        return {
          status: "succeeded",
          videoUrl: data.data.task_result?.videos?.[0]?.url,
        };
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
        return {
          status: "succeeded",
          videoUrl: data.creations?.[0]?.url,
        };
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
}
