import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  IAIProvider,
  ImageGenerationRequest,
  ImageEditRequest,
  ImageBlendRequest,
  ImageAnalysisRequest,
  TextChatRequest,
  ToolSelectionRequest,
  PaperJSGenerateRequest,
  AIProviderResponse,
  ImageResult,
  AnalysisResult,
  TextResult,
  ToolSelectionResult,
  PaperJSResult,
} from "./ai-provider.interface";
import { parseToolSelectionJson } from "../tool-selection-json.util";

const DEFAULT_TOOLS = [
  "generateImage",
  "editImage",
  "blendImages",
  "analyzeImage",
  "chatResponse",
  "generateVideo",
  "generatePaperJS",
] as const;

const TOOL_DESCRIPTIONS: Record<string, string> = {
  generateImage: "生成新的图像",
  editImage: "编辑现有图像",
  blendImages: "融合多张图像",
  analyzeImage: "分析图像内容",
  chatResponse: "文本对话或聊天",
  generateVideo: "生成视频",
  generatePaperJS: "生成 Paper.js 矢量图形代码",
};

const VECTOR_KEYWORDS = [
  "矢量",
  "矢量图",
  "矢量化",
  "vector",
  "vectorize",
  "vectorization",
  "svg",
  "paperjs",
  "paper.js",
  "svg path",
  "路径代码",
  "path code",
  "vector graphic",
  "vectorgraphics",
];

/**
 * Banana API Provider - 使用HTTP直接调用Google Gemini API的代理
 * 文档: https://147api.apifox.cn/
 * API地址: https://147ai.com/v1beta/models
 */
@Injectable()
export class BananaProvider implements IAIProvider {
  private readonly logger = new Logger(BananaProvider.name);
  private apiKey: string | null = null;
  private readonly apiBaseUrl = "https://api1.147ai.com/v1beta/models";
  private readonly DEFAULT_MODEL = "gemini-3-pro-image-preview";
  private readonly DEFAULT_TIMEOUT = 300000; // 5分钟
  private readonly MAX_RETRIES = 3;
  private readonly MAX_MODEL_ATTEMPTS = 3; // 主模型 + 两级降级（Ultra -> Pro -> Fast）
  private readonly RETRY_DELAYS = [2000, 5000, 10000]; // 递增延迟: 2s, 5s, 10s

  // 降级模型映射：优先同代/同能力降级，再降到更保守模型
  private readonly FALLBACK_MODELS: Record<string, string> = {
    "gemini-3-pro-image-preview": "gemini-2.5-flash-image",
    "gemini-3.1-flash-image-preview": "gemini-3-pro-image-preview",
    "banana-gemini-3.1-flash-image-preview": "gemini-3-pro-image-preview",
    "gemini-3-pro-preview": "gemini-3-flash-preview",
    "banana-gemini-3-pro-preview": "gemini-3-flash-preview",
    "banana-gemini-3-pro-image-preview": "gemini-2.5-flash-image",
  };

  constructor(private readonly config: ConfigService) {}

  async initialize(): Promise<void> {
    this.apiKey = this.config.get<string>("BANANA_API_KEY") ?? null;

    if (!this.apiKey) {
      this.logger.warn("Banana API key not configured.");
      return;
    }

    this.logger.log("Banana API provider initialized successfully");
  }

