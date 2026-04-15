import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
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
  ProviderOptionsPayload,
  BananaImageRoute,
} from "./ai-provider.interface";
import { parseToolSelectionJson } from "../tool-selection-json.util";
import { TencentVodAigcService } from "../services/tencent-vod-aigc.service";

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

export type BananaImageProvider =
  | "auto"
  | "legacy_auto"
  | "tencent_auto"
  | "apimart"
  | "tencent"
  | "legacy";
export const BANANA_PROVIDER_SETTING_KEY = "banana_provider";
export type BananaTextProvider =
  | "auto"
  | "legacy_auto"
  | "apimart"
  | "legacy";
export const BANANA_TEXT_PROVIDER_SETTING_KEY = "banana_text_provider";

/**
 * Banana API Provider - 使用HTTP直接调用Google Gemini API的代理
 * 文档: https://147api.apifox.cn/
 * API地址: https://147ai.com/v1beta/models
 */
@Injectable()
export class BananaProvider implements IAIProvider {
  private readonly logger = new Logger(BananaProvider.name);
  private apiKey: string | null = null; // 147 legacy key
  private apimartApiKey: string | null = null;
  private readonly apiBaseUrl = "https://api1.147ai.com/v1beta/models";
  private readonly apimartGenerateUrl = "https://api.apimart.ai/v1/images/generations";
  private readonly apimartTaskBaseUrl = "https://api.apimart.ai/v1/tasks";
  private readonly apimartTextUrl = "https://api.apimart.ai/v1/chat/completions";
  private readonly DEFAULT_MODEL = "gemini-3-pro-image-preview";
  private readonly DEFAULT_TEXT_MODEL = "gemini-3.1-pro";
  private readonly DEFAULT_APIMART_TEXT_MODEL = "gemini-3-flash-preview";
  private readonly DEFAULT_TIMEOUT = 300000; // 5分钟
  private readonly TEXT_TIMEOUT = 45000; // 文本接口更快失败，便于通道快速切换
  private readonly MAX_RETRIES = 3;
  private readonly MAX_MODEL_ATTEMPTS = 3; // 主模型 + 两级降级（Ultra -> Pro -> Fast）
  private readonly RETRY_DELAYS = [2000, 5000, 10000]; // 递增延迟: 2s, 5s, 10s
  private readonly APIMART_INITIAL_DELAY_MS = 8000;
  private readonly APIMART_POLL_INTERVAL_MS = 3000;
  private readonly APIMART_POLL_MAX_ATTEMPTS = 120;

