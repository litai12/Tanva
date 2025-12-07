import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
} from './ai-provider.interface';

/**
 * Banana API Provider - 使用HTTP直接调用Google Gemini API的代理
 * 文档: https://147api.apifox.cn/
 * API地址: https://147ai.com/v1beta/models
 */
@Injectable()
export class BananaProvider implements IAIProvider {
  private readonly logger = new Logger(BananaProvider.name);
  private apiKey: string | null = null;
  private readonly apiBaseUrl = 'https://api1.147ai.com/v1beta/models';
  private readonly DEFAULT_MODEL = 'gemini-3-pro-image-preview';
  private readonly DEFAULT_TIMEOUT = 300000; // 5分钟
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAYS = [2000, 5000, 10000]; // 递增延迟: 2s, 5s, 10s

  // 降级模型映射：Pro模型 -> 2.5模型（与国内极速版一致）
  private readonly FALLBACK_MODELS: Record<string, string> = {
    'gemini-3-pro-image-preview': 'gemini-2.5-flash-image',
    'gemini-3-pro-preview': 'gemini-2.5-flash',
    'banana-gemini-3-pro-preview': 'gemini-2.5-flash',
    'banana-gemini-3-pro-image-preview': 'gemini-2.5-flash-image',
  };

  constructor(private readonly config: ConfigService) {}

  async initialize(): Promise<void> {
    this.apiKey = this.config.get<string>('BANANA_API_KEY') ?? null;

    if (!this.apiKey) {
      this.logger.warn('Banana API key not configured.');
      return;
    }

    this.logger.log('Banana API provider initialized successfully');
  }

