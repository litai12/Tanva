import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';

export interface ImageGenerationResult {
  imageData?: string;
  textResponse: string;
  metadata?: Record<string, any>;
}

interface GenerateImageRequest {
  prompt: string;
  model?: string;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
  imageSize?: '1K' | '2K' | '4K';
  thinkingLevel?: 'high' | 'low';
  imageOnly?: boolean;
  customApiKey?: string | null; // 用户自定义 API Key
}

interface EditImageRequest {
  prompt: string;
  sourceImage: string; // base64
  model?: string;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
  imageSize?: '1K' | '2K' | '4K';
  thinkingLevel?: 'high' | 'low';
  imageOnly?: boolean;
  customApiKey?: string | null; // 用户自定义 API Key
}

interface BlendImagesRequest {
  prompt: string;
  sourceImages: string[]; // base64 array
  model?: string;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
  imageSize?: '1K' | '2K' | '4K';
  thinkingLevel?: 'high' | 'low';
  imageOnly?: boolean;
  customApiKey?: string | null; // 用户自定义 API Key
}

interface AnalyzeImageRequest {
  prompt?: string;
  sourceImage: string; // base64
  model?: string;
  customApiKey?: string | null; // 用户自定义 API Key
}

interface TextChatRequest {
  prompt: string;
  model?: string;
  enableWebSearch?: boolean;
  customApiKey?: string | null; // 用户自定义 API Key
}