  // 降级模型映射：优先同代/同能力降级，再降到更保守模型
  private readonly FALLBACK_MODELS: Record<string, string> = {
    "gemini-3.1-pro": "gemini-3-pro-image-preview",
    "banana-gemini-3.1-pro": "gemini-3-pro-image-preview",
    "gemini-3-pro-image-preview": "gemini-2.5-flash-image",
    "gemini-3.1-flash-image-preview": "gemini-3-pro-image-preview",
    "banana-gemini-3.1-flash-image-preview": "gemini-3-pro-image-preview",
    "gemini-3-pro-preview": "gemini-3-flash-preview",
    "banana-gemini-3-pro-preview": "gemini-3-flash-preview",
    "banana-gemini-3-pro-image-preview": "gemini-2.5-flash-image",
    "gemini-3-flash-preview-apimart": "gemini-3-flash-preview",
  };

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tencentVodAigcService: TencentVodAigcService
  ) {}

  async initialize(): Promise<void> {
    this.apiKey = this.config.get<string>("BANANA_API_KEY") ?? null;
    this.apimartApiKey = this.config.get<string>("NANO2_API_KEY") ?? null;

    const tencentReady = this.tencentVodAigcService.isAvailable();

    if (!this.apiKey && !this.apimartApiKey && !tencentReady) {
      this.logger.warn("Banana API keys not configured.");
      return;
    }

    this.logger.log(
      `Banana provider initialized (legacy=${!!this.apiKey}, apimart=${!!this.apimartApiKey}, tencent=${tencentReady})`
    );
  }

  private ensureApiKey(): string {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        "147 API key not configured on the server."
      );
    }
    return this.apiKey;
  }

  private ensureApimartApiKey(): string {
    if (!this.apimartApiKey) {
      throw new ServiceUnavailableException(
        "Apimart API key not configured on the server."
      );
    }
    return this.apimartApiKey;
  }

  private getUserBananaImageRoute(
    providerOptions?: ProviderOptionsPayload
  ): BananaImageRoute | null {
    const nestedRoute =
      typeof providerOptions?.banana?.imageRoute === "string"
        ? providerOptions.banana.imageRoute.trim().toLowerCase()
        : "";
    if (nestedRoute === "normal" || nestedRoute === "stable") {
      return nestedRoute as BananaImageRoute;
    }

    const legacyRoute =
      typeof (providerOptions as Record<string, unknown> | undefined)?.[
        "bananaImageRoute"
      ] === "string"
        ? String(
            (providerOptions as Record<string, unknown>)["bananaImageRoute"]
          )
            .trim()
            .toLowerCase()
        : "";
    if (legacyRoute === "normal" || legacyRoute === "stable") {
      return legacyRoute as BananaImageRoute;
    }

    return null;
  }

  private mapUserBananaRouteToProvider(
    route: BananaImageRoute
  ): BananaImageProvider {
    return route === "stable" ? "tencent" : "legacy";
  }

  private async getConfiguredImageProvider(
    providerOptions?: ProviderOptionsPayload
  ): Promise<BananaImageProvider> {
    const userRoute = this.getUserBananaImageRoute(providerOptions);
    if (userRoute) {
      return this.mapUserBananaRouteToProvider(userRoute);
    }

    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: BANANA_PROVIDER_SETTING_KEY },
      });
      if (
        setting &&
        ["auto", "legacy_auto", "tencent_auto", "apimart", "tencent", "legacy"].includes(
          setting.value
        )
      ) {
        return setting.value as BananaImageProvider;
      }
    } catch (error) {
      this.logger.warn(
        `读取 banana provider 设置失败: ${
          error instanceof Error ? error.message : error
        }`
      );
    }
    return "auto";
  }

  private async getConfiguredTextProvider(): Promise<BananaTextProvider> {
    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: BANANA_TEXT_PROVIDER_SETTING_KEY },
      });
      if (
        setting &&
        ["auto", "legacy_auto", "apimart", "legacy"].includes(setting.value)
      ) {
        return setting.value as BananaTextProvider;
      }
    } catch (error) {
      this.logger.warn(
        `读取 banana text provider 设置失败: ${
          error instanceof Error ? error.message : error
        }`
      );
    }
    return "auto";
  }

  private normalizeModelName(model: string): string {
    // 移除banana-前缀，确保API能识别模型名称
    // banana-gemini-3-pro-image-preview -> gemini-3-pro-image-preview
    return model.startsWith("banana-") ? model.substring(7) : model;
  }

  private normalizeLegacyImageModel(model: string): string {
    const normalized = this.normalizeModelName(model);
    if (normalized === "gemini-2.5-flash-image-preview") {
      return "gemini-2.5-flash-image";
    }
    return normalized;
  }

  private normalizeApimartImageModel(model: string): string {
    const normalized = this.normalizeModelName(model);
    if (normalized === "gemini-2.5-flash-image") {
      return "gemini-2.5-flash-image-preview";
    }
    return normalized;
  }

  private normalizeLegacyTextModel(model: string): string {
    const normalized = this.normalizeModelName(model);
    if (normalized.endsWith("-apimart")) {
      return normalized.slice(0, -"-apimart".length);
    }
    return normalized;
  }

  private normalizeApimartTextModel(model: string): string {
    const normalized = this.normalizeModelName(model);
    if (normalized === "gemini-3-flash-preview-apimart") {
      return this.DEFAULT_APIMART_TEXT_MODEL;
    }
    if (normalized.endsWith("-apimart")) {
      return normalized.slice(0, -"-apimart".length);
    }
    if (!normalized || normalized === this.DEFAULT_TEXT_MODEL) {
      return this.DEFAULT_APIMART_TEXT_MODEL;
    }
    return normalized;
  }

  private resolveTextModelForChannel(
    requestedModel: string | undefined,
    channel: "legacy" | "apimart"
  ): string {
    if (channel === "apimart") {
      return this.normalizeApimartTextModel(
        requestedModel || this.DEFAULT_APIMART_TEXT_MODEL
      );
    }
    return this.normalizeLegacyTextModel(
      requestedModel || this.DEFAULT_TEXT_MODEL
    );
  }

  private toApimartResolution(imageSize?: ImageGenerationRequest["imageSize"]): "1K" | "2K" | "4K" {
    if (imageSize === "2K") return "2K";
    if (imageSize === "4K") return "4K";
    return "1K";
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

  private isRateLimitedOrQuotaError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes("429") ||
      message.includes("quota exceeded") ||
      message.includes("too many requests") ||
      message.includes("rate limit") ||
      message.includes("quota")
    );
  }

  private isModelUnavailableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes("no available channel for model") ||
      message.includes("model_not_found") ||
      message.includes('"code":"model_not_found"')
    );
  }

  private mapAnalyzeErrorMessage(error: Error, currentModel: string): string {
    if (this.isModelUnavailableError(error)) {
      return `147渠道当前分组未开通模型 ${currentModel}（model_not_found）。请检查147 API Key绑定分组，建议使用 banana 分组。`;
    }
    return error.message;
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
    maxRetries: number = this.MAX_RETRIES,
    shouldRetry?: (error: Error, attempt: number) => boolean
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

        const canRetry = attempt < maxRetries && (shouldRetry ? shouldRetry(lastError, attempt) : true);
        if (canRetry) {
          // 使用递增延迟
          const delay =
            this.RETRY_DELAYS[attempt - 1] ||
            this.RETRY_DELAYS[this.RETRY_DELAYS.length - 1];
          this.logger.warn(
            `${operationType} attempt ${attempt} failed: ${lastError.message}, retrying in ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else if (attempt < maxRetries) {
          this.logger.warn(
            `${operationType} attempt ${attempt} failed: ${lastError.message}, stop retry by policy`
          );
          break;
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

  private normalizeTextContentValue(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return "";
    return String(value);
  }

  private buildApimartChatMessages(contents: any): Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
  }> {
    const normalizedContents = this.buildContents(contents);
    const messages: Array<{
      role: "system" | "user" | "assistant" | "tool";
      content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
    }> = [];

    for (const item of normalizedContents) {
      const roleRaw =
        typeof item?.role === "string" && item.role.trim()
          ? item.role.trim().toLowerCase()
          : "user";
      const role =
        roleRaw === "system" ||
        roleRaw === "assistant" ||
        roleRaw === "tool"
          ? (roleRaw as "system" | "assistant" | "tool")
          : "user";

      const rawParts = Array.isArray(item?.parts) ? item.parts : [];
      const transformedParts: Array<
        { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
      > = [];

      for (const part of rawParts) {
        if (part && typeof part === "object" && typeof part.text === "string") {
          transformedParts.push({ type: "text", text: part.text });
          continue;
        }

        const inlineData = part && typeof part === "object" ? part.inlineData : null;
        const data = inlineData && typeof inlineData.data === "string" ? inlineData.data.replace(/\s+/g, "") : "";
        if (data) {
          const mimeType =
            inlineData && typeof inlineData.mimeType === "string"
              ? inlineData.mimeType
              : this.inferMimeTypeFromBase64(data);
          transformedParts.push({
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${data}`,
            },
          });
          continue;
        }

        const fileData = part && typeof part === "object" ? part.fileData : null;
        if (fileData && typeof fileData.uri === "string" && fileData.uri.trim()) {
          transformedParts.push({
            type: "image_url",
            image_url: { url: fileData.uri.trim() },
          });
          continue;
        }

        if (part !== null && part !== undefined) {
          transformedParts.push({
            type: "text",
            text: this.normalizeTextContentValue(part),
          });
        }
      }

      if (!transformedParts.length) {
        transformedParts.push({ type: "text", text: "" });
      }

      if (transformedParts.length === 1 && transformedParts[0].type === "text") {
        messages.push({
          role,
          content: transformedParts[0].text,
        });
      } else {
        messages.push({
          role,
          content: transformedParts,
        });
      }
    }

    if (!messages.length) {
      messages.push({ role: "user", content: "" });
    }

    return messages;
  }

  private extractTextFromApimartMessageContent(content: unknown): string {
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as any).text === "string") {
          return (part as any).text;
        }
        return "";
      })
      .join("")
      .trim();
  }

  private async makeApimartTextRequest(
    model: string,
    contents: any,
    _config?: any
  ): Promise<{ imageBytes: string | null; textResponse: string }> {
    const apiKey = this.ensureApimartApiKey();
    const payload = {
      model,
      stream: false,
      messages: this.buildApimartChatMessages(contents),
    };

    const response = await fetch(this.apimartTextUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let parsed: any = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const message =
        parsed?.error?.message ||
        parsed?.message ||
        rawText ||
        `HTTP ${response.status}`;
      throw new Error(
        `Apimart text request failed: ${response.status} ${response.statusText} - ${message}`
      );
    }

    const data = parsed?.data ?? parsed;
    const textResponse = this.extractTextFromApimartMessageContent(
      data?.choices?.[0]?.message?.content
    );
    if (!textResponse) {
      throw new Error("Apimart text response was empty");
    }
    return {
      imageBytes: null,
      textResponse,
    };
  }

  private async makeTextRequest(
    model: string,
    contents: any,
    config: any,
    channel: "legacy" | "apimart"
  ): Promise<{ imageBytes: string | null; textResponse: string }> {
    if (channel === "apimart") {
      return this.makeApimartTextRequest(model, contents, config);
    }
    return this.makeRequest(model, contents, config);
  }

  private async submitApimartTask(payload: Record<string, any>): Promise<string> {
    const apiKey = this.ensureApimartApiKey();
    const response = await fetch(this.apimartGenerateUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(
        `Apimart submit failed: ${response.status} ${response.statusText} - ${errorData}`
      );
    }

    const data = (await response.json()) as any;
    const taskId = data?.data?.[0]?.task_id || data?.data?.task_id;
    if (!taskId) {
      throw new Error("Apimart submit response missing task_id");
    }
    return taskId;
  }

  private extractApimartImageUrl(taskPayload: any): string | undefined {
    const data = taskPayload?.data ?? taskPayload;
    const directCandidates = [
      data?.image_url,
      data?.imageUrl,
      data?.result?.image_url,
      data?.result?.imageUrl,
    ];
    for (const candidate of directCandidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    const images = data?.result?.images;
    if (Array.isArray(images) && images.length > 0) {
      const first = images[0];
      const urlField = first?.url;
      if (typeof urlField === "string" && urlField.trim().length > 0) {
        return urlField.trim();
      }
      if (Array.isArray(urlField) && typeof urlField[0] === "string") {
        return urlField[0].trim();
      }
    }

    return undefined;
  }

  private async queryApimartTask(taskId: string): Promise<{ status: string; imageUrl?: string }> {
    const apiKey = this.ensureApimartApiKey();
    const response = await fetch(`${this.apimartTaskBaseUrl}/${taskId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Apimart task query failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as any;
    const payload = data?.data ?? data;
    const statusRaw = payload?.status ?? "processing";
    const status = typeof statusRaw === "string" ? statusRaw.toLowerCase() : "processing";
    const imageUrl = this.extractApimartImageUrl(data);
    return { status, imageUrl };
  }

  private async waitForApimartTask(
    taskId: string
  ): Promise<{ imageUrl: string }> {
    await new Promise((resolve) => setTimeout(resolve, this.APIMART_INITIAL_DELAY_MS));

    for (let attempt = 1; attempt <= this.APIMART_POLL_MAX_ATTEMPTS; attempt++) {
      const result = await this.queryApimartTask(taskId);
      const status = result.status;

      if (status === "succeeded" || status === "completed" || status === "success") {
        if (result.imageUrl) {
          return { imageUrl: result.imageUrl };
        }
        throw new Error(`Apimart task ${taskId} completed but image url missing`);
      }

      if (status === "failed" || status === "error" || status === "cancelled") {
        throw new Error(`Apimart task ${taskId} failed with status: ${status}`);
      }

      await new Promise((resolve) =>
        setTimeout(resolve, this.APIMART_POLL_INTERVAL_MS)
      );
    }

    throw new Error(`Apimart task ${taskId} polling timeout`);
  }

  private async toApimartImageUrls(sourceImages: string[]): Promise<string[]> {
    const normalized = await Promise.all(
      sourceImages.map((source, index) =>
        this.normalizeFileInputAsync(source, `apimart source #${index + 1}`)
      )
    );
    return normalized.map((item) => `data:${item.mimeType};base64,${item.data}`);
  }

  private buildApimartError(code: string, error: unknown): AIProviderResponse<ImageResult> {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: {
        code,
        message,
        details: error,
      },
    };
  }

  private async generateImageViaApimart(
    request: ImageGenerationRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    const model = this.normalizeApimartImageModel(request.model || this.DEFAULT_MODEL);
    const resolution = this.toApimartResolution(request.imageSize);
    const payload: Record<string, any> = {
      model,
      prompt: request.prompt,
      size: request.aspectRatio || "16:9",
      n: 1,
      resolution,
    };

    if (Array.isArray(request.imageUrls) && request.imageUrls.length > 0) {
      payload.image_urls = request.imageUrls;
    }

    if (request.googleSearch || request.enableWebSearch) {
      payload.google_search = true;
    }
    if (request.googleImageSearch) {
      payload.google_image_search = true;
    }

    if (model.includes("2.5") && resolution !== "1K") {
      this.logger.warn(
        `[BananaProvider] ${model} may not support ${resolution}, forcing 1K for compatibility`
      );
      payload.resolution = "1K";
    }

    const taskId = await this.submitApimartTask(payload);
    const { imageUrl } = await this.waitForApimartTask(taskId);
    return {
      success: true,
      data: {
        imageUrl,
        textResponse: "Image generated successfully",
        hasImage: true,
        metadata: {
          taskId,
          provider: "apimart",
          model,
          resolution: payload.resolution,
          webSearchEnabled: Boolean(
            request.enableWebSearch ||
            request.googleSearch ||
            request.googleImageSearch
          ),
          googleSearchEnabled: Boolean(
            request.enableWebSearch || request.googleSearch
          ),
          googleImageSearchEnabled: Boolean(request.googleImageSearch),
        },
      },
    };
  }

  private async editImageViaApimart(
    request: ImageEditRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    const model = this.normalizeApimartImageModel(request.model || this.DEFAULT_MODEL);
    const resolution = this.toApimartResolution(request.imageSize);
    const imageUrls = await this.toApimartImageUrls([request.sourceImage]);
    const payload: Record<string, any> = {
      model,
      prompt: request.prompt,
      size: request.aspectRatio || "16:9",
      n: 1,
      resolution,
      image_urls: imageUrls,
    };

    if (model.includes("2.5") && resolution !== "1K") {
      payload.resolution = "1K";
    }

    const taskId = await this.submitApimartTask(payload);
    const { imageUrl } = await this.waitForApimartTask(taskId);
    return {
      success: true,
      data: {
        imageUrl,
        textResponse: "Image edited successfully",
        hasImage: true,
        metadata: {
          taskId,
          provider: "apimart",
          model,
          resolution: payload.resolution,
        },
      },
    };
  }

  private async blendImagesViaApimart(
    request: ImageBlendRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    const model = this.normalizeApimartImageModel(request.model || this.DEFAULT_MODEL);
    const resolution = this.toApimartResolution(request.imageSize);
    const imageUrls = await this.toApimartImageUrls(request.sourceImages);
    const payload: Record<string, any> = {
      model,
      prompt: request.prompt,
      size: request.aspectRatio || "16:9",
      n: 1,
      resolution,
      image_urls: imageUrls,
    };

    if (model.includes("2.5") && resolution !== "1K") {
      payload.resolution = "1K";
    }

    const taskId = await this.submitApimartTask(payload);
    const { imageUrl } = await this.waitForApimartTask(taskId);
    return {
      success: true,
      data: {
        imageUrl,
        textResponse: "Image blended successfully",
        hasImage: true,
        metadata: {
          taskId,
          provider: "apimart",
          model,
          resolution: payload.resolution,
        },
      },
    };
  }

  private getProviderFailureMessage(
    result: AIProviderResponse<any> | null,
    error: unknown
  ): string {
    if (result?.error?.message) return result.error.message;
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    return "unknown error";
  }

  private resolveTencentImageModel(model?: string): {
    modelName: string;
    modelVersion: string;
    sourceModel: string;
  } {
    const sourceModel = this.normalizeModelName(model || this.DEFAULT_MODEL);
    const normalized = sourceModel.toLowerCase();

    if (normalized.includes("ultra")) {
      return { modelName: "GG", modelVersion: "3.1", sourceModel };
    }
    if (normalized.includes("fast")) {
      return { modelName: "GG", modelVersion: "2.5", sourceModel };
    }
    if (normalized.includes("pro")) {
      return { modelName: "GG", modelVersion: "3.0", sourceModel };
    }

    if (normalized.includes("2.5")) {
      return { modelName: "GG", modelVersion: "2.5", sourceModel };
    }
    if (normalized.includes("3.1")) {
      return { modelName: "GG", modelVersion: "3.1", sourceModel };
    }

    return { modelName: "GG", modelVersion: "3.0", sourceModel };
  }

  private toTencentFileInfos(
    imageUrls?: string[]
  ): Array<{ type: "File" | "Url"; fileId?: string; url?: string }> {
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) return [];

    const results: Array<{ type: "File" | "Url"; fileId?: string; url?: string }> = [];
    for (const raw of imageUrls) {
      const value = typeof raw === "string" ? raw.trim() : "";
      if (!value) continue;

      const prefixed = value.match(/^(?:tencent-fileid:|fileid:)(.+)$/i);
      if (prefixed?.[1]) {
        const fileId = prefixed[1].trim();
        if (fileId) {
          results.push({ type: "File", fileId });
          continue;
        }
      }

      if (/^\d{6,}$/.test(value)) {
        results.push({ type: "File", fileId: value });
        continue;
      }

      if (/^https?:\/\//i.test(value)) {
        results.push({ type: "Url", url: value });
      }
    }

    return results;
  }

  private async generateImageViaTencent(
    request: ImageGenerationRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    const hasReferenceImages =
      Array.isArray(request.imageUrls) && request.imageUrls.length > 0;
    const fileInfos = this.toTencentFileInfos(request.imageUrls);
    if (hasReferenceImages && fileInfos.length === 0) {
      return {
        success: false,
        error: {
          code: "GENERATION_FAILED",
          message:
            "Tencent reference images require Tencent FileId or public URL.",
        },
      };
    }

    try {
      const modelConfig = this.resolveTencentImageModel(request.model);
      this.logger.log(
        `[Banana/Image/Tencent] mapped model=${modelConfig.sourceModel} -> ${modelConfig.modelName}/${modelConfig.modelVersion}, refs=${fileInfos.length}`
      );
      const { taskId, requestId } =
        await this.tencentVodAigcService.createImageTask({
          prompt: request.prompt,
          modelName: modelConfig.modelName,
          modelVersion: modelConfig.modelVersion,
          fileInfos,
          aspectRatio: request.aspectRatio,
          imageSize: request.imageSize,
        });

      const taskResult = await this.tencentVodAigcService.waitForImageResult(taskId);
      if (!taskResult.imageUrl) {
        throw new Error(
          `Tencent task ${taskId} completed but image URL is missing.`
        );
      }

      return {
        success: true,
        data: {
          imageUrl: taskResult.imageUrl,
          textResponse: "Image generated successfully",
          hasImage: true,
          metadata: {
            provider: "tencent",
            channel: "tencent_vod_aigc",
            taskId,
            requestId: taskResult.requestId || requestId,
            modelName: modelConfig.modelName,
            modelVersion: modelConfig.modelVersion,
            sourceModel: modelConfig.sourceModel,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "GENERATION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Tencent image generation failed",
          details: error,
        },
      };
    }
  }

  private async editImageViaTencent(
    request: ImageEditRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    try {
      const fileInfos = this.toTencentFileInfos([request.sourceImage]);
      if (fileInfos.length === 0) {
        return {
          success: false,
          error: {
            code: "EDIT_FAILED",
            message:
              "Tencent image edit requires source image as Tencent FileId or public URL.",
          },
        };
      }

      const modelConfig = this.resolveTencentImageModel(request.model);
      this.logger.log(
        `[Banana/Edit/Tencent] mapped model=${modelConfig.sourceModel} -> ${modelConfig.modelName}/${modelConfig.modelVersion}, refs=${fileInfos.length}`
      );
      const { taskId, requestId } =
        await this.tencentVodAigcService.createImageTask({
          prompt: request.prompt,
          modelName: modelConfig.modelName,
          modelVersion: modelConfig.modelVersion,
          fileInfos,
          aspectRatio: request.aspectRatio,
          imageSize: request.imageSize,
        });

      const taskResult = await this.tencentVodAigcService.waitForImageResult(taskId);
      if (!taskResult.imageUrl) {
        throw new Error(
          `Tencent task ${taskId} completed but image URL is missing.`
        );
      }

      return {
        success: true,
        data: {
          imageUrl: taskResult.imageUrl,
          textResponse: "Image edited successfully",
          hasImage: true,
          metadata: {
            provider: "tencent",
            channel: "tencent_vod_aigc",
            taskId,
            requestId: taskResult.requestId || requestId,
            modelName: modelConfig.modelName,
            modelVersion: modelConfig.modelVersion,
            sourceModel: modelConfig.sourceModel,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "EDIT_FAILED",
          message:
            error instanceof Error ? error.message : "Tencent image edit failed",
          details: error,
        },
      };
    }
  }

  private async blendImagesViaTencent(
    request: ImageBlendRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    try {
      const fileInfos = this.toTencentFileInfos(request.sourceImages);
      if (fileInfos.length === 0) {
        return {
          success: false,
          error: {
            code: "BLEND_FAILED",
            message:
              "Tencent image blend requires source images as Tencent FileId or public URL.",
          },
        };
      }

      const modelConfig = this.resolveTencentImageModel(request.model);
      this.logger.log(
        `[Banana/Blend/Tencent] mapped model=${modelConfig.sourceModel} -> ${modelConfig.modelName}/${modelConfig.modelVersion}, refs=${fileInfos.length}`
      );
      const { taskId, requestId } =
        await this.tencentVodAigcService.createImageTask({
          prompt: request.prompt,
          modelName: modelConfig.modelName,
          modelVersion: modelConfig.modelVersion,
          fileInfos,
          aspectRatio: request.aspectRatio,
          imageSize: request.imageSize,
        });

      const taskResult = await this.tencentVodAigcService.waitForImageResult(taskId);
      if (!taskResult.imageUrl) {
        throw new Error(
          `Tencent task ${taskId} completed but image URL is missing.`
        );
      }

      return {
        success: true,
        data: {
          imageUrl: taskResult.imageUrl,
          textResponse: "Image blended successfully",
          hasImage: true,
          metadata: {
            provider: "tencent",
            channel: "tencent_vod_aigc",
            taskId,
            requestId: taskResult.requestId || requestId,
            modelName: modelConfig.modelName,
            modelVersion: modelConfig.modelVersion,
            sourceModel: modelConfig.sourceModel,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "BLEND_FAILED",
          message:
            error instanceof Error ? error.message : "Tencent image blend failed",
          details: error,
        },
      };
    }
  }

  private async generateImageViaLegacy(
    request: ImageGenerationRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    const originalModel = this.normalizeLegacyImageModel(
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

              if (request.enableWebSearch) {
                config.tools = [{ googleSearch: {} }];
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
            metadata: {
              provider: "147",
              channel: "legacy_147",
              ...(usedFallback
                ? {
                    fallbackUsed: true,
                    originalModel,
                    fallbackModel: currentModel,
                  }
                : {}),
              webSearchEnabled: Boolean(
                request.enableWebSearch ||
                request.googleSearch ||
                request.googleImageSearch
              ),
              googleSearchEnabled: Boolean(
                request.enableWebSearch || request.googleSearch
              ),
              googleImageSearchEnabled: Boolean(request.googleImageSearch),
            },
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

  async generateImage(
    request: ImageGenerationRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    this.logger.log(
      `Generating image with prompt: ${request.prompt.substring(0, 50)}...`
    );

    const providerMode = await this.getConfiguredImageProvider(
      request.providerOptions
    );
    this.logger.log(
      `[Banana/Image] mode=${providerMode}, requestedModel=${this.normalizeModelName(
        request.model || this.DEFAULT_MODEL
      )}`
    );

    if (providerMode === "tencent") {
      this.logger.log("[Banana/Image] route -> Tencent (forced)");
      return this.generateImageViaTencent(request);
    }

    if (providerMode === "tencent_auto") {
      let tencentResult: AIProviderResponse<ImageResult> | null = null;
      let tencentError: unknown = null;

      try {
        tencentResult = await this.generateImageViaTencent(request);
      } catch (error) {
        tencentError = error;
      }

      if (tencentResult?.success) {
        this.logger.log("[Banana/Image] route -> Tencent (auto first, success)");
        return tencentResult;
      }

      this.logger.warn(
        `Tencent image generation failed in Tencent-first mode, fallback to Apimart/147: ${this.getProviderFailureMessage(
          tencentResult,
          tencentError
        )}`
      );
    }

    if (providerMode === "legacy_auto") {
      let legacyResult: AIProviderResponse<ImageResult> | null = null;
      let legacyError: unknown = null;

      try {
        legacyResult = await this.generateImageViaLegacy(request);
      } catch (error) {
        legacyError = error;
      }

      if (legacyResult?.success) {
        this.logger.log("[Banana/Image] route -> 147 (147-first, success)");
        return legacyResult;
      }

      this.logger.warn(
        `147 image generation failed in 147-first mode, fallback to Apimart: ${this.getProviderFailureMessage(
          legacyResult,
          legacyError
        )}`
      );
      try {
        return await this.withTimeout(
          this.generateImageViaApimart(request),
          this.DEFAULT_TIMEOUT,
          "Apimart image generation"
        );
      } catch (error) {
        return this.buildApimartError("GENERATION_FAILED", error);
      }
    }

    if (providerMode !== "legacy") {
      try {
        const result = await this.withTimeout(
          this.generateImageViaApimart(request),
          this.DEFAULT_TIMEOUT,
          "Apimart image generation"
        );
        if (result.success) {
          this.logger.log("[Banana/Image] route -> Apimart (success)");
          return result;
        }
        if (providerMode === "apimart") return result;
      } catch (error) {
        if (providerMode === "apimart") {
          return this.buildApimartError("GENERATION_FAILED", error);
        }
        this.logger.warn(
          `Apimart image generation failed in auto mode, fallback to legacy: ${
            error instanceof Error ? error.message : error
          }`
        );
      }
    }

    this.logger.log("[Banana/Image] route -> 147 (final fallback)");
    return this.generateImageViaLegacy(request);
  }

  private async editImageViaLegacy(
    request: ImageEditRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    // 使用异步版本支持 HTTP URL
    const { data: imageData, mimeType } = await this.normalizeFileInputAsync(
      request.sourceImage,
      "edit"
    );
    const originalModel = this.normalizeLegacyImageModel(
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

  async editImage(
    request: ImageEditRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    this.logger.log(
      `Editing image with prompt: ${request.prompt.substring(0, 50)}...`
    );

    const providerMode = await this.getConfiguredImageProvider(
      request.providerOptions
    );
    this.logger.log(
      `[Banana/Edit] mode=${providerMode}, requestedModel=${this.normalizeModelName(
        request.model || this.DEFAULT_MODEL
      )}`
    );

    if (providerMode === "tencent") {
      this.logger.log("[Banana/Edit] route -> Tencent (forced)");
      return this.editImageViaTencent(request);
    }

    if (providerMode === "tencent_auto") {
      let tencentResult: AIProviderResponse<ImageResult> | null = null;
      let tencentError: unknown = null;

      try {
        tencentResult = await this.editImageViaTencent(request);
      } catch (error) {
        tencentError = error;
      }

      if (tencentResult?.success) {
        this.logger.log("[Banana/Edit] route -> Tencent (auto first, success)");
        return tencentResult;
      }

      this.logger.warn(
        `Tencent image edit failed in Tencent-first mode, fallback to Apimart/147: ${this.getProviderFailureMessage(
          tencentResult,
          tencentError
        )}`
      );
    }

    if (providerMode === "legacy_auto") {
      let legacyResult: AIProviderResponse<ImageResult> | null = null;
      let legacyError: unknown = null;

      try {
        legacyResult = await this.editImageViaLegacy(request);
      } catch (error) {
        legacyError = error;
      }

      if (legacyResult?.success) {
        this.logger.log("[Banana/Edit] route -> 147 (147-first, success)");
        return legacyResult;
      }

      this.logger.warn(
        `147 image edit failed in 147-first mode, fallback to Apimart: ${this.getProviderFailureMessage(
          legacyResult,
          legacyError
        )}`
      );
      try {
        return await this.withTimeout(
          this.editImageViaApimart(request),
          this.DEFAULT_TIMEOUT,
          "Apimart image edit"
        );
      } catch (error) {
        return this.buildApimartError("EDIT_FAILED", error);
      }
    }

    if (providerMode !== "legacy") {
      try {
        const result = await this.withTimeout(
          this.editImageViaApimart(request),
          this.DEFAULT_TIMEOUT,
          "Apimart image edit"
        );
        if (result.success) {
          this.logger.log("[Banana/Edit] route -> Apimart (success)");
          return result;
        }
        if (providerMode === "apimart") return result;
      } catch (error) {
        if (providerMode === "apimart") {
          return this.buildApimartError("EDIT_FAILED", error);
        }
        this.logger.warn(
          `Apimart image edit failed in auto mode, fallback to legacy: ${
            error instanceof Error ? error.message : error
          }`
        );
      }
    }

    this.logger.log("[Banana/Edit] route -> 147 (final fallback)");
    return this.editImageViaLegacy(request);
  }

  private async blendImagesViaLegacy(
    request: ImageBlendRequest
  ): Promise<AIProviderResponse<ImageResult>> {
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

    const originalModel = this.normalizeLegacyImageModel(
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

  async blendImages(
    request: ImageBlendRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    this.logger.log(
      `Blending ${
        request.sourceImages.length
      } images with prompt: ${request.prompt.substring(0, 50)}...`
    );

    const providerMode = await this.getConfiguredImageProvider(
      request.providerOptions
    );
    this.logger.log(
      `[Banana/Blend] mode=${providerMode}, requestedModel=${this.normalizeModelName(
        request.model || this.DEFAULT_MODEL
      )}, sources=${request.sourceImages.length}`
    );

    if (providerMode === "tencent") {
      this.logger.log("[Banana/Blend] route -> Tencent (forced)");
      return this.blendImagesViaTencent(request);
    }

    if (providerMode === "tencent_auto") {
      let tencentResult: AIProviderResponse<ImageResult> | null = null;
      let tencentError: unknown = null;

      try {
        tencentResult = await this.blendImagesViaTencent(request);
      } catch (error) {
        tencentError = error;
      }

      if (tencentResult?.success) {
        this.logger.log("[Banana/Blend] route -> Tencent (auto first, success)");
        return tencentResult;
      }

      this.logger.warn(
        `Tencent image blend failed in Tencent-first mode, fallback to Apimart/147: ${this.getProviderFailureMessage(
          tencentResult,
          tencentError
        )}`
      );
    }

    if (providerMode === "legacy_auto") {
      let legacyResult: AIProviderResponse<ImageResult> | null = null;
      let legacyError: unknown = null;

      try {
        legacyResult = await this.blendImagesViaLegacy(request);
      } catch (error) {
        legacyError = error;
      }

      if (legacyResult?.success) {
        this.logger.log("[Banana/Blend] route -> 147 (147-first, success)");
        return legacyResult;
      }

      this.logger.warn(
        `147 image blend failed in 147-first mode, fallback to Apimart: ${this.getProviderFailureMessage(
          legacyResult,
          legacyError
        )}`
      );
      try {
        return await this.withTimeout(
          this.blendImagesViaApimart(request),
          this.DEFAULT_TIMEOUT,
          "Apimart image blend"
        );
      } catch (error) {
        return this.buildApimartError("BLEND_FAILED", error);
      }
    }

    if (providerMode !== "legacy") {
      try {
        const result = await this.withTimeout(
          this.blendImagesViaApimart(request),
          this.DEFAULT_TIMEOUT,
          "Apimart image blend"
        );
        if (result.success) {
          this.logger.log("[Banana/Blend] route -> Apimart (success)");
          return result;
        }
        if (providerMode === "apimart") return result;
      } catch (error) {
        if (providerMode === "apimart") {
          return this.buildApimartError("BLEND_FAILED", error);
        }
        this.logger.warn(
          `Apimart image blend failed in auto mode, fallback to legacy: ${
            error instanceof Error ? error.message : error
          }`
        );
      }
    }

    this.logger.log("[Banana/Blend] route -> 147 (final fallback)");
    return this.blendImagesViaLegacy(request);
  }

  async analyzeImage(
    request: ImageAnalysisRequest
  ): Promise<AIProviderResponse<AnalysisResult>> {
    const providerMode = await this.getConfiguredImageProvider(
      request.providerOptions
    );
    this.logger.log(
      `🔍 Analyzing file with Banana API... mode=${providerMode}`
    );

    try {
      const sourceInputs = Array.from(
        new Set(
          [
            ...(Array.isArray(request.sourceImages) ? request.sourceImages : []),
            request.sourceImage,
          ]
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value) => value.length > 0),
        ),
      );
      if (!sourceInputs.length) {
        return {
          success: false,
          error: {
            code: "ANALYSIS_FAILED",
            message: "Analyze image requires at least one source image",
          },
        };
      }
      if (providerMode === "tencent") {
        return {
          success: false,
          error: {
            code: "ANALYSIS_UNSUPPORTED_ON_TENCENT",
            message:
              "稳定通道（腾讯）当前暂不支持图片分析，请切换到普通通道后重试。",
          },
        };
      }

      if (providerMode === "tencent_auto") {
        this.logger.warn(
          "[Banana/Analyze] tencent_auto does not support analysis on Tencent, fallback to 147 legacy channel."
        );
      }
      // 使用异步版本支持 HTTP URL
      const normalizedInputs = await Promise.all(
        sourceInputs.map((source) => this.normalizeFileInputAsync(source, "analysis"))
      );
      // 分析链路优先语言模型（3.1 Pro），并保留 2.5 Fast 显式请求能力
      const modelName = request.model?.trim() || "";
      const isFastModel = modelName.includes("2.5") || modelName.includes("gemini-2.5");
      const defaultModel = isFastModel ? "gemini-2.5-flash-image-preview" : "gemini-3.1-pro";
      const originalModel = this.normalizeLegacyImageModel(modelName || defaultModel);
      let currentModel = originalModel;
      let usedFallback = false;
      const mimeSummary = normalizedInputs.map((item) => item.mimeType).join(", ");
      this.logger.log(
        `📊 Analyze request: model=${currentModel}, files=${normalizedInputs.length}, mimeType=${mimeSummary}, mode=${providerMode}`
      );

      // 根据文件类型生成不同的提示词
      const hasPdf = normalizedInputs.some((item) => item.mimeType === "application/pdf");
      const hasImage = normalizedInputs.some((item) => item.mimeType.startsWith("image/"));
      const fileTypeDesc =
        normalizedInputs.length > 1 ? "files" : hasPdf && !hasImage ? "PDF document" : "image";

      const analysisPrompt = request.prompt
        ? `请详细分析这张${fileTypeDesc}，请用中文输出分析结果：${request.prompt}`
        : `请详细分析这张${fileTypeDesc}，请用中文输出分析结果`;

      for (let round = 0; round < this.MAX_MODEL_ATTEMPTS; round++) {
        try {
          this.logger.debug(
            `[Banana/Analyze] using model: ${currentModel}${usedFallback ? " (fallback)" : ""}`
          );

          const result = await this.withRetry(
            () =>
              this.withTimeout(
                (async () => {
                  return await this.makeRequest(
                    currentModel,
                    [
                      { text: analysisPrompt },
                      ...normalizedInputs.map((item) => ({
                        inlineData: {
                          mimeType: item.mimeType,
                          data: item.data,
                        },
                      })),
                    ],
                    {}
                  );
                })(),
                this.DEFAULT_TIMEOUT,
                "File analysis"
              ),
            "File analysis",
            2,
            (err) =>
              !this.isRateLimitedOrQuotaError(err) &&
              !this.isModelUnavailableError(err)
          );

          this.logger.log(
            `✅ File analysis succeeded: ${result.textResponse.length} characters`
          );
          if (usedFallback) {
            this.logger.log(
              `🔄 [FALLBACK SUCCESS] File analysis succeeded with fallback model: ${currentModel}`
            );
          }

          return {
            success: true,
            data: {
              text: result.textResponse,
              tags: [],
            },
          };
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          const fallbackModel = this.getFallbackModel(currentModel);
          if (
            fallbackModel &&
            fallbackModel !== currentModel &&
            !this.isModelUnavailableError(err) &&
            (this.isRateLimitedOrQuotaError(err) || this.shouldFallback(err))
          ) {
            this.logger.warn(
              `⚠️ [FALLBACK] File analysis failed with ${currentModel}, falling back to ${fallbackModel}. Error: ${err.message}`
            );
            currentModel = fallbackModel;
            usedFallback = true;
            continue;
          }

          this.logger.error("❌ File analysis failed:", error);
          return {
            success: false,
            error: {
              code: "ANALYSIS_FAILED",
              message: this.mapAnalyzeErrorMessage(err, currentModel),
              details: error,
            },
          };
        }
      }

      return {
        success: false,
        error: {
          code: "ANALYSIS_FAILED",
          message: "Unexpected error in image analysis",
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

  private async generateTextViaChannel(
    request: TextChatRequest,
    channel: "legacy" | "apimart"
  ): Promise<AIProviderResponse<TextResult>> {
    const originalModel = this.resolveTextModelForChannel(request.model, channel);
    let currentModel = originalModel;
    let usedFallback = false;

    for (let round = 0; round < this.MAX_MODEL_ATTEMPTS; round++) {
      try {
        this.logger.log(
          `📝 [${channel}] Using model: ${currentModel}${
            usedFallback ? " (fallback)" : ""
          }`
        );

        const apiConfig: any = {
          responseModalities: ["Text"],
        };

        if (request.enableWebSearch && channel === "legacy") {
          apiConfig.tools = [{ googleSearch: {} }];
          this.logger.log("🔍 Web search enabled");
        }

        const result = await this.withTimeout(
          (async () => {
            return await this.makeTextRequest(
              currentModel,
              request.prompt,
              apiConfig,
              channel
            );
          })(),
          this.TEXT_TIMEOUT,
          `Text generation (${channel})`
        );

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
            metadata: {
              provider: channel === "apimart" ? "apimart" : "147",
              ...(usedFallback
                ? {
                    fallbackUsed: true,
                    originalModel,
                    fallbackModel: currentModel,
                  }
                : {}),
            },
          },
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        if (this.isRateLimitedOrQuotaError(err)) {
          this.logger.warn(
            `⚠️ [FAST-SWITCH] Text generation hit rate/quota limit on ${channel}: ${err.message}`
          );
          return {
            success: false,
            error: {
              code: "TEXT_GENERATION_RATE_LIMITED",
              message: err.message,
              details: error,
            },
          };
        }

        if (channel === "apimart" && this.shouldFallback(err)) {
          this.logger.warn(
            `⚠️ [FAST-SWITCH] Apimart text channel unavailable, skip same-channel retries: ${err.message}`
          );
          return {
            success: false,
            error: {
              code: "TEXT_GENERATION_FAILED",
              message: err.message,
              details: error,
            },
          };
        }

        if (this.shouldFallback(err)) {
          const fallbackModel = this.getFallbackModel(currentModel);
          if (fallbackModel) {
            const nextModel = this.resolveTextModelForChannel(
              fallbackModel,
              channel
            );
            if (nextModel === currentModel) {
              this.logger.warn(
                `⚠️ [FAST-SWITCH] Fallback model equals current model (${currentModel}), skip redundant retry`
              );
            } else {
            this.logger.warn(
              `⚠️ [FALLBACK] Text generation failed with ${currentModel}, falling back to ${fallbackModel}. Error: ${err.message}`
            );
            currentModel = nextModel;
            usedFallback = true;
            continue;
            }
          }
        }

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

    return {
      success: false,
      error: {
        code: "TEXT_GENERATION_FAILED",
        message: "Unexpected error in text generation",
      },
    };
  }

  async generateText(
    request: TextChatRequest
  ): Promise<AIProviderResponse<TextResult>> {
    this.logger.log(`🤖 Generating text response using Banana provider...`);
    const providerMode = await this.getConfiguredTextProvider();

    if (providerMode === "legacy_auto") {
      let legacyResult: AIProviderResponse<TextResult> | null = null;
      let legacyError: unknown = null;

      try {
        legacyResult = await this.generateTextViaChannel(request, "legacy");
      } catch (error) {
        legacyError = error;
      }

      if (legacyResult?.success) return legacyResult;

      this.logger.warn(
        `147 text generation failed in 147-first mode, fallback to Apimart: ${this.getProviderFailureMessage(
          legacyResult,
          legacyError
        )}`
      );
      return this.generateTextViaChannel(request, "apimart");
    }

    if (providerMode !== "legacy") {
      try {
        const result = await this.generateTextViaChannel(request, "apimart");
        if (result.success || providerMode === "apimart") {
          return result;
        }
      } catch (error) {
        if (providerMode === "apimart") {
          const message = error instanceof Error ? error.message : String(error);
          return {
            success: false,
            error: {
              code: "TEXT_GENERATION_FAILED",
              message,
              details: error,
            },
          };
        }
        this.logger.warn(
          `Apimart text generation failed in auto mode, fallback to legacy: ${
            error instanceof Error ? error.message : error
          }`
        );
      }
    }

    return this.generateTextViaChannel(request, "legacy");
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

  private includesAny(text: string, keywords: readonly string[]): boolean {
    if (!text) return false;
    return keywords.some((keyword) => text.includes(keyword));
  }

  private pickFirstAllowedTool(
    tools: string[],
    preferredTools: readonly string[]
  ): string | null {
    for (const tool of preferredTools) {
      if (tools.includes(tool)) {
        return tool;
      }
    }
    return tools[0] ?? null;
  }

  private inferToolLocally(
    request: ToolSelectionRequest,
    tools: string[],
    hasVectorIntent: boolean
  ): ToolSelectionResult | null {
    const prompt = (request.prompt || "").trim();
    const lowerPrompt = prompt.toLowerCase();
    const explicitImageCount = request.imageCount ?? 0;
    const hasImageInput =
      !!request.hasImages || !!request.hasCachedImage || explicitImageCount > 0;

    const select = (
      selectedTool: string,
      reasoning: string,
      confidence: number
    ): ToolSelectionResult | null => {
      if (!tools.includes(selectedTool)) return null;
      return { selectedTool, reasoning, confidence };
    };

    if (hasVectorIntent) {
      const result = select(
        "generatePaperJS",
        "Detected explicit vector intent keywords.",
        0.98
      );
      if (result) return result;
    }

    if (explicitImageCount >= 2) {
      const result = select(
        "blendImages",
        "Multiple explicit images provided.",
        0.96
      );
      if (result) return result;
    }

    const videoKeywords = [
      "\u89c6\u9891",
      "\u77ed\u7247",
      "\u52a8\u753b",
      "\u5f71\u7247",
      "generate video",
      "video",
      "movie",
      "clip",
      "veo",
      "sora",
      "kling",
    ] as const;
    if (this.includesAny(lowerPrompt, videoKeywords)) {
      const result = select(
        "generateVideo",
        "Detected video-generation intent.",
        0.94
      );
      if (result) return result;
    }

    const blendKeywords = [
      "\u878d\u5408",
      "\u6df7\u5408",
      "\u5408\u6210",
      "\u62fc\u63a5",
      "blend",
      "mix",
      "merge",
      "combine",
      "composite",
    ] as const;
    if (explicitImageCount >= 2 && this.includesAny(lowerPrompt, blendKeywords)) {
      const result = select(
        "blendImages",
        "Detected multi-image blending intent.",
        0.95
      );
      if (result) return result;
    }

    const editKeywords = [
      "\u7f16\u8f91",
      "\u4fee\u6539",
      "\u4fee\u56fe",
      "\u62a0\u56fe",
      "\u53bb\u6389",
      "\u53bb\u9664",
      "\u66ff\u6362",
      "\u6269\u56fe",
      "\u5c40\u90e8",
      "\u91cd\u7ed8",
      "inpaint",
      "outpaint",
      "edit",
      "modify",
      "remove",
      "replace",
      "erase",
      "retouch",
    ] as const;
    if (hasImageInput && this.includesAny(lowerPrompt, editKeywords)) {
      const result = select(
        "editImage",
        "Detected image-edit intent with image input.",
        0.93
      );
      if (result) return result;
    }

    const analyzeKeywords = [
      "\u5206\u6790",
      "\u8bc6\u522b",
      "\u68c0\u6d4b",
      "\u63cf\u8ff0",
      "\u770b\u56fe",
      "\u56fe\u91cc",
      "\u662f\u4ec0\u4e48",
      "analyze",
      "analyse",
      "describe",
      "caption",
      "identify",
      "detect",
    ] as const;
    if (hasImageInput && this.includesAny(lowerPrompt, analyzeKeywords)) {
      const result = select(
        "analyzeImage",
        "Detected image-analysis intent with image input.",
        0.92
      );
      if (result) return result;
    }

    const imageGenKeywords = [
      "\u753b",
      "\u7ed8\u5236",
      "\u751f\u56fe",
      "\u751f\u6210\u56fe",
      "\u56fe\u50cf",
      "\u56fe\u7247",
      "\u63d2\u753b",
      "\u6d77\u62a5",
      "\u58c1\u7eb8",
      "draw",
      "paint",
      "illustration",
      "image",
      "picture",
      "photo",
      "render",
      "artwork",
      "create an image",
    ] as const;
    if (this.includesAny(lowerPrompt, imageGenKeywords)) {
      const result = select(
        "generateImage",
        "Detected image-generation intent.",
        0.9
      );
      if (result) return result;
    }

    if (hasImageInput && explicitImageCount === 1) {
      const result = select(
        "editImage",
        "Single image context defaults to edit mode.",
        0.82
      );
      if (result) return result;
    }

    return null;
  }

  private buildToolSelectionFallback(
    request: ToolSelectionRequest,
    tools: string[],
    reason: string
  ): ToolSelectionResult {
    const hasVectorIntent = this.hasVectorIntent(request.prompt || "");
    const local = this.inferToolLocally(request, tools, hasVectorIntent);
    if (local) {
      return {
        ...local,
        confidence: Math.min(0.85, Math.max(local.confidence, 0.55)),
        reasoning: `${local.reasoning} Fallback reason: ${reason}`,
      };
    }

    const selectedTool =
      this.pickFirstAllowedTool(tools, [
        "chatResponse",
        "generateImage",
        "editImage",
        "analyzeImage",
        "blendImages",
        "generateVideo",
      ]) ?? "chatResponse";

    return {
      selectedTool,
      reasoning: `Fallback routing applied: ${reason}`,
      confidence: 0.45,
    };
  }

  async selectTool(
    request: ToolSelectionRequest
  ): Promise<AIProviderResponse<ToolSelectionResult>> {
    this.logger.log("Selecting tool with Banana provider...");

    try {
      const toolSelectionTimeoutMs = 7_000;
      let lastError: unknown;

      const hasVectorIntent = this.hasVectorIntent(request.prompt || "");
      const tools = this.sanitizeAvailableTools(
        request.availableTools,
        hasVectorIntent
      );

      const localResult = this.inferToolLocally(request, tools, hasVectorIntent);
      if (localResult && localResult.confidence >= 0.8) {
        this.logger.log(
          `Tool selected locally: ${localResult.selectedTool}, confidence=${localResult.confidence}`
        );
        return {
          success: true,
          data: localResult,
        };
      }

      const toolListText = this.formatToolList(tools);
      const vectorRule = tools.includes("generatePaperJS")
        ? "Only choose generatePaperJS when vector/SVG/Paper.js output is explicitly requested."
        : "";

      const systemPrompt = `You are an AI tool router. Choose exactly one best tool from the list.

Available tools:
${toolListText}

${vectorRule ? `${vectorRule}\n\n` : ""}Return strict JSON only:
{
  "selectedTool": "tool_name",
  "reasoning": "why this tool",
  "confidence": 0.0-1.0
}`;

      const providerMode = await this.getConfiguredTextProvider();
      const channelSequence: Array<"legacy" | "apimart"> =
        providerMode === "legacy"
          ? ["legacy"]
          : providerMode === "apimart"
          ? ["apimart"]
          : providerMode === "legacy_auto"
          ? ["legacy", "apimart"]
          : ["apimart", "legacy"];

      for (const channel of channelSequence) {
        try {
          const toolSelectionModel = this.resolveTextModelForChannel(
            request.model,
            channel
          );

          const result = await this.withTimeout(
            this.makeTextRequest(
              toolSelectionModel,
              [{ text: systemPrompt }, { text: `User input: ${request.prompt}` }],
              { responseModalities: ["Text"] },
              channel
            ),
            toolSelectionTimeoutMs,
            `Tool selection API call (${channel})`
          );

          if (!result.textResponse) {
            throw new Error("Tool selection response did not contain text.");
          }

          try {
            const parsed = parseToolSelectionJson(result.textResponse);
            if (!parsed || typeof parsed !== "object") {
              throw new Error("Invalid tool selection JSON");
            }

            const rawSelected =
              typeof parsed.selectedTool === "string" ? parsed.selectedTool : "";
            const selectedTool = tools.includes(rawSelected)
              ? rawSelected
              : localResult?.selectedTool && tools.includes(localResult.selectedTool)
              ? localResult.selectedTool
              : this.buildToolSelectionFallback(
                  request,
                  tools,
                  "model selected unavailable tool"
                ).selectedTool;

            return {
              success: true,
              data: {
                selectedTool,
                reasoning:
                  typeof parsed.reasoning === "string"
                    ? parsed.reasoning
                    : TOOL_DESCRIPTIONS[selectedTool] || "Auto-selected tool.",
                confidence:
                  typeof parsed.confidence === "number"
                    ? parsed.confidence
                    : localResult?.confidence ?? 0.82,
              },
            };
          } catch {
            const fallback = this.buildToolSelectionFallback(
              request,
              tools,
              "invalid JSON response"
            );
            return {
              success: true,
              data: fallback,
            };
          }
        } catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Tool selection via ${channel} failed: ${message}`);
        }
      }

      const message =
        lastError instanceof Error
          ? lastError.message
          : "Unknown error during tool selection.";
      this.logger.error(`All tool selection attempts failed: ${message}`);

      const fallback = this.buildToolSelectionFallback(
        request,
        tools,
        "all attempts failed"
      );
      return {
        success: true,
        data: fallback,
      };
    } catch (error) {
      this.logger.error("Tool selection failed:", error as any);
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
    return (
      !!this.apiKey ||
      !!this.apimartApiKey ||
      this.tencentVodAigcService.isAvailable()
    );
  }

  getProviderInfo() {
    return {
      name: "Banana API",
      version: "1.0",
      supportedModels: [
        "gemini-3.1-pro",
        "gemini-3-pro-image-preview",
        "gemini-3.1-flash-image-preview",
        "gemini-3-flash-preview",
        "gemini-2.5-flash",
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