  private ensureApiKey(): string {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        '147 API key not configured on the server.'
      );
    }
    return this.apiKey;
  }

  private normalizeModelName(model: string): string {
    // 移除banana-前缀，确保API能识别模型名称
    // banana-gemini-3-pro-image-preview -> gemini-3-pro-image-preview
    return model.startsWith('banana-') ? model.substring(7) : model;
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
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504') ||
      message.includes('timeout') ||
      message.includes('model') && message.includes('not') ||
      message.includes('unavailable') ||
      message.includes('rate limit') ||
      message.includes('quota') ||
      message.includes('overloaded') ||
      message.includes('capacity')
    );
  }

  /**
   * 获取降级模型
   * 如果当前模型有对应的降级模型，返回降级模型名称
   * 否则返回 null
   */
  private getFallbackModel(currentModel: string): string | null {
    const normalized = this.normalizeModelName(currentModel);
    return this.FALLBACK_MODELS[normalized] || this.FALLBACK_MODELS[currentModel] || null;
  }

  private inferMimeTypeFromBase64(data: string): string {
    const headerChecks = [
      { prefix: 'iVBORw0KGgo', mime: 'image/png' },
      { prefix: '/9j/', mime: 'image/jpeg' },
      { prefix: 'R0lGOD', mime: 'image/gif' },
      { prefix: 'UklGR', mime: 'image/webp' },
      { prefix: 'Qk', mime: 'image/bmp' },
      { prefix: 'JVBERi', mime: 'application/pdf' }, // PDF 文件 (%PDF-)
    ];

    const head = data.substring(0, 20);
    for (const check of headerChecks) {
      if (head.startsWith(check.prefix)) {
        return check.mime;
      }
    }

    return 'image/png';
  }

  private normalizeFileInput(fileInput: string, context: string): { data: string; mimeType: string } {
    if (!fileInput || fileInput.trim().length === 0) {
      throw new Error(`${context} file payload is empty`);
    }

    const trimmed = fileInput.trim();

    // 支持 data:image/* 和 data:application/pdf 格式
    if (trimmed.startsWith('data:image/') || trimmed.startsWith('data:application/pdf')) {
      const match = trimmed.match(/^data:((?:image\/[\w.+-]+)|(?:application\/pdf));base64,(.+)$/i);
      if (!match) {
        throw new Error(`Invalid data URL format for ${context} file`);
      }

      const [, mimeType, base64Data] = match;
      const sanitized = base64Data.replace(/\s+/g, '');

      return {
        data: sanitized,
        mimeType: mimeType || 'image/png',
      };
    }

    const withoutQuotes = trimmed.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
    const sanitized = withoutQuotes.replace(/\s+/g, '');
    const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;

    if (!base64Regex.test(sanitized)) {
      throw new Error(
        `Unsupported ${context} file format. Expected a base64 string or data URL.`
      );
    }

    return {
      data: sanitized,
      mimeType: this.inferMimeTypeFromBase64(sanitized),
    };
  }

  // 保持向后兼容的别名方法
  private normalizeImageInput(imageInput: string, context: string): { data: string; mimeType: string } {
    return this.normalizeFileInput(imageInput, context);
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
          const delay = this.RETRY_DELAYS[attempt - 1] || this.RETRY_DELAYS[this.RETRY_DELAYS.length - 1];
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
      setTimeout(
        () => reject(new Error('Request timeout')),
        timeoutMs
      )
    );

    const startTime = Date.now();

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      const duration = Date.now() - startTime;
      this.logger.log(`${operationType || 'API call'} succeeded in ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`${operationType || 'API call'} failed after ${duration}ms: ${message}`);
      throw error;
    }
  }

  private buildContents(input: any): Array<{ role: string; parts: any[] }> {
    // 已经是完整的 content 结构时直接返回
    if (Array.isArray(input)) {
      const allContentObjects = input.every(
        (item) => item && typeof item === 'object' && 'role' in item && 'parts' in item
      );

      if (allContentObjects) {
        return input;
      }

      const parts = input.map((part) => {
        if (typeof part === 'string') {
          return { text: part };
        }

        if (part && typeof part === 'object' && !('role' in part) && !('parts' in part)) {
          return part;
        }

        return { text: String(part) };
      });

      return [{ role: 'user', parts }];
    }

    if (input && typeof input === 'object') {
      if ('role' in input && 'parts' in input) {
        return [input];
      }

      return [
        {
          role: 'user',
          parts: [input],
        },
      ];
    }

    return [
      {
        role: 'user',
        parts: [
          {
            text: typeof input === 'string' ? input : String(input),
          },
        ],
      },
    ];
  }

  private sanitizeApiKey(apiKey: string): string {
    // 147 API 要求直接使用 sk- 开头的密钥，如果误带 Bearer 则去掉
    return apiKey.replace(/^Bearer\s+/i, '').trim();
  }

  private async makeRequest(
    model: string,
    contents: any,
    config?: any
  ): Promise<{ imageBytes: string | null; textResponse: string }> {
    const apiKey = this.ensureApiKey();
    const url = `${this.apiBaseUrl}/${model}:generateContent`;

    const headers = {
      'Authorization': this.sanitizeApiKey(apiKey),
      'Content-Type': 'application/json',
    };

    // 构建请求体，更好地支持Gemini API格式
    const body: any = {
      contents: this.buildContents(contents),
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
      ],
    };

    // 添加生成配置
    if (config) {
      body.generationConfig = {};
      if (config.responseModalities) {
        body.generationConfig.responseModalities = config.responseModalities;
      }
      if (config.imageConfig) {
        body.generationConfig.imageConfig = config.imageConfig;
      }
      if (config.thinking_level) {
        body.generationConfig.thinking_level = config.thinking_level;
      }
      if (config.tools) {
        body.tools = config.tools;
      }
    }

    this.logger.debug(`Making request to ${url}`, { body: JSON.stringify(body).substring(0, 200) });

    const response = await fetch(url, {
      method: 'POST',
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
    return this.parseResponse(data, 'API call');
  }

  private parseResponse(
    data: any,
    operationType: string
  ): { imageBytes: string | null; textResponse: string } {
    this.logger.debug(`Parsing ${operationType} response...`);

    let textResponse: string = '';
    let imageBytes: string | null = null;

    try {
      if (data?.candidates?.[0]?.content?.parts) {
        const parts = data.candidates[0].content.parts;
        for (const part of parts) {
          if (part.text && typeof part.text === 'string') {
            textResponse += part.text;
          }

          if (part.inlineData?.data && typeof part.inlineData.data === 'string') {
            imageBytes = part.inlineData.data.replace(/\s+/g, '');
          }
        }
      }

      this.logger.log(
        `${operationType} parsing completed: text: ${textResponse.length} chars, has image: ${!!imageBytes}`
      );

      return { imageBytes: imageBytes || null, textResponse };
    } catch (error) {
      this.logger.error(`${operationType} parsing failed:`, error);
      throw error;
    }
  }

  async generateImage(
    request: ImageGenerationRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    this.logger.log(`Generating image with prompt: ${request.prompt.substring(0, 50)}...`);

    const originalModel = this.normalizeModelName(request.model || this.DEFAULT_MODEL);
    let currentModel = originalModel;
    let usedFallback = false;

    // 尝试使用主模型，失败后降级
    for (let round = 0; round < 2; round++) {
      try {
        this.logger.debug(`Using model: ${currentModel}${usedFallback ? ' (fallback)' : ''}`);

        const result = await this.withRetry(
          async () => {
            return await this.withTimeout(
              (async () => {
                const config: any = {
                  responseModalities: request.imageOnly ? ['IMAGE'] : ['TEXT', 'IMAGE'],
                };

                // 配置 imageConfig（aspectRatio 和 imageSize）
                if (request.aspectRatio || request.imageSize) {
                  config.imageConfig = {};
                  if (request.aspectRatio) {
                    config.imageConfig.aspectRatio = request.aspectRatio;
                  }
                  if (request.imageSize) {
                    config.imageConfig.imageSize = request.imageSize;
                  }
                }

                // 配置 thinking_level（Gemini 3 特性，降级后不使用）
                if (request.thinkingLevel && !usedFallback) {
                  config.thinking_level = request.thinkingLevel;
                }

                return await this.makeRequest(currentModel, request.prompt, config);
              })(),
              this.DEFAULT_TIMEOUT,
              'Image generation'
            );
          },
          'Image generation'
        );

        if (usedFallback) {
          this.logger.log(`🔄 [FALLBACK SUCCESS] Image generation succeeded with fallback model: ${currentModel}`);
        }

        return {
          success: true,
          data: {
            imageData: result.imageBytes || undefined,
            textResponse: result.textResponse || '',
            hasImage: !!result.imageBytes,
            metadata: usedFallback ? { fallbackUsed: true, originalModel, fallbackModel: currentModel } : undefined,
          },
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // 检查是否应该降级
        if (!usedFallback && this.shouldFallback(err)) {
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
        this.logger.error('Image generation failed:', error);
        return {
          success: false,
          error: {
            code: 'GENERATION_FAILED',
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
        code: 'GENERATION_FAILED',
        message: 'Unexpected error in image generation',
      },
    };
  }

  async editImage(
    request: ImageEditRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    this.logger.log(`Editing image with prompt: ${request.prompt.substring(0, 50)}...`);

    const { data: imageData, mimeType } = this.normalizeImageInput(request.sourceImage, 'edit');
    const originalModel = this.normalizeModelName(request.model || this.DEFAULT_MODEL);
    let currentModel = originalModel;
    let usedFallback = false;

    // 尝试使用主模型，失败后降级
    for (let round = 0; round < 2; round++) {
      try {
        this.logger.debug(`Using model: ${currentModel}${usedFallback ? ' (fallback)' : ''}`);

        const result = await this.withRetry(
          async () => {
            return await this.withTimeout(
              (async () => {
                const config: any = {
                  responseModalities: request.imageOnly ? ['IMAGE'] : ['TEXT', 'IMAGE'],
                };

                // 配置 imageConfig（aspectRatio 和 imageSize）
                if (request.aspectRatio || request.imageSize) {
                  config.imageConfig = {};
                  if (request.aspectRatio) {
                    config.imageConfig.aspectRatio = request.aspectRatio;
                  }
                  if (request.imageSize) {
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
              'Image edit'
            );
          },
          'Image edit'
        );

        if (usedFallback) {
          this.logger.log(`🔄 [FALLBACK SUCCESS] Image edit succeeded with fallback model: ${currentModel}`);
        }

        return {
          success: true,
          data: {
            imageData: result.imageBytes || undefined,
            textResponse: result.textResponse || '',
            hasImage: !!result.imageBytes,
            metadata: usedFallback ? { fallbackUsed: true, originalModel, fallbackModel: currentModel } : undefined,
          },
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // 检查是否应该降级
        if (!usedFallback && this.shouldFallback(err)) {
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
        this.logger.error('Image edit failed:', error);
        return {
          success: false,
          error: {
            code: 'EDIT_FAILED',
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
        code: 'EDIT_FAILED',
        message: 'Unexpected error in image edit',
      },
    };
  }

  async blendImages(
    request: ImageBlendRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    this.logger.log(
      `Blending ${request.sourceImages.length} images with prompt: ${request.prompt.substring(0, 50)}...`
    );

    const normalizedImages = request.sourceImages.map((imageData, index) => {
      const normalized = this.normalizeImageInput(imageData, `blend source #${index + 1}`);
      return normalized;
    });

    const imageParts = normalizedImages.map((image) => ({
      inlineData: {
        mimeType: image.mimeType,
        data: image.data,
      },
    }));

    const originalModel = this.normalizeModelName(request.model || this.DEFAULT_MODEL);
    let currentModel = originalModel;
    let usedFallback = false;

    // 尝试使用主模型，失败后降级
    for (let round = 0; round < 2; round++) {
      try {
        this.logger.debug(`Using model: ${currentModel}${usedFallback ? ' (fallback)' : ''}`);

        const result = await this.withRetry(
          async () => {
            return await this.withTimeout(
              (async () => {
                const config: any = {
                  responseModalities: request.imageOnly ? ['IMAGE'] : ['TEXT', 'IMAGE'],
                };

                // 配置 imageConfig（aspectRatio 和 imageSize）
                if (request.aspectRatio || request.imageSize) {
                  config.imageConfig = {};
                  if (request.aspectRatio) {
                    config.imageConfig.aspectRatio = request.aspectRatio;
                  }
                  if (request.imageSize) {
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
              'Image blend'
            );
          },
          'Image blend'
        );

        if (usedFallback) {
          this.logger.log(`🔄 [FALLBACK SUCCESS] Image blend succeeded with fallback model: ${currentModel}`);
        }

        return {
          success: true,
          data: {
            imageData: result.imageBytes || undefined,
            textResponse: result.textResponse || '',
            hasImage: !!result.imageBytes,
            metadata: usedFallback ? { fallbackUsed: true, originalModel, fallbackModel: currentModel } : undefined,
          },
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // 检查是否应该降级
        if (!usedFallback && this.shouldFallback(err)) {
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
        this.logger.error('Image blend failed:', error);
        return {
          success: false,
          error: {
            code: 'BLEND_FAILED',
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
        code: 'BLEND_FAILED',
        message: 'Unexpected error in image blend',
      },
    };
  }

  async analyzeImage(
    request: ImageAnalysisRequest
  ): Promise<AIProviderResponse<AnalysisResult>> {
    this.logger.log(`🔍 Analyzing file with Banana (147) API...`);

    try {
      const { data: fileData, mimeType } = this.normalizeFileInput(request.sourceImage, 'analysis');
      // 🔥 使用 gemini-3-pro-image-preview 进行文件分析
      const model = this.normalizeModelName(request.model || 'gemini-3-pro-image-preview');
      this.logger.log(`📊 Using model: ${model}, mimeType: ${mimeType}`);

      // 根据文件类型生成不同的提示词
      const isPdf = mimeType === 'application/pdf';
      const fileTypeDesc = isPdf ? 'PDF document' : 'image';

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
            'File analysis'
          ),
        'File analysis',
        2
      );

      this.logger.log(`✅ File analysis succeeded: ${result.textResponse.length} characters`);

      return {
        success: true,
        data: {
          text: result.textResponse,
          tags: [],
        },
      };
    } catch (error) {
      this.logger.error('❌ File analysis failed:', error);
      return {
        success: false,
        error: {
          code: 'ANALYSIS_FAILED',
          message: error instanceof Error ? error.message : 'Failed to analyze file',
          details: error,
        },
      };
    }
  }

  async generateText(
    request: TextChatRequest
  ): Promise<AIProviderResponse<TextResult>> {
    this.logger.log(`🤖 Generating text response using Banana (147) API...`);

    // 文本生成默认使用 gemini-2.5-flash，如果指定了 Pro 模型则使用降级策略
    const originalModel = this.normalizeModelName(request.model || 'gemini-2.5-flash');
    let currentModel = originalModel;
    let usedFallback = false;

    // 尝试使用主模型，失败后降级
    for (let round = 0; round < 2; round++) {
      try {
        this.logger.log(`📝 Using model: ${currentModel}${usedFallback ? ' (fallback)' : ''}`);

        const apiConfig: any = {
          responseModalities: ['TEXT']
        };

        if (request.enableWebSearch) {
          apiConfig.tools = [{ googleSearch: {} }];
          this.logger.log('🔍 Web search enabled');
        }

        const result = await this.withRetry(
          async () => {
            return await this.withTimeout(
              (async () => {
                return await this.makeRequest(
                  currentModel,
                  request.prompt,
                  apiConfig
                );
              })(),
              this.DEFAULT_TIMEOUT,
              'Text generation'
            );
          },
          'Text generation'
        );

        if (usedFallback) {
          this.logger.log(`🔄 [FALLBACK SUCCESS] Text generation succeeded with fallback model: ${currentModel}`);
        } else {
          this.logger.log(`✅ Text generation succeeded with ${result.textResponse.length} characters`);
        }

        return {
          success: true,
          data: {
            text: result.textResponse,
            metadata: usedFallback ? { fallbackUsed: true, originalModel, fallbackModel: currentModel } : undefined,
          },
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // 检查是否应该降级
        if (!usedFallback && this.shouldFallback(err)) {
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
        this.logger.error('❌ Text generation failed:', error);
        return {
          success: false,
          error: {
            code: 'TEXT_GENERATION_FAILED',
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
        code: 'TEXT_GENERATION_FAILED',
        message: 'Unexpected error in text generation',
      },
    };
  }

  async selectTool(
    request: ToolSelectionRequest
  ): Promise<AIProviderResponse<ToolSelectionResult>> {
    this.logger.log('🎯 Selecting tool with Banana (147) API using gemini-2.0-flash...');

    try {
      const maxAttempts = 3;
      const delayMs = 1000;
      let lastError: unknown;

      // 工具选择的系统提示 - 与基础版 ai.service.ts 完全一致
      const systemPrompt = `你是一个AI助手工具选择器。根据用户的输入，选择最合适的工具执行。

可用工具:
- generateImage: 生成新的图像
- editImage: 编辑现有图像
- blendImages: 融合多张图像
- analyzeImage: 分析图像内容
- chatResponse: 文本对话或聊天
- generateVideo: 生成视频
- generatePaperJS: 生成 Paper.js 矢量图形代码

请根据用户的实际需求，智能判断最合适的工具。例如：
- 用户要求生成矢量图、SVG、几何图形、代码绘图等 → generatePaperJS
- 用户要求生成图像、照片、画作等 → generateImage
- 用户要求编辑、修改现有图像 → editImage
- 用户要求融合、混合多张图像 → blendImages
- 用户要求分析、识别图像内容 → analyzeImage
- 用户要求生成视频 → generateVideo
- 其他对话、提问、讨论 → chatResponse

请以以下JSON格式回复（仅返回JSON，不要其他文字）:
{
  "selectedTool": "工具名称",
  "reasoning": "选择理由"
}`;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          // 使用与基础版完全相同的调用方式：两条独立的 contents
          const result = await this.makeRequest(
            'gemini-2.0-flash',
            [
              { text: systemPrompt },
              { text: `用户输入: ${request.prompt}` },
            ],
            { responseModalities: ['TEXT'] }
          );

          if (!result.textResponse) {
            this.logger.warn('Tool selection response did not contain text.');
            throw new Error('Empty response');
          }

          // 解析AI的JSON响应 - 与基础版逻辑一致
          try {
            let jsonText = result.textResponse.trim();

            // 移除 markdown 代码块标记
            if (jsonText.startsWith('```json')) {
              jsonText = jsonText.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
            } else if (jsonText.startsWith('```')) {
              jsonText = jsonText.replace(/^```\s*/i, '').replace(/\s*```$/, '');
            }

            const parsed = JSON.parse(jsonText.trim());
            const selectedTool = parsed.selectedTool || 'chatResponse';

            this.logger.log(`✅ Tool selected: ${selectedTool}`);

            return {
              success: true,
              data: {
                selectedTool,
                reasoning: parsed.reasoning || '',
                confidence: 0.85,
              },
            };
          } catch (parseError) {
            this.logger.warn(`Failed to parse tool selection JSON: ${result.textResponse}`);
            // 降级：如果解析失败，默认返回文本对话
            return {
              success: true,
              data: {
                selectedTool: 'chatResponse',
                reasoning: 'Fallback due to invalid JSON response',
                confidence: 0.5,
              },
            };
          }
        } catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Tool selection attempt ${attempt}/${maxAttempts} failed: ${message}`);
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }

      const message =
        lastError instanceof Error ? lastError.message : 'Unknown error occurred during tool selection.';
      this.logger.error(`All tool selection attempts failed: ${message}`);

      // 最后的降级方案：返回文本对话
      return {
        success: true,
        data: {
          selectedTool: 'chatResponse',
          reasoning: 'Fallback due to repeated failures',
          confidence: 0.4,
        },
      };
    } catch (error) {
      this.logger.error('❌ Tool selection failed:', error);
      return {
        success: false,
        error: {
          code: 'TOOL_SELECTION_FAILED',
          message: error instanceof Error ? error.message : 'Failed to select tool',
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
      name: 'Banana API',
      version: '1.0',
      supportedModels: ['gemini-3-pro-image-preview', 'gemini-2.0-flash'],
    };
  }

  /**
   * 清理代码响应，移除 markdown 代码块包装
   */
  private cleanCodeResponse(text: string): string {
    let cleaned = text.trim();

    // 移除 markdown 代码块
    if (cleaned.startsWith('```')) {
      // 匹配 ```javascript, ```js, ```paperjs 等
      cleaned = cleaned.replace(/^```(?:javascript|js|paperjs)?\s*/i, '');
      cleaned = cleaned.replace(/\s*```$/i, '');
    }

    // 再次清理，以防多层包装
    cleaned = cleaned.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:javascript|js|paperjs)?\s*/i, '');
      cleaned = cleaned.replace(/\s*```$/i, '');
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

    const originalModel = this.normalizeModelName(request.model || 'gemini-3-pro-preview');
    let currentModel = originalModel;
    let usedFallback = false;

    // 尝试使用主模型，失败后降级
    for (let round = 0; round < 2; round++) {
      try {
        this.logger.log(`📝 Using model: ${currentModel}${usedFallback ? ' (fallback)' : ''}`);

        const apiConfig: any = {
          responseModalities: ['TEXT']
        };

        // 配置 thinking_level（Gemini 3 特性，降级后不使用）
        if (request.thinkingLevel && !usedFallback) {
          apiConfig.thinking_level = request.thinkingLevel;
        }

        const result = await this.withRetry(
          async () => {
            return await this.withTimeout(
              (async () => {
                return await this.makeRequest(
                  currentModel,
                  finalPrompt,
                  apiConfig
                );
              })(),
              this.DEFAULT_TIMEOUT,
              'Paper.js code generation'
            );
          },
          'Paper.js code generation'
        );

        if (!result.textResponse) {
          throw new Error('No code response from API');
        }

        // 清理响应，移除 markdown 代码块包装
        const cleanedCode = this.cleanCodeResponse(result.textResponse);

        if (usedFallback) {
          this.logger.log(`🔄 [FALLBACK SUCCESS] Paper.js code generation succeeded with fallback model: ${currentModel}`);
        } else {
          this.logger.log(`✅ Paper.js code generation succeeded with ${cleanedCode.length} characters`);
        }

        return {
          success: true,
          data: {
            code: cleanedCode,
            metadata: usedFallback ? { fallbackUsed: true, originalModel, fallbackModel: currentModel } : undefined,
          },
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // 检查是否应该降级
        if (!usedFallback && this.shouldFallback(err)) {
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
        this.logger.error('❌ Paper.js code generation failed:', error);
        return {
          success: false,
          error: {
            code: 'PAPERJS_GENERATION_FAILED',
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
        code: 'PAPERJS_GENERATION_FAILED',
        message: 'Unexpected error in Paper.js code generation',
      },
    };
  }
}