  private ensureApiKey(): string {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        "147 API key not configured on the server."
      );
    }
    return this.apiKey;
  }

  private normalizeModelName(model: string): string {
    // 移除banana-前缀，确保API能识别模型名称
    // banana-gemini-3-pro-image-preview -> gemini-3-pro-image-preview
    return model.startsWith("banana-") ? model.substring(7) : model;
  }

  /**
   * 判断错误是否应该触发降级
   * - 500系列服务器错误
   * - 超时错误
   * - 模型不可用错误
   * - 速率限制错误
   */
  private shouldFallback(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes("500") ||
      message.includes("502") ||
      message.includes("503") ||
      message.includes("504") ||
      message.includes("timeout") ||
      (message.includes("model") && message.includes("not")) ||
      message.includes("unavailable") ||
      message.includes("rate limit") ||
      message.includes("quota") ||
      message.includes("overloaded") ||
      message.includes("capacity")
    );
  }

  /**
   * 获取降级模型
   * 如果当前模型有对应的降级模型，返回降级模型名称
   * 否则返回 null
   */
  private getFallbackModel(currentModel: string): string | null {
    const normalized = this.normalizeModelName(currentModel);
    return (
      this.FALLBACK_MODELS[normalized] ||
      this.FALLBACK_MODELS[currentModel] ||
      null
    );
  }

  private inferMimeTypeFromBase64(data: string): string {
    const headerChecks = [
      { prefix: "iVBORw0KGgo", mime: "image/png" },
      { prefix: "/9j/", mime: "image/jpeg" },
      { prefix: "R0lGOD", mime: "image/gif" },
      { prefix: "UklGR", mime: "image/webp" },
      { prefix: "Qk", mime: "image/bmp" },
      { prefix: "JVBERi", mime: "application/pdf" }, // PDF 文件 (%PDF-)
    ];

    const head = data.substring(0, 20);
    for (const check of headerChecks) {
      if (head.startsWith(check.prefix)) {
        return check.mime;
      }
    }

    return "image/png";
  }

  private async normalizeFileInputAsync(
    fileInput: string,
    context: string
  ): Promise<{ data: string; mimeType: string }> {
    if (!fileInput || fileInput.trim().length === 0) {
      throw new Error(`${context} file payload is empty`);
    }

    let trimmed = fileInput.trim();

    // 🔥 拒绝无效的 MIME 类型（如 text/html）
    const invalidMimeTypes = [
      "data:text/html",
      "data:text/plain",
      "data:text/css",
      "data:text/javascript",
      "data:application/json",
      "data:application/javascript",
      "data:application/xml",
    ];
    for (const invalid of invalidMimeTypes) {
      if (trimmed.toLowerCase().startsWith(invalid)) {
        const mimeType = trimmed.match(/^data:([^;,]+)/i)?.[1] || "unknown";
        throw new Error(
          `Invalid ${context} file format: expected image/*, got ${mimeType}`
        );
      }
    }

    // 添加调试日志
    this.logger.debug(
      `[normalizeFileInputAsync] ${context}: input length=${
        trimmed.length
      }, starts with: ${trimmed.substring(0, 80)}...`
    );

    // 🔥 修复：处理前端错误格式 data:image/xxx;base64,https://...
    // 前端可能错误地将 URL 包装成 data URL 格式
    const malformedDataUrlMatch = trimmed.match(
      /^data:image\/[\w.+-]+;base64,(https?:\/\/.+)$/i
    );
    if (malformedDataUrlMatch) {
      this.logger.warn(
        `[normalizeFileInputAsync] Detected malformed data URL with embedded HTTP URL, extracting URL...`
      );
      trimmed = malformedDataUrlMatch[1];
    }

    // 支持 HTTP/HTTPS URL - 自动下载并转换为 Base64
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      this.logger.log(
        `[normalizeFileInputAsync] Fetching image from URL for ${context}: ${trimmed.substring(
          0,
          100
        )}...`
      );
      try {
        const response = await fetch(trimmed, {
          headers: {
            "User-Agent": "Tanva-AI-Backend/1.0",
          },
        });
        if (!response.ok) {
          throw new Error(
            `Failed to fetch image: ${response.status} ${response.statusText}`
          );
        }
        const contentType = response.headers.get("content-type") || "image/png";
        const mimeType = contentType.split(";")[0].trim().toLowerCase();

        // 🔥 验证返回的内容类型是图片
        const invalidContentTypes = [
          "text/html",
          "text/plain",
          "text/css",
          "text/javascript",
          "application/json",
          "application/javascript",
          "application/xml",
        ];
        if (invalidContentTypes.some((t) => mimeType.startsWith(t))) {
          throw new Error(
            `Invalid ${context} file: server returned ${mimeType} instead of image`
          );
        }

        const arrayBuffer = await response.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString("base64");

        this.logger.log(
          `[normalizeFileInputAsync] Fetched image successfully: ${base64Data.length} chars, mimeType: ${mimeType}`
        );

        return {
          data: base64Data,
          mimeType,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[normalizeFileInputAsync] Failed to fetch ${context} image from URL: ${message}`
        );
        throw new Error(
          `Failed to fetch ${context} image from URL: ${message}`
        );
      }
    }

    // 支持 data:image/* 和 data:application/pdf 格式
    if (
      trimmed.startsWith("data:image/") ||
      trimmed.startsWith("data:application/pdf")
    ) {
      const match = trimmed.match(
        /^data:((?:image\/[\w.+-]+)|(?:application\/pdf));base64,(.+)$/i
      );
      if (!match) {
        throw new Error(`Invalid data URL format for ${context} file`);
      }

      const [, mimeType, base64Data] = match;
      const sanitized = base64Data.replace(/\s+/g, "");

      return {
        data: sanitized,
        mimeType: mimeType || "image/png",
      };
    }

    const withoutQuotes = trimmed
      .replace(/^"+|"+$/g, "")
      .replace(/^'+|'+$/g, "");
    const sanitized = withoutQuotes.replace(/\s+/g, "");
    const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;

    if (!base64Regex.test(sanitized)) {
      throw new Error(
        `Unsupported ${context} file format. Expected a base64 string, data URL, or HTTP URL.`
      );
    }

    return {
      data: sanitized,
      mimeType: this.inferMimeTypeFromBase64(sanitized),
    };
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    operationType: string,
    maxRetries: number = this.MAX_RETRIES
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.debug(`${operationType} attempt ${attempt}/${maxRetries}`);
        const result = await operation();

        if (attempt > 1) {
          this.logger.log(`${operationType} succeeded on attempt ${attempt}`);
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries) {
          // 使用递增延迟
          const delay =
            this.RETRY_DELAYS[attempt - 1] ||
            this.RETRY_DELAYS[this.RETRY_DELAYS.length - 1];
          this.logger.warn(
            `${operationType} attempt ${attempt} failed: ${lastError.message}, retrying in ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          this.logger.error(`${operationType} failed after all attempts`);
        }
      }
    }

    throw lastError!;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number = this.DEFAULT_TIMEOUT,
    operationType?: string
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Request timeout")), timeoutMs)
    );

    const startTime = Date.now();

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      const duration = Date.now() - startTime;
      this.logger.log(
        `${operationType || "API call"} succeeded in ${duration}ms`
      );
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `${operationType || "API call"} failed after ${duration}ms: ${message}`
      );
      throw error;
    }
  }

  private buildContents(input: any): Array<{ role: string; parts: any[] }> {
    // 已经是完整的 content 结构时直接返回
    if (Array.isArray(input)) {
      const allContentObjects = input.every(
        (item) =>
          item && typeof item === "object" && "role" in item && "parts" in item
      );

      if (allContentObjects) {
        return input;
      }

      const parts = input.map((part) => {
        if (typeof part === "string") {
          return { text: part };
        }

        if (
          part &&
          typeof part === "object" &&
          !("role" in part) &&
          !("parts" in part)
        ) {
          return part;
        }

        return { text: String(part) };
      });

      return [{ role: "user", parts }];
    }

    if (input && typeof input === "object") {
      if ("role" in input && "parts" in input) {
        return [input];
      }

      return [
        {
          role: "user",
          parts: [input],
        },
      ];
    }

    return [
      {
        role: "user",
        parts: [
          {
            text: typeof input === "string" ? input : String(input),
          },
        ],
      },
    ];
  }

  private sanitizeApiKey(apiKey: string): string {
    // 147 API 要求直接使用 sk- 开头的密钥，如果误带 Bearer 则去掉
    return apiKey.replace(/^Bearer\s+/i, "").trim();
  }

  private normalizeResponseModalities(
    input: unknown
  ): Array<"TEXT" | "IMAGE"> | undefined {
    if (!Array.isArray(input)) return undefined;
    const normalized = input
      .map((value) => {
        const raw = typeof value === "string" ? value.trim() : String(value);
        if (!raw) return null;
        const upper = raw.toUpperCase();
        if (upper === "TEXT" || upper === "IMAGE")
          return upper as "TEXT" | "IMAGE";
        // 兼容旧写法：Text/Image
        if (raw === "Text") return "TEXT";
        if (raw === "Image") return "IMAGE";
        this.logger.warn(
          `[BananaProvider] Ignoring unsupported response modality: ${raw}`
        );
        return null;
      })
      .filter((v): v is "TEXT" | "IMAGE" => v === "TEXT" || v === "IMAGE");

    const deduped = Array.from(new Set(normalized));
    return deduped.length ? deduped : undefined;
  }

  private supportsImageSize(model: string): boolean {
    const normalized = this.normalizeModelName(model);
    // 经验：gemini-2.5-flash-image 在 147 API 上不支持 imageSize（会触发 400 invalid argument）
    // gemini-3 / imagen-3 系列通常支持 imageSize
    return normalized.startsWith("gemini-3") || normalized.startsWith("imagen-3");
  }

  private supportsThinkingLevel(model: string): boolean {
    const normalized = this.normalizeModelName(model);
    // thinking_level 属于 Gemini 3 特性
    return normalized.startsWith("gemini-3");
  }

  private async makeRequest(
    model: string,
    contents: any,
    config?: any
  ): Promise<{ imageBytes: string | null; textResponse: string }> {
    const apiKey = this.ensureApiKey();
    const url = `${this.apiBaseUrl}/${model}:generateContent`;

    const headers = {
      Authorization: this.sanitizeApiKey(apiKey),
      "Content-Type": "application/json",
    };

    // 构建请求体，更好地支持Gemini API格式
    // 147 API 可能不支持 safetySettings，暂时移除
    const body: any = {
      contents: this.buildContents(contents),
    };

    // 添加生成配置
    if (config) {
      // 构建 generationConfig（包含 responseModalities, imageConfig, thinking_level）
      const generationConfig: any = {};

      if (config.responseModalities) {
        const normalized = this.normalizeResponseModalities(
          config.responseModalities
        );
        if (normalized) {
          generationConfig.responseModalities = normalized;
        }
      }

      if (config.imageConfig) {
        const imageConfig: Record<string, any> = { ...config.imageConfig };

        // 兼容：147 的 gemini-2.5-flash-image 不支持 imageSize 参数，避免直接 400
        if (!this.supportsImageSize(model) && "imageSize" in imageConfig) {
          this.logger.warn(
            `[BananaProvider] Dropping unsupported imageSize for model ${model}`
          );
          delete imageConfig.imageSize;
        }

        if (Object.keys(imageConfig).length > 0) {
          generationConfig.imageConfig = imageConfig;
        }
      }

      if (config.thinking_level) {
        if (this.supportsThinkingLevel(model)) {
          generationConfig.thinking_level = config.thinking_level;
        } else {
          this.logger.warn(
            `[BananaProvider] Dropping unsupported thinking_level for model ${model}`
          );
        }
      }

      // 只有在有内容时才添加 generationConfig
      if (Object.keys(generationConfig).length > 0) {
        body.generationConfig = generationConfig;
      }

      if (config.tools) {
        body.tools = config.tools;
      }
    }

    // 🔍 详细调试日志：请求URL
    this.logger.debug(`Making request to ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error(`API error response: ${errorData}`);
      throw new Error(
        `147 API request failed: ${response.status} ${response.statusText} - ${errorData}`
      );
    }

    const data = await response.json();
    return await this.parseResponse(data, "API call");
  }

  private async parseResponse(
    data: any,
    operationType: string
  ): Promise<{ imageBytes: string | null; textResponse: string }> {
    this.logger.debug(`Parsing ${operationType} response...`);

    let textResponse: string = "";
    let imageBytes: string | null = null;

    try {
      if (data?.candidates?.[0]?.content?.parts) {
        const parts = data.candidates[0].content.parts;
        for (const part of parts) {
          if (part.text && typeof part.text === "string") {
            textResponse += part.text;
          }

          if (
            part.inlineData?.data &&
            typeof part.inlineData.data === "string"
          ) {
            imageBytes = part.inlineData.data.replace(/\s+/g, "");
          }
        }
      }

      this.logger.log(
        `${operationType} parsing completed: text: ${
          textResponse.length
        } chars, has image: ${!!imageBytes}`
      );

      // 🔍 检查返回图片的实际分辨率
      if (imageBytes) {
        try {
          const sharp = require("sharp");
          const buffer = Buffer.from(imageBytes, "base64");
          const metadata = await sharp(buffer).metadata();
          this.logger.log(
            `📐 [Image Resolution] ${operationType}: ${metadata.width}x${metadata.height} pixels`
          );
        } catch (err) {
          this.logger.warn(`⚠️ Failed to read image dimensions: ${err}`);
        }
      }

      return { imageBytes: imageBytes || null, textResponse };
    } catch (error) {
      this.logger.error(`${operationType} parsing failed:`, error);
      throw error;
    }
  }

  async generateImage(
    request: ImageGenerationRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    this.logger.log(
      `Generating image with prompt: ${request.prompt.substring(0, 50)}...`
    );

    const originalModel = this.normalizeModelName(
      request.model || this.DEFAULT_MODEL
    );
    let currentModel = originalModel;
    let usedFallback = false;

    // 尝试使用主模型，失败后降级
    for (let round = 0; round < this.MAX_MODEL_ATTEMPTS; round++) {
      try {
        this.logger.debug(
          `Using model: ${currentModel}${usedFallback ? " (fallback)" : ""}`
        );

        const result = await this.withRetry(async () => {
          return await this.withTimeout(
            (async () => {
              const config: any = {
                responseModalities: request.imageOnly
                  ? ["Image"]
                  : ["Text", "Image"],
              };

              // 配置 imageConfig（aspectRatio 和 imageSize）
              if (request.aspectRatio || request.imageSize) {
                config.imageConfig = {};
                if (request.aspectRatio) {
                  config.imageConfig.aspectRatio = request.aspectRatio;
                }
                if (request.imageSize) {
                  // 根据官方文档，imageSize 必须是字符串 "0.5K"、"1K"、"2K" 或 "4K"（大写K）
                  // 不需要转换，直接使用原始值
                  config.imageConfig.imageSize = request.imageSize;
                }
              }

              // 配置 thinking_level（Gemini 3 特性，降级后不使用）
              if (request.thinkingLevel && !usedFallback) {
                config.thinking_level = request.thinkingLevel;
              }

              return await this.makeRequest(
                currentModel,
                [{ text: request.prompt }],
                config
              );
            })(),
            this.DEFAULT_TIMEOUT,
            "Image generation"
          );
        }, "Image generation");

        if (usedFallback) {
          this.logger.log(
            `🔄 [FALLBACK SUCCESS] Image generation succeeded with fallback model: ${currentModel}`
          );
        }

        return {
          success: true,
          data: {
            imageData: result.imageBytes || undefined,
            textResponse: result.textResponse || "",
            hasImage: !!result.imageBytes,
            metadata: usedFallback
              ? {
                  fallbackUsed: true,
                  originalModel,
                  fallbackModel: currentModel,
                }
              : undefined,
          },
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // 检查是否应该降级
        if (this.shouldFallback(err)) {
          const fallbackModel = this.getFallbackModel(currentModel);
          if (fallbackModel) {
            this.logger.warn(
              `⚠️ [FALLBACK] Image generation failed with ${currentModel}, falling back to ${fallbackModel}. Error: ${err.message}`
            );
            currentModel = fallbackModel;
            usedFallback = true;
            continue; // 重试使用降级模型
          }
        }

        // 无法降级或降级后仍然失败
        this.logger.error("Image generation failed:", error);
        return {
          success: false,
          error: {
            code: "GENERATION_FAILED",
            message: err.message,
            details: error,
          },
        };
      }
    }

    // 不应该到达这里，但为了类型安全
    return {
      success: false,
      error: {
        code: "GENERATION_FAILED",
        message: "Unexpected error in image generation",
      },
    };
  }

  async editImage(
    request: ImageEditRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    this.logger.log(
      `Editing image with prompt: ${request.prompt.substring(0, 50)}...`
    );

    // 使用异步版本支持 HTTP URL
    const { data: imageData, mimeType } = await this.normalizeFileInputAsync(
      request.sourceImage,
      "edit"
    );
    const originalModel = this.normalizeModelName(
      request.model || this.DEFAULT_MODEL
    );
    let currentModel = originalModel;
    let usedFallback = false;

    // 尝试使用主模型，失败后降级
    for (let round = 0; round < this.MAX_MODEL_ATTEMPTS; round++) {
      try {
        this.logger.debug(
          `Using model: ${currentModel}${usedFallback ? " (fallback)" : ""}`
        );

        const result = await this.withRetry(async () => {
          return await this.withTimeout(
            (async () => {
              const config: any = {
                responseModalities: request.imageOnly
                  ? ["Image"]
                  : ["Text", "Image"],
              };

              // 配置 imageConfig（aspectRatio 和 imageSize）
              if (request.aspectRatio || request.imageSize) {
                config.imageConfig = {};
                if (request.aspectRatio) {
                  config.imageConfig.aspectRatio = request.aspectRatio;
                }
                if (request.imageSize) {
                  // 根据官方文档，imageSize 必须是字符串 "0.5K"、"1K"、"2K" 或 "4K"（大写K）
                  // 不需要转换，直接使用原始值
                  config.imageConfig.imageSize = request.imageSize;
                }
              }

              // 配置 thinking_level（Gemini 3 特性，降级后不使用）
              if (request.thinkingLevel && !usedFallback) {
                config.thinking_level = request.thinkingLevel;
              }

              return await this.makeRequest(
                currentModel,
                [
                  { text: request.prompt },
                  {
                    inlineData: {
                      mimeType,
                      data: imageData,
                    },
                  },
                ],
                config
              );
            })(),
            this.DEFAULT_TIMEOUT,
            "Image edit"
          );
        }, "Image edit");

        if (usedFallback) {
          this.logger.log(
            `🔄 [FALLBACK SUCCESS] Image edit succeeded with fallback model: ${currentModel}`
          );
        }

        return {
          success: true,
          data: {
            imageData: result.imageBytes || undefined,
            textResponse: result.textResponse || "",
            hasImage: !!result.imageBytes,
            metadata: usedFallback
              ? {
                  fallbackUsed: true,
                  originalModel,
                  fallbackModel: currentModel,
                }
              : undefined,
          },
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // 检查是否应该降级
        if (this.shouldFallback(err)) {
          const fallbackModel = this.getFallbackModel(currentModel);
          if (fallbackModel) {
            this.logger.warn(
              `⚠️ [FALLBACK] Image edit failed with ${currentModel}, falling back to ${fallbackModel}. Error: ${err.message}`
            );
            currentModel = fallbackModel;
            usedFallback = true;
            continue; // 重试使用降级模型
          }
        }

        // 无法降级或降级后仍然失败
        this.logger.error("Image edit failed:", error);
        return {
          success: false,
          error: {
            code: "EDIT_FAILED",
            message: err.message,
            details: error,
          },
        };
      }
    }

    // 不应该到达这里，但为了类型安全
    return {
      success: false,
      error: {
        code: "EDIT_FAILED",
        message: "Unexpected error in image edit",
      },
    };
  }

  async blendImages(
    request: ImageBlendRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    this.logger.log(
      `Blending ${
        request.sourceImages.length
      } images with prompt: ${request.prompt.substring(0, 50)}...`
    );

    // 使用异步版本支持 HTTP URL
    const normalizedImages = await Promise.all(
      request.sourceImages.map((imageData, index) =>
        this.normalizeFileInputAsync(imageData, `blend source #${index + 1}`)
      )
    );

    const imageParts = normalizedImages.map((image) => ({
      inlineData: {
        mimeType: image.mimeType,
        data: image.data,
      },
    }));

    const originalModel = this.normalizeModelName(
      request.model || this.DEFAULT_MODEL
    );
    let currentModel = originalModel;
    let usedFallback = false;

    // 尝试使用主模型，失败后降级
    for (let round = 0; round < this.MAX_MODEL_ATTEMPTS; round++) {
      try {
        this.logger.debug(
          `Using model: ${currentModel}${usedFallback ? " (fallback)" : ""}`
        );

        const result = await this.withRetry(async () => {
          return await this.withTimeout(
            (async () => {
              const config: any = {
                responseModalities: request.imageOnly
                  ? ["Image"]
                  : ["Text", "Image"],
              };

              // 配置 imageConfig（aspectRatio 和 imageSize）
              if (request.aspectRatio || request.imageSize) {
                config.imageConfig = {};
                if (request.aspectRatio) {
                  config.imageConfig.aspectRatio = request.aspectRatio;
                }
                if (request.imageSize) {
                  // 根据官方文档，imageSize 必须是字符串 "0.5K"、"1K"、"2K" 或 "4K"（大写K）
                  // 不需要转换，直接使用原始值
                  config.imageConfig.imageSize = request.imageSize;
                }
              }

              // 配置 thinking_level（Gemini 3 特性，降级后不使用）
              if (request.thinkingLevel && !usedFallback) {
                config.thinking_level = request.thinkingLevel;
              }

              return await this.makeRequest(
                currentModel,
                [{ text: request.prompt }, ...imageParts],
                config
              );
            })(),
            this.DEFAULT_TIMEOUT,
            "Image blend"
          );
        }, "Image blend");

        if (usedFallback) {
          this.logger.log(
            `🔄 [FALLBACK SUCCESS] Image blend succeeded with fallback model: ${currentModel}`
          );
        }

        return {
          success: true,
          data: {
            imageData: result.imageBytes || undefined,
            textResponse: result.textResponse || "",
            hasImage: !!result.imageBytes,
            metadata: usedFallback
              ? {
                  fallbackUsed: true,
                  originalModel,
                  fallbackModel: currentModel,
                }
              : undefined,
          },
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // 检查是否应该降级
        if (this.shouldFallback(err)) {
          const fallbackModel = this.getFallbackModel(currentModel);
          if (fallbackModel) {
            this.logger.warn(
              `⚠️ [FALLBACK] Image blend failed with ${currentModel}, falling back to ${fallbackModel}. Error: ${err.message}`
            );
            currentModel = fallbackModel;
            usedFallback = true;
            continue; // 重试使用降级模型
          }
        }

        // 无法降级或降级后仍然失败
        this.logger.error("Image blend failed:", error);
        return {
          success: false,
          error: {
            code: "BLEND_FAILED",
            message: err.message,
            details: error,
          },
        };
      }
    }

    // 不应该到达这里，但为了类型安全
    return {
      success: false,
      error: {
        code: "BLEND_FAILED",
        message: "Unexpected error in image blend",
      },
    };
  }

  async analyzeImage(
    request: ImageAnalysisRequest
  ): Promise<AIProviderResponse<AnalysisResult>> {
    this.logger.log(`🔍 Analyzing file with Banana (147) API...`);

    try {
      // 使用异步版本支持 HTTP URL
      const { data: fileData, mimeType } = await this.normalizeFileInputAsync(
        request.sourceImage,
        "analysis"
      );
      // 🔥 使用 gemini-3-pro-image-preview 进行文件分析
      const model = this.normalizeModelName(
        request.model || "gemini-3-pro-image-preview"
      );
      this.logger.log(`📊 Using model: ${model}, mimeType: ${mimeType}`);

      // 根据文件类型生成不同的提示词
      const isPdf = mimeType === "application/pdf";
      const fileTypeDesc = isPdf ? "PDF document" : "image";

      const analysisPrompt = request.prompt
        ? `Please analyze the following ${fileTypeDesc} (respond in ${request.prompt})`
        : `Please analyze this ${fileTypeDesc} in detail`;

      const result = await this.withRetry(
        () =>
          this.withTimeout(
            (async () => {
              return await this.makeRequest(
                model,
                [
                  { text: analysisPrompt },
                  {
                    inlineData: {
                      mimeType,
                      data: fileData,
                    },
                  },
                ],
                {}
              );
            })(),
            this.DEFAULT_TIMEOUT,
            "File analysis"
          ),
        "File analysis",
        2
      );

      this.logger.log(
        `✅ File analysis succeeded: ${result.textResponse.length} characters`
      );

      return {
        success: true,
        data: {
          text: result.textResponse,
          tags: [],
        },
      };
    } catch (error) {
      this.logger.error("❌ File analysis failed:", error);
      return {
        success: false,
        error: {
          code: "ANALYSIS_FAILED",
          message:
            error instanceof Error ? error.message : "Failed to analyze file",
          details: error,
        },
      };
    }
  }

  async generateText(
    request: TextChatRequest
  ): Promise<AIProviderResponse<TextResult>> {
    this.logger.log(`🤖 Generating text response using Banana (147) API...`);

    // 文本生成默认使用 gemini-3-flash-preview，如果指定了 Pro 模型则使用降级策略
    const originalModel = this.normalizeModelName(
      request.model || "gemini-3-flash-preview"
    );
    let currentModel = originalModel;
    let usedFallback = false;

    // 尝试使用主模型，失败后降级
    for (let round = 0; round < this.MAX_MODEL_ATTEMPTS; round++) {
      try {
        this.logger.log(
          `📝 Using model: ${currentModel}${usedFallback ? " (fallback)" : ""}`
        );

        const apiConfig: any = {
          responseModalities: ["Text"],
        };

        if (request.enableWebSearch) {
          apiConfig.tools = [{ googleSearch: {} }];
          this.logger.log("🔍 Web search enabled");
        }

        const result = await this.withRetry(async () => {
          return await this.withTimeout(
            (async () => {
              return await this.makeRequest(
                currentModel,
                request.prompt,
                apiConfig
              );
            })(),
            this.DEFAULT_TIMEOUT,
            "Text generation"
          );
        }, "Text generation");

        if (usedFallback) {
          this.logger.log(
            `🔄 [FALLBACK SUCCESS] Text generation succeeded with fallback model: ${currentModel}`
          );
        } else {
          this.logger.log(
            `✅ Text generation succeeded with ${result.textResponse.length} characters`
          );
        }

        return {
          success: true,
          data: {
            text: result.textResponse,
            metadata: usedFallback
              ? {
                  fallbackUsed: true,
                  originalModel,
                  fallbackModel: currentModel,
                }
              : undefined,
          },
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // 检查是否应该降级
        if (this.shouldFallback(err)) {
          const fallbackModel = this.getFallbackModel(currentModel);
          if (fallbackModel) {
            this.logger.warn(
              `⚠️ [FALLBACK] Text generation failed with ${currentModel}, falling back to ${fallbackModel}. Error: ${err.message}`
            );
            currentModel = fallbackModel;
            usedFallback = true;
            continue; // 重试使用降级模型
          }
        }

        // 无法降级或降级后仍然失败
        this.logger.error("❌ Text generation failed:", error);
        return {
          success: false,
          error: {
            code: "TEXT_GENERATION_FAILED",
            message: err.message,
            details: error,
          },
        };
      }
    }

    // 不应该到达这里，但为了类型安全
    return {
      success: false,
      error: {
        code: "TEXT_GENERATION_FAILED",
        message: "Unexpected error in text generation",
      },
    };
  }

  private sanitizeAvailableTools(
    tools?: string[],
    allowVector: boolean = true
  ): string[] {
    const base =
      Array.isArray(tools) && tools.length ? tools : [...DEFAULT_TOOLS];
    const unique = Array.from(new Set(base.filter(Boolean)));
    const filtered = allowVector
      ? unique
      : unique.filter((tool) => tool !== "generatePaperJS");

    if (filtered.length > 0) {
      return filtered;
    }

    return allowVector
      ? [...DEFAULT_TOOLS]
      : [...DEFAULT_TOOLS.filter((tool) => tool !== "generatePaperJS")];
  }

  private hasVectorIntent(prompt: string): boolean {
    if (!prompt) return false;
    const lower = prompt.toLowerCase();
    return VECTOR_KEYWORDS.some((keyword) =>
      lower.includes(keyword.toLowerCase())
    );
  }

  private formatToolList(tools: string[]): string {
    return tools
      .map((tool) => `- ${tool}: ${TOOL_DESCRIPTIONS[tool] || "辅助对话"}`)
      .join("\n");
  }

  async selectTool(
    request: ToolSelectionRequest
  ): Promise<AIProviderResponse<ToolSelectionResult>> {
    this.logger.log(
      "🎯 Selecting tool with Banana (147) API using gemini-3-flash-preview..."
    );

    try {
      const maxAttempts = 3;
      const delayMs = 1000;
      let lastError: unknown;

      const hasVectorIntent = this.hasVectorIntent(request.prompt);
      const tools = this.sanitizeAvailableTools(
        request.availableTools,
        hasVectorIntent
      );
      const toolListText = this.formatToolList(tools);
      const vectorRule = tools.includes("generatePaperJS")
        ? `只有当用户明确提到以下关键词之一（${VECTOR_KEYWORDS.join(
            ", "
          )}）或直接要求输出 SVG/Paper.js 矢量代码时，才选择 generatePaperJS；仅描述形状、几何或线条但未出现这些关键词时，不要选择 generatePaperJS，优先 generateImage 或 chatResponse。`
        : "";

      const systemPrompt = `你是一个AI助手工具选择器。根据用户的输入，选择最合适的工具执行。

可用工具:
${toolListText}

${
  vectorRule ? `${vectorRule}\n\n` : ""
}请根据用户的实际需求，智能判断最合适的工具。例如：
- 用户明确提到“矢量”“vector”“svg”“paperjs”等关键词，或要求输出矢量代码 → generatePaperJS
- 用户要求生成图像、照片、画作等 → generateImage
- 用户要求编辑、修改现有图像 → editImage
- 用户要求融合、混合多张图像 → blendImages
- 用户要求分析、识别图像内容 → analyzeImage
- 用户要求生成视频 → generateVideo
- 其他对话、提问、讨论 → chatResponse

请以以下JSON格式回复（仅返回JSON，不要其他文字）:
{
  "selectedTool": "工具名称",
  "reasoning": "选择理由",
  "confidence": 0.0-1.0
}`;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          // 使用与基础版完全相同的调用方式：两条独立的 contents
          const result = await this.makeRequest(
            "gemini-3-flash-preview",
            [{ text: systemPrompt }, { text: `用户输入: ${request.prompt}` }],
            { responseModalities: ["Text"] }
          );

          if (!result.textResponse) {
            this.logger.warn("Tool selection response did not contain text.");
            throw new Error("Empty response");
          }

          // 解析AI的JSON响应 - 与基础版逻辑一致
          try {
            const parsed = parseToolSelectionJson(result.textResponse);

            if (!parsed || typeof parsed !== "object") {
              throw new Error("Invalid tool selection JSON");
            }

            const rawSelected =
              typeof parsed.selectedTool === "string"
                ? parsed.selectedTool
                : "chatResponse";
            const selectedTool = tools.includes(rawSelected)
              ? rawSelected
              : tools.includes("chatResponse")
              ? "chatResponse"
              : tools[0];

            this.logger.log(`✅ Tool selected: ${selectedTool}`, {
              hasVectorIntent,
            });

            return {
              success: true,
              data: {
                selectedTool,
                reasoning:
                  typeof parsed.reasoning === "string"
                    ? parsed.reasoning
                    : TOOL_DESCRIPTIONS[selectedTool] || "自动选择最合适的工具。",
                confidence:
                  typeof parsed.confidence === "number"
                    ? parsed.confidence
                    : 0.85,
              },
            };
          } catch (parseError) {
            this.logger.warn(
              `Failed to parse tool selection JSON: ${result.textResponse}`
            );
            // 降级：如果解析失败，默认返回文本对话
            return {
              success: true,
              data: {
                selectedTool: tools.includes("chatResponse")
                  ? "chatResponse"
                  : tools[0],
                reasoning: "Fallback due to invalid JSON response",
                confidence: 0.5,
              },
            };
          }
        } catch (error) {
          lastError = error;
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Tool selection attempt ${attempt}/${maxAttempts} failed: ${message}`
          );
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }

      const message =
        lastError instanceof Error
          ? lastError.message
          : "Unknown error occurred during tool selection.";
      this.logger.error(`All tool selection attempts failed: ${message}`);

      // 最后的降级方案：返回文本对话
      return {
        success: true,
        data: {
          selectedTool: tools.includes("chatResponse")
            ? "chatResponse"
            : tools[0],
          reasoning: "Fallback due to repeated failures",
          confidence: 0.4,
        },
      };
    } catch (error) {
      this.logger.error("❌ Tool selection failed:", error);
      return {
        success: false,
        error: {
          code: "TOOL_SELECTION_FAILED",
          message:
            error instanceof Error ? error.message : "Failed to select tool",
          details: error,
        },
      };
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  getProviderInfo() {
    return {
      name: "Banana API",
      version: "1.0",
      supportedModels: [
        "gemini-3-pro-image-preview",
        "gemini-3.1-flash-image-preview",
        "gemini-3-flash-preview",
      ],
    };
  }

  async img2Vector(request: {
    sourceImage: string;
    prompt?: string;
    model?: string;
    thinkingLevel?: "high" | "low";
    canvasWidth?: number;
    canvasHeight?: number;
    style?: "simple" | "detailed" | "artistic";
  }): Promise<
    AIProviderResponse<{
      code: string;
      imageAnalysis: string;
      explanation?: string;
      model: string;
    }>
  > {
    this.logger.log("🖼️ Converting image to vector with Banana (147) API...");

    try {
      // 使用异步版本支持 HTTP URL
      const { data: sourceData, mimeType } = await this.normalizeFileInputAsync(
        request.sourceImage,
        "analysis"
      );
      const originalModel = this.normalizeModelName(
        request.model || "gemini-3-flash-preview"
      );
      let currentModel = originalModel;
      let usedFallback = false;

      // 尝试主模型，失败时按降级模型重试
      for (let round = 0; round < this.MAX_MODEL_ATTEMPTS; round++) {
        try {
          this.logger.debug(
            `Using model: ${currentModel}${usedFallback ? " (fallback)" : ""}`
          );

          // Step 1: 图像分析
          const analysisPrompt = `请详细分析这个图像，并用中文描述以下内容（用于生成矢量图）：
1. 主要形状和轮廓
2. 颜色和配色方案
3. 结构和布局
4. 风格特征
5. 关键细节和元素

${request.prompt ? `额外要求：${request.prompt}` : ""}`;

          const analysisResult = await this.withRetry(
            () =>
              this.withTimeout(
                this.makeRequest(
                  currentModel,
                  [
                    { text: analysisPrompt },
                    {
                      inlineData: {
                        mimeType,
                        data: sourceData,
                      },
                    },
                  ],
                  { responseModalities: ["Text"] }
                ),
                this.DEFAULT_TIMEOUT,
                "Image analysis for img2vector"
              ),
            "Image analysis for img2vector"
          );

          const imageAnalysis = analysisResult.textResponse?.trim();
          if (!imageAnalysis) {
            throw new Error("Image analysis returned empty response");
          }

          // Step 2: 生成 Paper.js 代码
          const styleGuide = this.getStyleGuide(request.style || "detailed");
          const vectorPrompt = `你是一个paper.js代码专家。根据以下图像分析结果，生成纯净的paper.js矢量代码。

${styleGuide}

图像分析结果：
${imageAnalysis}

要求：
- 只输出纯净的paper.js代码，不要其他解释
- 使用view.center作为中心，围绕中心绘图
- 代码应该能直接执行
- 保留图像的主要特征和风格`;

          const vectorResult = await this.withRetry(
            () =>
              this.withTimeout(
                this.makeRequest(currentModel, [{ text: vectorPrompt }], {
                  responseModalities: ["Text"],
                  ...(request.thinkingLevel && !usedFallback
                    ? { thinking_level: request.thinkingLevel }
                    : {}),
                }),
                this.DEFAULT_TIMEOUT,
                "Paper.js code generation from img2vector"
              ),
            "Paper.js code generation from img2vector"
          );

          if (!vectorResult.textResponse) {
            throw new Error("No code response from API");
          }

          const cleanedCode = this.cleanCodeResponse(vectorResult.textResponse);

          if (usedFallback) {
            this.logger.log(
              `🔄 [FALLBACK SUCCESS] img2vector succeeded with fallback model: ${currentModel}`
            );
          } else {
            this.logger.log("✅ img2vector conversion succeeded");
          }

          return {
            success: true,
            data: {
              code: cleanedCode,
              imageAnalysis,
              explanation: "矢量图已根据图像分析结果生成",
              model: currentModel,
            },
          };
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));

          if (this.shouldFallback(err)) {
            const fallbackModel = this.getFallbackModel(currentModel);
            if (fallbackModel) {
              this.logger.warn(
                `⚠️ [FALLBACK] img2vector failed with ${currentModel}, falling back to ${fallbackModel}. Error: ${err.message}`
              );
              currentModel = fallbackModel;
              usedFallback = true;
              continue; // 重试降级模型
            }
          }

          this.logger.error("❌ img2vector conversion failed:", error);
          return {
            success: false,
            error: {
              code: "IMG2VECTOR_FAILED",
              message: err.message,
              details: error,
            },
          };
        }
      }

      // 不应该到这里，为类型安全保底
      return {
        success: false,
        error: {
          code: "IMG2VECTOR_FAILED",
          message: "Unexpected error in img2vector",
        },
      };
    } catch (error) {
      this.logger.error("❌ img2vector conversion failed:", error);
      return {
        success: false,
        error: {
          code: "IMG2VECTOR_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Failed to convert image to vector",
          details: error,
        },
      };
    }
  }

  private getStyleGuide(style: "simple" | "detailed" | "artistic"): string {
    const guides = {
      simple: `风格指南：简洁风格
- 使用基本形状（圆形、矩形、线条）
- 最少化细节
- 清晰的轮廓
- 适合图标或简化设计`,
      detailed: `风格指南：详细风格
- 保留大部分细节
- 使用多个图层和形状
- 精确的比例和位置
- 适合精确的矢量表现`,
      artistic: `风格指南：艺术风格
- 创意解释和变形
- 使用渐变和复杂形状
- 强调美学效果
- 适合艺术和创意表现`,
    };
    return guides[style];
  }

  /**
   * 清理代码响应，移除 markdown 代码块包装
   */
  private cleanCodeResponse(text: string): string {
    let cleaned = text.trim();

    // 移除 markdown 代码块
    if (cleaned.startsWith("```")) {
      // 匹配 ```javascript, ```js, ```paperjs 等
      cleaned = cleaned.replace(/^```(?:javascript|js|paperjs)?\s*/i, "");
      cleaned = cleaned.replace(/\s*```$/i, "");
    }

    // 再次清理，以防多层包装
    cleaned = cleaned.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:javascript|js|paperjs)?\s*/i, "");
      cleaned = cleaned.replace(/\s*```$/i, "");
    }

    return cleaned.trim();
  }

  async generatePaperJS(
    request: PaperJSGenerateRequest
  ): Promise<AIProviderResponse<PaperJSResult>> {
    this.logger.log(`📐 Generating Paper.js code using Banana (147) API...`);

    // 系统提示词
    const systemPrompt = `你是一个paper.js代码专家，请根据我的需求帮我生成纯净的paper.js代码，不用其他解释或无效代码，确保使用view.center作为中心，并围绕中心绘图`;

    // 将系统提示词和用户输入拼接
    const finalPrompt = `${systemPrompt}\n\n${request.prompt}`;

    const originalModel = this.normalizeModelName(
      request.model || "gemini-3-flash-preview"
    );
    let currentModel = originalModel;
    let usedFallback = false;

    // 尝试使用主模型，失败后降级
    for (let round = 0; round < this.MAX_MODEL_ATTEMPTS; round++) {
      try {
        this.logger.log(
          `📝 Using model: ${currentModel}${usedFallback ? " (fallback)" : ""}`
        );

        const apiConfig: any = {
          responseModalities: ["Text"],
        };

        // 配置 thinking_level（Gemini 3 特性，降级后不使用）
        if (request.thinkingLevel && !usedFallback) {
          apiConfig.thinking_level = request.thinkingLevel;
        }

        const result = await this.withRetry(async () => {
          return await this.withTimeout(
            (async () => {
              return await this.makeRequest(
                currentModel,
                finalPrompt,
                apiConfig
              );
            })(),
            this.DEFAULT_TIMEOUT,
            "Paper.js code generation"
          );
        }, "Paper.js code generation");

        if (!result.textResponse) {
          throw new Error("No code response from API");
        }

        // 清理响应，移除 markdown 代码块包装
        const cleanedCode = this.cleanCodeResponse(result.textResponse);

        if (usedFallback) {
          this.logger.log(
            `🔄 [FALLBACK SUCCESS] Paper.js code generation succeeded with fallback model: ${currentModel}`
          );
        } else {
          this.logger.log(
            `✅ Paper.js code generation succeeded with ${cleanedCode.length} characters`
          );
        }

        return {
          success: true,
          data: {
            code: cleanedCode,
            metadata: usedFallback
              ? {
                  fallbackUsed: true,
                  originalModel,
                  fallbackModel: currentModel,
                }
              : undefined,
          },
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // 检查是否应该降级
        if (this.shouldFallback(err)) {
          const fallbackModel = this.getFallbackModel(currentModel);
          if (fallbackModel) {
            this.logger.warn(
              `⚠️ [FALLBACK] Paper.js code generation failed with ${currentModel}, falling back to ${fallbackModel}. Error: ${err.message}`
            );
            currentModel = fallbackModel;
            usedFallback = true;
            continue; // 重试使用降级模型
          }
        }

        // 无法降级或降级后仍然失败
        this.logger.error("❌ Paper.js code generation failed:", error);
        return {
          success: false,
          error: {
            code: "PAPERJS_GENERATION_FAILED",
            message: err.message,
            details: error,
          },
        };
      }
    }

    // 不应该到达这里，但为了类型安全
    return {
      success: false,
      error: {
        code: "PAPERJS_GENERATION_FAILED",
        message: "Unexpected error in Paper.js code generation",
      },
    };
  }
}
