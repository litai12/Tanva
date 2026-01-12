import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { VideoProviderRequestDto } from "../dto/video-provider.dto";

export interface VideoGenerationResult {
  taskId: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  videoUrl?: string;
  thumbnailUrl?: string;
}

@Injectable()
export class VideoProviderService {
  private readonly logger = new Logger(VideoProviderService.name);

  // 将要发送给外部提供商的请求体安全日志化（截断超长字段）
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
    // log payload before sending
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
    const isImageToVideo =
      options.referenceImages && options.referenceImages.length > 0;
    const endpoint = isImageToVideo
      ? `https://models.kapon.cloud/kling/v1/videos/image2video`
      : `https://models.kapon.cloud/kling/v1/videos/text2video`;

    const payload: any = {
      model_name: "kling-v1-6",
      prompt: options.prompt,
      duration: options.duration === 10 ? "10" : "5",
      aspect_ratio: options.aspectRatio || "16:9",
      // 可选模式：'std' 或 'pro'
      mode: (options as any).mode || "std",
    };

    if (isImageToVideo) {
      // Kling 要求纯 Base64，去除 data URI 前缀
      const base64Data = options.referenceImages![0];
      payload.image = base64Data.includes("base64,")
        ? base64Data.split("base64,")[1]
        : base64Data;
    }
    // log payload before sending
    this.logProviderPayload("kling", payload);

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
        `❌ Kling 生成失败: HTTP ${response.status}, error=${JSON.stringify(
          error
        )}`
      );
      throw new Error(
        error.error?.message || error.message || `HTTP ${response.status}`
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
      // Kling 的查询路径在 Kapon 上区分 text2video 和 image2video
      // 我们先尝试 text2video 路径
      let response = await fetch(
        `https://models.kapon.cloud/kling/v1/videos/text2video/${taskId}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );

      let data = await response.json().catch(() => ({}));

      // 如果没有获取到有效数据，尝试 image2video 路径
      if (!data.data || data.code !== 0) {
        response = await fetch(
          `https://models.kapon.cloud/kling/v1/videos/image2video/${taskId}`,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
          }
        );
        data = await response.json().catch(() => ({}));
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
    const isImageToVideo =
      options.referenceImages && options.referenceImages.length > 0;
    const endpoint = isImageToVideo
      ? `https://models.kapon.cloud/vidu/ent/v2/img2video`
      : `https://models.kapon.cloud/vidu/ent/v2/text2video`;

    const payload: any = {
      model: isImageToVideo ? "viduq2-turbo" : "viduq2",
      prompt: options.prompt,
      duration: options.duration || 5,
      aspect_ratio: options.aspectRatio || "16:9",
      resolution: options.resolution || "720p",
      style: options.style || "general",
      off_peak: options.offPeak || false,
    };

    if (isImageToVideo) {
      payload.images = [options.referenceImages![0]];
    }

    // log payload before sending
    this.logProviderPayload("vidu", payload);

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