interface ParsedStreamResponse {
  imageBytes: string | null;
  textResponse: string;
}

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);
  private readonly genAI: GoogleGenAI | null;
  private readonly defaultApiKey: string | null;
  private readonly DEFAULT_MODEL = 'gemini-3-pro-image-preview';
  private readonly DEFAULT_TIMEOUT = 300000; // 5分钟
  private readonly EDIT_TIMEOUT = 300000; // 5分钟
  // 优化后的重试配置：单层重试，递增延迟
  private readonly MAX_RETRIES = 3; // 最多重试 3 次（总共 4 次尝试）
  private readonly RETRY_DELAYS = [2000, 5000, 10000]; // 递增延迟: 2s, 5s, 10s

  constructor(private readonly config: ConfigService) {
    this.defaultApiKey =
      this.config.get<string>('GOOGLE_GEMINI_API_KEY') ??
      this.config.get<string>('VITE_GOOGLE_GEMINI_API_KEY') ??
      null;

    if (!this.defaultApiKey) {
      this.logger.warn('Google Gemini API key not configured. Image generation will be unavailable.');
      this.genAI = null;
      return;
    }

    this.genAI = new GoogleGenAI({ apiKey: this.defaultApiKey });
    this.logger.log('Google GenAI client initialized for image generation.');
  }

  /**
   * 获取 GoogleGenAI 客户端实例
   * @param customApiKey 用户自定义的 API Key（可选）
   * @returns GoogleGenAI 客户端实例
   */
  getClient(customApiKey?: string | null): GoogleGenAI {
    // 如果提供了自定义 Key，创建新的客户端实例
    if (customApiKey && customApiKey.trim().length > 0) {
      this.logger.debug('Using custom API key for request');
      return new GoogleGenAI({ apiKey: customApiKey.trim() });
    }

    // 否则使用默认客户端
    return this.ensureClient();
  }

  private ensureClient(): GoogleGenAI {
    if (!this.genAI) {
      throw new ServiceUnavailableException('Google Gemini API key not configured on the server.');
    }
    return this.genAI;
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
      throw new BadRequestException(`${context} file payload is empty`);
    }

    let trimmed = fileInput.trim();

    // 🔥 修复：处理前端错误格式 data:image/xxx;base64,https://...
    // 前端可能错误地将 URL 包装成 data URL 格式
    const malformedDataUrlMatch = trimmed.match(/^data:image\/[\w.+-]+;base64,(https?:\/\/.+)$/i);
    if (malformedDataUrlMatch) {
      this.logger.warn(`[normalizeFileInput] Detected malformed data URL with embedded HTTP URL for ${context}`);
      // 对于同步方法，我们无法下载 URL，所以抛出明确的错误
      throw new BadRequestException(
        `Invalid image format for ${context}: URL was incorrectly wrapped as data URL. Please send either a valid base64 string or use a provider that supports URL fetching.`
      );
    }

    let sanitized: string;
    let mimeType: string;

    // 支持 data:image/* 和 data:application/pdf 格式
    if (trimmed.startsWith('data:image/') || trimmed.startsWith('data:application/pdf')) {
      const match = trimmed.match(/^data:((?:image\/[\w.+-]+)|(?:application\/pdf));base64,(.+)$/i);
      if (!match) {
        this.logger.warn(`Invalid data URL detected for ${context} file: ${trimmed.substring(0, 30)}...`);
        throw new BadRequestException(`Invalid data URL format for ${context} file`);
      }

      [, mimeType, sanitized] = match;
      sanitized = sanitized.replace(/\s+/g, '');
      mimeType = mimeType || 'image/png';
    } else {
      // 某些前端环境可能在字符串两端添加引号
      const withoutQuotes = trimmed.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
      sanitized = withoutQuotes.replace(/\s+/g, '');
      const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;

      if (!base64Regex.test(sanitized)) {
        this.logger.warn(
          `Unsupported ${context} file payload received. Length=${sanitized.length}, preview="${sanitized.substring(
            0,
            30,
          )}"`,
        );
        throw new BadRequestException(
          `Unsupported ${context} file format. Expected a base64 string or data URL.`,
        );
      }

      mimeType = this.inferMimeTypeFromBase64(sanitized);
    }

    // 验证文件大小（base64编码后的数据，实际文件大小约为 base64 长度的 3/4）
    // 限制 base64 数据最大为 20MB，对应实际文件约 15MB
    const MAX_BASE64_SIZE = 20 * 1024 * 1024; // 20MB
    if (sanitized.length > MAX_BASE64_SIZE) {
      const actualSizeMB = (sanitized.length * 3 / 4 / 1024 / 1024).toFixed(2);
      this.logger.warn(
        `${context} file is too large. Base64 length: ${sanitized.length}, estimated size: ${actualSizeMB}MB`,
      );
      throw new BadRequestException(
        `${context} file is too large. Maximum size is 15MB (base64: ~20MB). Current size: ~${actualSizeMB}MB`,
      );
    }

    return {
      data: sanitized,
      mimeType,
    };
  }

  // 保持向后兼容的别名方法
  private normalizeImageInput(imageInput: string, context: string): { data: string; mimeType: string } {
    return this.normalizeFileInput(imageInput, context);
  }

  /**
   * 优化后的重试方法
   * - 只对可重试错误进行重试（网络错误、超时等）
   * - 使用递增延迟策略
   * - 认证错误、参数错误直接失败
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationType: string,
    maxRetries: number = this.MAX_RETRIES
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        this.logger.debug(`${operationType} attempt ${attempt}/${maxRetries + 1}`);
        const result = await operation();

        if (attempt > 1) {
          this.logger.log(`${operationType} succeeded on attempt ${attempt}`);
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 检查是否为可重试错误
        if (!this.isRetryableError(lastError)) {
          this.logger.error(`${operationType} failed with non-retryable error: ${lastError.message}`);
          throw lastError;
        }

        if (attempt <= maxRetries) {
          // 使用递增延迟
          const delay = this.RETRY_DELAYS[attempt - 1] || this.RETRY_DELAYS[this.RETRY_DELAYS.length - 1];
          this.logger.warn(`${operationType} attempt ${attempt} failed: ${lastError.message}, retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          this.logger.error(`${operationType} failed after ${maxRetries + 1} attempts`);
        }
      }
    }

    throw lastError!;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationType: string): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
    );

    const startTime = Date.now();

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      const duration = Date.now() - startTime;
      this.logger.log(`${operationType} succeeded in ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`${operationType} failed after ${duration}ms: ${message}`);
      throw error;
    }
  }

  private async parseStreamResponse(stream: any, operationType: string): Promise<ParsedStreamResponse> {
    this.logger.debug(`Parsing ${operationType} stream response...`);

    let textResponse: string = '';
    let imageBytes: string | null = null;
    let imageDataChunks: string[] = [];
    let chunkCount = 0;

    try {
      for await (const chunk of stream) {
        chunkCount++;

        if (!chunk?.candidates?.[0]?.content?.parts) {
          continue;
        }

        for (const part of chunk.candidates[0].content.parts) {
          // 处理文本
          if (part.text && typeof part.text === 'string') {
            textResponse += part.text;
            this.logger.debug(`Received text chunk: ${part.text.substring(0, 50)}...`);
          }

          // 处理图像
          if (part.inlineData?.data && typeof part.inlineData.data === 'string') {
            imageDataChunks.push(part.inlineData.data);
            this.logger.debug(`Received image chunk ${imageDataChunks.length}`);
          }
        }
      }

      // 合并图像数据块
      if (imageDataChunks.length > 0) {
        imageBytes = imageDataChunks.join('');
        // 清理空白字符
        imageBytes = imageBytes.replace(/\s+/g, '');
        if (!imageBytes || imageBytes.length === 0) {
          imageBytes = null;
        }
      }

      this.logger.log(
        `${operationType} stream parsing completed: ${chunkCount} chunks, text: ${textResponse.length} chars, image: ${imageBytes ? imageBytes.length : 0} chars`
      );

      if (!imageBytes && !textResponse) {
        throw new Error(`No ${operationType} data or text response found in stream`);
      }

      return { imageBytes, textResponse };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `${operationType} stream parsing failed: ${message} (processed ${chunkCount} chunks, text: ${textResponse.length} chars)`
      );
      throw error;
    }
  }

  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    const errorName = error.name.toLowerCase();

    // 网络相关错误 - 可以重试
    const retryablePatterns = [
      'fetch failed',
      'network',
      'timeout',
      'econnreset',
      'etimedout',
      'enotfound',
      'econnrefused',
      'socket',
      'connection',
      'eai_again', // DNS lookup failed
    ];

    // 不可重试的错误 - 认证、参数错误等
    const nonRetryablePatterns = [
      'unauthorized',
      'forbidden',
      'invalid',
      'bad request',
      '400',
      '401',
      '403',
      'malformed',
    ];

    // 先检查不可重试的错误
    for (const pattern of nonRetryablePatterns) {
      if (message.includes(pattern) || errorName.includes(pattern)) {
        this.logger.debug(`Non-retryable error detected: ${pattern}`);
        return false;
      }
    }

    // 检查可重试的错误
    for (const pattern of retryablePatterns) {
      if (message.includes(pattern) || errorName.includes(pattern)) {
        this.logger.debug(`Retryable error detected: ${pattern}`);
        return true;
      }
    }

    // 默认情况下，如果是未知错误，允许重试
    return true;
  }

  private parseNonStreamResponse(response: any, operationType: string): ParsedStreamResponse {
    this.logger.debug(`Parsing ${operationType} non-stream response...`);

    let textResponse = '';
    let imageBytes: string | null = null;

    try {
      if (response?.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.text && typeof part.text === 'string') {
            textResponse += part.text;
          }

          if (part.inlineData?.data && typeof part.inlineData.data === 'string') {
            imageBytes = part.inlineData.data.replace(/\s+/g, '');
          }
        }
      }

      this.logger.log(
        `${operationType} non-stream parsing completed: text: ${textResponse.length} chars, has image: ${!!imageBytes}`
      );

      return { imageBytes, textResponse };
    } catch (error) {
      this.logger.error(`${operationType} non-stream parsing failed:`, error);
      throw error;
    }
  }

  async generateImage(request: GenerateImageRequest): Promise<ImageGenerationResult> {
    const startTime = Date.now();
    this.logger.log(`[ImageGenerationService] 开始生成图像 - prompt: ${request.prompt.substring(0, 50)}..., model: ${request.model || this.DEFAULT_MODEL}, imageSize: ${request.imageSize || '未指定'}, aspectRatio: ${request.aspectRatio || '未指定'}, thinkingLevel: ${request.thinkingLevel || '未指定'}, imageOnly: ${request.imageOnly || false}`);

    const client = this.getClient(request.customApiKey);
    const model = request.model || this.DEFAULT_MODEL;
    const usingCustomApiKey = !!request.customApiKey;
    this.logger.log(`[ImageGenerationService] 使用模型: ${model}, 使用自定义API Key: ${usingCustomApiKey}`);

    // 简化后的单层重试逻辑
    const result = await this.withRetry(
      async () => {
        return await this.withTimeout(
          (async () => {
            const config: any = {
              safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                {
                  category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                  threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                  category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                  threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
              ],
              generationConfig: {
                responseModalities: request.imageOnly ? ['Image'] : ['Text', 'Image'],
              },
            };

            let imageConfig: any = undefined;

            if (request.aspectRatio || request.imageSize) {
              imageConfig = {};

              if (request.aspectRatio) {
                imageConfig.aspectRatio = request.aspectRatio;
                this.logger.log(`[ImageGenerationService] 设置 aspectRatio: ${request.aspectRatio}`);
              }

              if (request.imageSize) {
                // 根据官方文档，imageSize 必须是字符串 "1K"、"2K" 或 "4K"（大写K）
                // 不需要转换，直接使用原始值
                imageConfig.imageSize = request.imageSize;
                this.logger.log(`[ImageGenerationService] 设置 imageSize: ${request.imageSize} (类型: ${typeof request.imageSize})`);
              }
            } else {
              this.logger.warn(`[ImageGenerationService] 未设置 imageSize 和 aspectRatio`);
            }

            if (request.thinkingLevel) {
              config.generationConfig.thinkingLevel = request.thinkingLevel;
              this.logger.log(`[ImageGenerationService] 设置 thinkingLevel: ${request.thinkingLevel}`);
            }

            const reqOptions: any = {
              model,
              contents: request.prompt,
              config,
            };

            if (imageConfig) {
              reqOptions.imageConfig = imageConfig;
              this.logger.log(`[ImageGenerationService] 完整请求配置 - model: ${model}, imageConfig: ${JSON.stringify(imageConfig)}, responseModalities: ${config.generationConfig.responseModalities.join(', ')}`);
            } else {
              this.logger.warn(`[ImageGenerationService] 警告: imageConfig 为空，将不会发送 imageSize 和 aspectRatio 参数`);
            }

            // 优先尝试非流式 API（对于4K图像更稳定），失败后降级到流式 API
            try {
              this.logger.log(`[ImageGenerationService] 准备调用 Gemini API - 优先使用非流式API (generateContent)`);
              const apiCallStartTime = Date.now();
              
              const response = await client.models.generateContent(reqOptions);
              const apiCallDuration = Date.now() - apiCallStartTime;
              this.logger.log(`[ImageGenerationService] 非流式API调用成功 - 耗时: ${apiCallDuration}ms, 开始解析响应`);
              
              const nonStreamResult = this.parseNonStreamResponse(response, 'Image generation');
              this.logger.log(`[ImageGenerationService] 非流式响应解析完成 - hasImage: ${!!nonStreamResult.imageBytes}, imageBytesLength: ${nonStreamResult.imageBytes?.length || 0}, textResponseLength: ${nonStreamResult.textResponse?.length || 0}`);
              
              if (!nonStreamResult.imageBytes || nonStreamResult.imageBytes.length === 0) {
                this.logger.warn(`[ImageGenerationService] 非流式API返回无图像数据，降级到流式API...`);
                throw new Error('No image data in non-stream response');
              }
              
              this.logger.log(`[ImageGenerationService] 非流式API成功返回图像数据`);
              return nonStreamResult;
            } catch (nonStreamError) {
              const errorMessage = nonStreamError instanceof Error ? nonStreamError.message : String(nonStreamError);
              const errorStack = nonStreamError instanceof Error ? nonStreamError.stack : undefined;
              const normalizedMessage = errorMessage.toLowerCase();
              
              // 记录详细的错误信息
              const errorDetails: any = {
                message: errorMessage,
                name: nonStreamError instanceof Error ? nonStreamError.name : 'Unknown',
              };
              
              // 尝试提取底层错误信息
              if (nonStreamError instanceof Error) {
                const err = nonStreamError as any;
                if (err.cause) {
                  errorDetails.cause = err.cause;
                }
                if (err.code) {
                  errorDetails.code = err.code;
                }
                if (err.errno) {
                  errorDetails.errno = err.errno;
                }
                if (err.syscall) {
                  errorDetails.syscall = err.syscall;
                }
                if (err.hostname) {
                  errorDetails.hostname = err.hostname;
                }
                if (err.port) {
                  errorDetails.port = err.port;
                }
              }
              
              this.logger.error(`[ImageGenerationService] 非流式API失败 - 详细信息: ${JSON.stringify(errorDetails)}`, errorStack);
              
              // 判断是否应该降级到流式API
              const fallbackTriggers = [
                'fetch', 'network', 'timeout', 'socket', 'connection',
                'econn', 'enotfound', 'refused', 'empty response', 'no image data',
                'sending request', 'failed'
              ];
              const shouldFallback = fallbackTriggers.some((keyword) =>
                normalizedMessage.includes(keyword)
              );
              
              if (!shouldFallback) {
                // 非网络错误，直接抛出（如参数错误、认证错误等）
                this.logger.error(`[ImageGenerationService] 非流式API失败（非网络错误）: ${errorMessage}`);
                throw nonStreamError;
              }
              
              this.logger.warn(`[ImageGenerationService] 非流式API失败 (${errorMessage})，降级到流式API...`);
              
              // 降级到流式API
              try {
                const apiCallStartTime = Date.now();
                this.logger.log(`[ImageGenerationService] 尝试流式API (generateContentStream)`);

            const stream = await client.models.generateContentStream(reqOptions);
                const apiCallDuration = Date.now() - apiCallStartTime;
                this.logger.log(`[ImageGenerationService] 流式API调用成功 - 耗时: ${apiCallDuration}ms, 开始解析流式响应`);
                
                const parseResult = await this.parseStreamResponse(stream, 'Image generation');
                this.logger.log(`[ImageGenerationService] 流式响应解析完成 - hasImage: ${!!parseResult.imageBytes}, imageBytesLength: ${parseResult.imageBytes?.length || 0}, textResponseLength: ${parseResult.textResponse?.length || 0}`);
                
                if (!parseResult.imageBytes || parseResult.imageBytes.length === 0) {
                  this.logger.error(`[ImageGenerationService] 流式API也返回无图像数据`);
                  throw new Error('Stream API returned no image data');
                }
                
                this.logger.log(`[ImageGenerationService] 流式API降级成功`);
                return parseResult;
              } catch (streamError) {
                const streamErrorMessage = streamError instanceof Error ? streamError.message : String(streamError);
                const streamErrorStack = streamError instanceof Error ? streamError.stack : undefined;
                
                // 记录详细的错误信息
                const streamErrorDetails: any = {
                  message: streamErrorMessage,
                  name: streamError instanceof Error ? streamError.name : 'Unknown',
                };
                
                // 尝试提取底层错误信息
                if (streamError instanceof Error) {
                  const err = streamError as any;
                  if (err.cause) {
                    streamErrorDetails.cause = err.cause;
                  }
                  if (err.code) {
                    streamErrorDetails.code = err.code;
                  }
                  if (err.errno) {
                    streamErrorDetails.errno = err.errno;
                  }
                  if (err.syscall) {
                    streamErrorDetails.syscall = err.syscall;
                  }
                  if (err.hostname) {
                    streamErrorDetails.hostname = err.hostname;
                  }
                  if (err.port) {
                    streamErrorDetails.port = err.port;
                  }
                }
                
                this.logger.error(`[ImageGenerationService] 流式API也失败 - 详细信息: ${JSON.stringify(streamErrorDetails)}`, streamErrorStack);
                this.logger.error(`[ImageGenerationService] 失败的请求配置: ${JSON.stringify({ 
                  model, 
                  imageConfig, 
                  responseModalities: config.generationConfig.responseModalities,
                  hasPrompt: !!request.prompt,
                  promptLength: request.prompt?.length || 0,
                  imageSize: request.imageSize,
                  aspectRatio: request.aspectRatio
                })}`);
                
                throw streamError;
              }
            }
          })(),
          this.DEFAULT_TIMEOUT,
          'Image generation request'
        );
      },
      'Image generation'
    );

    const processingTime = Date.now() - startTime;
    const hasImage = !!result.imageBytes;
    const imageSize = result.imageBytes?.length || 0;
    this.logger.log(`[ImageGenerationService] 图像生成完成 - 总耗时: ${processingTime}ms, hasImage: ${hasImage}, imageSize: ${imageSize} bytes, textResponseLength: ${result.textResponse?.length || 0}`);
    
    if (!hasImage) {
      this.logger.warn(`[ImageGenerationService] 警告: 返回结果中没有图像数据`);
    }
    
    if (request.imageSize && hasImage) {
      // 估算图像分辨率（粗略估算）
      const estimatedPixels = imageSize > 0 ? Math.sqrt(imageSize / 4) : 0; // 假设每个像素约4字节
      const estimatedResolution = Math.round(estimatedPixels);
      this.logger.log(`[ImageGenerationService] 图像大小估算 - 请求imageSize: ${request.imageSize}, 图像数据大小: ${imageSize} bytes, 估算分辨率: ~${estimatedResolution}x${estimatedResolution}`);
    }

    return {
      imageData: result.imageBytes || undefined,
      textResponse: result.textResponse || '',
    };
  }

  async editImage(request: EditImageRequest): Promise<ImageGenerationResult> {
    this.logger.log(`Editing image with prompt: ${request.prompt.substring(0, 50)}...`);

    const { data: sourceImageData, mimeType: sourceMimeType } = this.normalizeImageInput(
      request.sourceImage,
      'edit',
    );
    this.logger.debug(
      `Normalized edit source image: mimeType=${sourceMimeType}, length=${sourceImageData.length}`,
    );

    const client = this.getClient(request.customApiKey);
    const model = request.model || this.DEFAULT_MODEL;
    const startTime = Date.now();

    // 简化后的单层重试逻辑
    const result = await this.withRetry(
      async () => {
        return await this.withTimeout(
          (async () => {
            const config: any = {
              safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                {
                  category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                  threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                  category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                  threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
              ],
              generationConfig: {
                responseModalities: request.imageOnly ? ['Image'] : ['Text', 'Image'],
              },
            };

            let imageConfig: any = undefined;

            if (request.aspectRatio || request.imageSize) {
              imageConfig = {};

              if (request.aspectRatio) {
                imageConfig.aspectRatio = request.aspectRatio;
              }

              if (request.imageSize) {
                // 根据官方文档，imageSize 必须是字符串 "1K"、"2K" 或 "4K"（大写K）
                // 不需要转换，直接使用原始值
                imageConfig.imageSize = request.imageSize;
              }
            }

            if (request.thinkingLevel) {
              config.generationConfig.thinkingLevel = request.thinkingLevel;
            }

            const contents = [
              { text: request.prompt },
              {
                inlineData: {
                  mimeType: sourceMimeType,
                  data: sourceImageData,
                },
              },
            ];

            // 优先尝试非流式 API，失败后降级到流式 API
            try {
              this.logger.debug('Calling non-stream generateContent for image edit...');
              const reqOptions: any = {
                model,
                contents,
                config,
              };

              if (imageConfig) {
                reqOptions.imageConfig = imageConfig;
              }

              const response = await client.models.generateContent(reqOptions);

              const nonStreamResult = this.parseNonStreamResponse(response, 'Image edit');

              if (!nonStreamResult.imageBytes || nonStreamResult.imageBytes.length === 0) {
                this.logger.warn('Non-stream API returned no image data, falling back to stream API...');
                throw new Error('No image data in non-stream response');
              }

              this.logger.log('Image edit non-stream API succeeded');
              return nonStreamResult;
            } catch (nonStreamError) {
              const errorMessage =
                nonStreamError instanceof Error ? nonStreamError.message : String(nonStreamError);
              const normalizedMessage = errorMessage.toLowerCase();
              const fallbackTriggers = [
                'fetch', 'network', 'timeout', 'socket', 'connection',
                'econn', 'enotfound', 'refused', 'empty response', 'no image data',
              ];
              const shouldFallback = fallbackTriggers.some((keyword) =>
                normalizedMessage.includes(keyword)
              );

              if (!shouldFallback) {
                throw nonStreamError;
              }

              this.logger.warn(`Image edit non-stream API failed (${errorMessage}), falling back to stream API...`);

              const stream = await client.models.generateContentStream({
                model,
                contents,
                config,
              });

              const streamResult = await this.parseStreamResponse(stream, 'Image edit');

              if (!streamResult.imageBytes || streamResult.imageBytes.length === 0) {
                this.logger.error('Stream API also returned no image data');
                throw new Error('Stream API returned no image data');
              }

              this.logger.log('Image edit stream API fallback succeeded');
              return streamResult;
            }
          })(),
          this.EDIT_TIMEOUT,
          'Image edit request'
        );
      },
      'Image edit'
    );

    const processingTime = Date.now() - startTime;
    this.logger.log(`Image edit completed in ${processingTime}ms`);

    return {
      imageData: result.imageBytes || undefined,
      textResponse: result.textResponse || '',
    };
  }

  async blendImages(request: BlendImagesRequest): Promise<ImageGenerationResult> {
    this.logger.log(`Blending ${request.sourceImages.length} images with prompt: ${request.prompt.substring(0, 50)}...`);

    const client = this.getClient(request.customApiKey);
    const model = request.model || this.DEFAULT_MODEL;
    const startTime = Date.now();

    if (!request.sourceImages || request.sourceImages.length === 0) {
      throw new BadRequestException('At least one source image is required for blending');
    }

    const normalizedImages = request.sourceImages.map((imageData, index) => {
      const normalized = this.normalizeImageInput(imageData, `blend source #${index + 1}`);
      this.logger.debug(
        `Normalized blend source #${index + 1}: mimeType=${normalized.mimeType}, length=${normalized.data.length}`,
      );
      return normalized;
    });

    // 构建图像部分
    const imageParts = normalizedImages.map((image) => ({
      inlineData: {
        mimeType: image.mimeType,
        data: image.data,
      },
    }));

    // 简化后的单层重试逻辑
    const result = await this.withRetry(
      async () => {
        return await this.withTimeout(
          (async () => {
            const config: any = {
              safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                {
                  category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                  threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                  category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                  threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
              ],
              generationConfig: {
                responseModalities: request.imageOnly ? ['Image'] : ['Text', 'Image'],
              },
            };

            let imageConfig: any = undefined;

            if (request.aspectRatio || request.imageSize) {
              imageConfig = {};

              if (request.aspectRatio) {
                imageConfig.aspectRatio = request.aspectRatio;
              }

              if (request.imageSize) {
                // 根据官方文档，imageSize 必须是字符串 "1K"、"2K" 或 "4K"（大写K）
                // 不需要转换，直接使用原始值
                imageConfig.imageSize = request.imageSize;
              }
            }

            if (request.thinkingLevel) {
              config.generationConfig.thinkingLevel = request.thinkingLevel;
            }

            const reqOptions: any = {
              model,
              contents: [{ text: request.prompt }, ...imageParts],
              config,
            };

            if (imageConfig) {
              reqOptions.imageConfig = imageConfig;
            }

            const stream = await client.models.generateContentStream(reqOptions);

            return this.parseStreamResponse(stream, 'Image blend');
          })(),
          this.DEFAULT_TIMEOUT,
          'Image blend request'
        );
      },
      'Image blend'
    );

    const processingTime = Date.now() - startTime;
    this.logger.log(`Image blend completed in ${processingTime}ms`);

    return {
      imageData: result.imageBytes || undefined,
      textResponse: result.textResponse || '',
    };
  }

  async analyzeImage(request: AnalyzeImageRequest): Promise<{ text: string }> {
    this.logger.log(`Analyzing file with prompt: ${request.prompt?.substring(0, 50) || 'full analysis'}...`);

    const { data: sourceFileData, mimeType: sourceMimeType } = this.normalizeFileInput(
      request.sourceImage,
      'analysis',
    );
    this.logger.debug(
      `Normalized analysis source file: mimeType=${sourceMimeType}, length=${sourceFileData.length}`,
    );

    const client = this.getClient(request.customApiKey);
    const model = request.model || 'gemini-2.5-flash';

    // 根据文件类型生成不同的提示词
    const isPdf = sourceMimeType === 'application/pdf';
    const fileTypeDesc = isPdf ? 'PDF document' : 'image';

    const analysisPrompt = request.prompt
      ? `Please analyze the following ${fileTypeDesc} (respond in Chinese):\n\n${request.prompt}`
      : isPdf
        ? `Please analyze this PDF document in detail (respond in Chinese):
1. Document type and purpose
2. Main content summary
3. Key information and data
4. Structure and organization
5. Notable details`
        : `Please analyze this image in detail (respond in Chinese):
1. Main content and theme
2. Objects, people, scenes
3. Color and composition
4. Style and quality
5. Notable details`;

    const startTime = Date.now();

    try {
      const result = await this.withRetry(
        () =>
          this.withTimeout(
            (async () => {
              const stream = await client.models.generateContentStream({
                model,
                contents: [
                  { text: analysisPrompt },
                  {
                    inlineData: {
                      mimeType: sourceMimeType,
                      data: sourceFileData,
                    },
                  },
                ],
                config: {
                  safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    {
                      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                      threshold: HarmBlockThreshold.BLOCK_NONE,
                    },
                    {
                      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                      threshold: HarmBlockThreshold.BLOCK_NONE,
                    },
                    { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
                  ],
                },
              });

              const streamResult = await this.parseStreamResponse(stream, 'File analysis');
              return { text: streamResult.textResponse };
            })(),
            this.DEFAULT_TIMEOUT,
            'File analysis request'
          ),
        'File analysis'
      );

      const processingTime = Date.now() - startTime;
      this.logger.log(`File analysis completed in ${processingTime}ms`);

      if (!result.text) {
        throw new Error('No analysis text returned from API');
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Image analysis failed: ${message}`);
      throw error;
    }
  }

  async generateTextResponse(request: TextChatRequest): Promise<{ text: string }> {
    this.logger.log(`Generating text response for prompt: ${request.prompt.substring(0, 50)}...`);

    const client = this.getClient(request.customApiKey);
    const model = request.model || 'gemini-2.5-flash';
    const finalPrompt = `Please respond in Chinese:\n\n${request.prompt}`;

    const startTime = Date.now();

    try {
      const result = await this.withTimeout(
        (async () => {
          const apiConfig: any = {
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
          };

          if (request.enableWebSearch) {
            apiConfig.tools = [{ googleSearch: {} }];
            this.logger.debug('Web search tool enabled');
          }

          const stream = await client.models.generateContentStream({
            model,
            contents: [{ text: finalPrompt }],
            config: apiConfig,
          });

          const streamResult = await this.parseStreamResponse(stream, 'Text generation');
          return { text: streamResult.textResponse };
        })(),
        this.DEFAULT_TIMEOUT,
        'Text generation request'
      );

      const processingTime = Date.now() - startTime;
      this.logger.log(`Text generation completed in ${processingTime}ms`);

      if (!result.text) {
        throw new Error('No text response from API');
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Text generation failed: ${message}`);
      throw error;
    }
  }

  /**
   * 生成 Paper.js 代码
   */
  async generatePaperJSCode(request: {
    prompt: string;
    model?: string;
    thinkingLevel?: 'high' | 'low';
    canvasWidth?: number;
    canvasHeight?: number;
    customApiKey?: string | null; // 用户自定义 API Key
  }): Promise<{ code: string; explanation?: string; model: string }> {
    this.logger.log(`Starting Paper.js code generation: ${request.prompt.substring(0, 50)}...`);
    const startTime = Date.now();

    try {
      const client = this.getClient(request.customApiKey);
      // 使用 gemini-3-pro-preview，与 gemini-pro 文本对话保持一致
      const model = request.model || 'gemini-3-pro-preview';

      // 系统提示词 - 直接拼接到用户提示词中
      const systemPrompt = `你是一个paper.js代码专家，请根据我的需求帮我生成纯净的paper.js代码，不用其他解释或无效代码，确保使用view.center作为中心，并围绕中心绘图`;

      // 用户提示词 - 将系统提示词和用户输入拼接
      const finalPrompt = `${systemPrompt}\n\n${request.prompt}`;

      this.logger.debug(`Paper.js generation - Final prompt: ${finalPrompt.substring(0, 100)}...`);

      // 默认使用非流式 API（更稳定），失败后降级到流式 API
      const result = await this.withRetry(
        async () => {
          return await this.withTimeout(
            (async () => {
              const apiConfig: any = {
                safetySettings: [
                  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                  {
                    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                  },
                  {
                    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                  },
                  { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
                ],
                generationConfig: {},
              };

              // 配置 thinking_level（Gemini 3 特性，参考官方文档）
              if (request.thinkingLevel) {
                apiConfig.generationConfig.thinking_level = request.thinkingLevel;
              }

              try {
                // 默认使用非流式 API（更稳定）
                const response = await client.models.generateContent({
                  model,
                  contents: [{ text: finalPrompt }],
                  config: apiConfig,
                });

                if (!response.text) {
                  throw new Error('Non-stream API returned empty response');
                }

                return { text: response.text };
              } catch (nonStreamError) {
                // 如果非流式 API 失败，降级到流式 API
                const isNetworkError = this.isRetryableError(
                  nonStreamError instanceof Error ? nonStreamError : new Error(String(nonStreamError))
                );

                if (isNetworkError) {
                  this.logger.warn('Non-stream API failed, falling back to stream API...');
                  try {
                    const stream = await client.models.generateContentStream({
                      model,
                      contents: [{ text: finalPrompt }],
                      config: apiConfig,
                    });

                    const streamResult = await this.parseStreamResponse(stream, 'Paper.js code generation');
                    this.logger.log('Stream API fallback succeeded');
                    return { text: streamResult.textResponse };
                  } catch (fallbackError) {
                    // 如果降级也失败，抛出原始非流式错误
                    throw nonStreamError;
                  }
                } else {
                  // 非网络错误直接抛出
                  throw nonStreamError;
                }
              }
            })(),
            this.DEFAULT_TIMEOUT,
            'Paper.js code generation request'
          );
        },
        'Paper.js code generation',
        5 // 增加重试次数到 5 次（总共 6 次尝试）
      );

      const processingTime = Date.now() - startTime;
      this.logger.log(`Paper.js code generation completed in ${processingTime}ms`);

      if (!result.text) {
        throw new Error('No code response from API');
      }

      // 清理响应，移除 markdown 代码块包装
      const cleanedCode = this.cleanCodeResponse(result.text);

      return {
        code: cleanedCode,
        model,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Paper.js code generation failed: ${message}`);
      throw error;
    }
  }

  /**
   * 图像转矢量 - 分析图像并生成 Paper.js 矢量代码
   */
  async img2Vector(request: {
    sourceImage: string; // base64
    prompt?: string;
    model?: string;
    thinkingLevel?: 'high' | 'low';
    canvasWidth?: number;
    canvasHeight?: number;
    style?: 'simple' | 'detailed' | 'artistic';
    customApiKey?: string | null;
  }): Promise<{ code: string; imageAnalysis: string; explanation?: string; model: string }> {
    this.logger.log(`Starting img2vector conversion...`);
    const startTime = Date.now();

    try {
      const client = this.getClient(request.customApiKey);
      const model = request.model || 'gemini-3-pro-preview';

      // 第一步：分析图像
      this.logger.log('Step 1: Analyzing image...');
      const { data: sourceFileData, mimeType: sourceMimeType } = this.normalizeFileInput(
        request.sourceImage,
        'analysis',
      );

      const analysisPrompt = `请详细分析这个图像，并用中文描述以下内容（用于生成矢量图）：
1. 主要形状和轮廓
2. 颜色和配色方案
3. 结构和布局
4. 风格特征
5. 关键细节和元素

${request.prompt ? `额外要求：${request.prompt}` : ''}`;

      const analysisStream = await client.models.generateContentStream({
        model,
        contents: [
          { text: analysisPrompt },
          {
            inlineData: {
              mimeType: sourceMimeType,
              data: sourceFileData,
            },
          },
        ],
        config: {
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            {
              category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
          ],
        },
      });

      const analysisResult = await this.parseStreamResponse(analysisStream, 'Image analysis for img2vector');
      const imageAnalysis = analysisResult.textResponse;
      this.logger.log(`Image analysis completed: ${imageAnalysis.substring(0, 100)}...`);

      // 第二步：根据分析结果生成 Paper.js 代码
      this.logger.log('Step 2: Generating Paper.js code from analysis...');

      const styleGuide = this.getStyleGuide(request.style || 'detailed');
      const vectorGenerationPrompt = `你是一个paper.js代码专家。根据以下图像分析结果，生成纯净的paper.js矢量代码。

${styleGuide}

图像分析结果：
${imageAnalysis}

要求：
- 只输出纯净的paper.js代码，不要其他解释
- 使用view.center作为中心，围绕中心绘图
- 代码应该能直接执行
- 保留图像的主要特征和风格`;

      const vectorResult = await this.withRetry(
        async () => {
          return await this.withTimeout(
            (async () => {
              const apiConfig: any = {
                safetySettings: [
                  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                  {
                    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                  },
                  {
                    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                  },
                  { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
                ],
                generationConfig: {},
              };

              if (request.thinkingLevel) {
                apiConfig.generationConfig.thinking_level = request.thinkingLevel;
              }

              try {
                const response = await client.models.generateContent({
                  model,
                  contents: [{ text: vectorGenerationPrompt }],
                  config: apiConfig,
                });

                if (!response.text) {
                  throw new Error('Non-stream API returned empty response');
                }

                return { text: response.text };
              } catch (nonStreamError) {
                const isNetworkError = this.isRetryableError(
                  nonStreamError instanceof Error ? nonStreamError : new Error(String(nonStreamError))
                );

                if (isNetworkError) {
                  this.logger.warn('Non-stream API failed, falling back to stream API...');
                  try {
                    const stream = await client.models.generateContentStream({
                      model,
                      contents: [{ text: vectorGenerationPrompt }],
                      config: apiConfig,
                    });

                    const streamResult = await this.parseStreamResponse(stream, 'Paper.js code generation');
                    this.logger.log('Stream API fallback succeeded');
                    return { text: streamResult.textResponse };
                  } catch (fallbackError) {
                    throw nonStreamError;
                  }
                } else {
                  throw nonStreamError;
                }
              }
            })(),
            this.DEFAULT_TIMEOUT,
            'Paper.js code generation request'
          );
        },
        'Paper.js code generation from img2vector',
        5
      );

      const processingTime = Date.now() - startTime;
      this.logger.log(`img2vector conversion completed in ${processingTime}ms`);

      if (!vectorResult.text) {
        throw new Error('No code response from API');
      }

      const cleanedCode = this.cleanCodeResponse(vectorResult.text);

      return {
        code: cleanedCode,
        imageAnalysis,
        explanation: '矢量图已根据图像分析结果生成',
        model,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`img2vector conversion failed: ${message}`);
      throw error;
    }
  }

  /**
   * 获取矢量风格指南
   */
  private getStyleGuide(style: 'simple' | 'detailed' | 'artistic'): string {
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
}
