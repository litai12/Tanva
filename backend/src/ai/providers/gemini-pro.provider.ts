import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
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

const DEFAULT_TOOLS = [
  'generateImage',
  'editImage',
  'blendImages',
  'analyzeImage',
  'chatResponse',
  'generateVideo',
  'generatePaperJS',
] as const;

const TOOL_DESCRIPTIONS: Record<string, string> = {
  generateImage: '生成新的图像',
  editImage: '编辑现有图像',
  blendImages: '融合多张图像',
  analyzeImage: '分析图像内容',
  chatResponse: '文本对话或聊天',
  generateVideo: '生成视频',
  generatePaperJS: '生成 Paper.js 矢量图形代码',
};

const VECTOR_KEYWORDS = [
  '矢量',
  '矢量图',
  '矢量化',
  'vector',
  'vectorize',
  'vectorization',
  'svg',
  'paperjs',
  'paper.js',
  'svg path',
  '路径代码',
  'path code',
  'vector graphic',
  'vectorgraphics',
];

@Injectable()
export class GeminiProProvider implements IAIProvider {
  private readonly logger = new Logger(GeminiProProvider.name);
  private genAI: GoogleGenAI | null = null;
  private readonly DEFAULT_MODEL = 'gemini-3-pro-image-preview';
  private readonly DEFAULT_TIMEOUT = 120000;
  private readonly EDIT_TIMEOUT = 180000; // 3分钟，编辑图像需要更长时间
  private readonly MAX_RETRIES = 3;

  constructor(private readonly config: ConfigService) { }

  async initialize(): Promise<void> {
    const apiKey = this.config.get<string>('GOOGLE_GEMINI_API_KEY');

    if (!apiKey) {
      this.logger.warn('Google Gemini API key not configured.');
      return;
    }

    try {
      this.genAI = new GoogleGenAI({ apiKey });
      this.logger.log('Google GenAI client initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Google GenAI client:', error);
    }
  }

  private ensureClient(): GoogleGenAI {
    if (!this.genAI) {
      throw new ServiceUnavailableException(
        'Google Gemini API key not configured on the server.'
      );
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
      throw new Error(`${context} file payload is empty`);
    }

    let trimmed = fileInput.trim();

    // 🔥 修复：处理前端错误格式 data:image/xxx;base64,https://...
    // 前端可能错误地将 URL 包装成 data URL 格式
    const malformedDataUrlMatch = trimmed.match(/^data:image\/[\w.+-]+;base64,(https?:\/\/.+)$/i);
    if (malformedDataUrlMatch) {
      this.logger.warn(`[normalizeFileInput] Detected malformed data URL with embedded HTTP URL for ${context}`);
      // 对于同步方法，我们无法下载 URL，所以抛出明确的错误
      throw new Error(
        `Invalid image format for ${context}: URL was incorrectly wrapped as data URL. Please send either a valid base64 string or use a provider that supports URL fetching.`
      );
    }

    let sanitized: string;
    let mimeType: string;

    // 支持 data:image/* 和 data:application/pdf 格式
    if (trimmed.startsWith('data:image/') || trimmed.startsWith('data:application/pdf')) {
      const match = trimmed.match(/^data:((?:image\/[\w.+-]+)|(?:application\/pdf));base64,(.+)$/i);
      if (!match) {
        throw new Error(`Invalid data URL format for ${context} file`);
      }

      [, mimeType, sanitized] = match;
      sanitized = sanitized.replace(/\s+/g, '');
      mimeType = mimeType || 'image/png';
    } else {
      const withoutQuotes = trimmed.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
      sanitized = withoutQuotes.replace(/\s+/g, '');
      const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;

      if (!base64Regex.test(sanitized)) {
        throw new Error(
          `Unsupported ${context} file format. Expected a base64 string or data URL.`
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
      throw new Error(
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

    // 默认情况下，对于未知错误也允许重试（可能是临时性问题）
    return true;
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

        // 检查错误是否可重试
        const isRetryable = this.isRetryableError(lastError);

        if (attempt < maxRetries && isRetryable) {
          const delay = 1000 * attempt;
          this.logger.warn(
            `${operationType} attempt ${attempt} failed: ${lastError.message}, retrying in ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          if (!isRetryable) {
            this.logger.error(`${operationType} failed with non-retryable error: ${lastError.message}`);
          } else {
            this.logger.error(`${operationType} failed after all ${maxRetries} attempts`);
          }
          // 如果是不可重试的错误或已达到最大重试次数，直接抛出
          throw lastError;
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

  async generateImage(
    request: ImageGenerationRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    const startTime = Date.now();
    this.logger.log(`[GeminiProProvider] 开始生成图像 - prompt: ${request.prompt.substring(0, 50)}..., model: ${request.model || this.DEFAULT_MODEL}, imageSize: ${request.imageSize || '未指定'}, aspectRatio: ${request.aspectRatio || '未指定'}, thinkingLevel: ${request.thinkingLevel || '未指定'}, imageOnly: ${request.imageOnly || false}`);

    try {
      const client = this.ensureClient();
      const model = request.model || this.DEFAULT_MODEL;
      this.logger.log(`[GeminiProProvider] 使用模型: ${model}`);

      const result = await this.withRetry(
        async () => {
          return await this.withTimeout(
            (async () => {
              const config: any = {
                safetySettings: [
                  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
                ],
                generationConfig: {
                  responseModalities: request.imageOnly ? ['Image'] : ['Text', 'Image'],
                },
              };

              let imageConfig: any = undefined;

              // 配置 imageConfig（aspectRatio 和 imageSize）
              if (request.aspectRatio || request.imageSize) {
                imageConfig = {};

                if (request.aspectRatio) {
                  imageConfig.aspectRatio = request.aspectRatio;
                  this.logger.log(`[GeminiProProvider] 设置 aspectRatio: ${request.aspectRatio}`);
                }

                if (request.imageSize) {
                  // 根据官方文档，imageSize 必须是字符串 "1K"、"2K" 或 "4K"（大写K）
                  // 不需要转换，直接使用原始值
                  imageConfig.imageSize = request.imageSize;
                  this.logger.log(`[GeminiProProvider] 设置 imageSize: ${request.imageSize} (类型: ${typeof request.imageSize})`);
                }
              } else {
                this.logger.warn(`[GeminiProProvider] 未设置 imageSize 和 aspectRatio`);
              }

              // 配置 thinking_level（Gemini 3 特性，参考官方文档）
              if (request.thinkingLevel) {
                config.generationConfig.thinking_level = request.thinkingLevel;
                this.logger.log(`[GeminiProProvider] 设置 thinking_level: ${request.thinkingLevel}`);
              }

              const reqOptions: any = {
                model,
                contents: request.prompt,
                config,
              };

              if (imageConfig) {
                reqOptions.imageConfig = imageConfig;
                this.logger.log(`[GeminiProProvider] 完整请求配置 - model: ${model}, imageConfig: ${JSON.stringify(imageConfig)}, responseModalities: ${config.generationConfig.responseModalities.join(', ')}`);
              } else {
                this.logger.warn(`[GeminiProProvider] 警告: imageConfig 为空，将不会发送 imageSize 和 aspectRatio 参数`);
              }

              this.logger.log(`[GeminiProProvider] 准备调用 Gemini API - 使用非流式API (generateContent)`);
              const apiCallStartTime = Date.now();
              
              try {
              const response = await client.models.generateContent(reqOptions);
                const apiCallDuration = Date.now() - apiCallStartTime;
                this.logger.log(`[GeminiProProvider] Gemini API 调用成功 - 耗时: ${apiCallDuration}ms, 开始解析响应`);
                
                const parseResult = this.parseNonStreamResponse(response, 'Image generation');
                this.logger.log(`[GeminiProProvider] 响应解析完成 - hasImage: ${!!parseResult.imageBytes}, imageBytesLength: ${parseResult.imageBytes?.length || 0}, textResponseLength: ${parseResult.textResponse?.length || 0}`);
                
                return parseResult;
              } catch (apiError) {
                const apiCallDuration = Date.now() - apiCallStartTime;
                const errorMessage = apiError instanceof Error ? apiError.message : String(apiError);
                const errorStack = apiError instanceof Error ? apiError.stack : undefined;
                this.logger.error(`[GeminiProProvider] Gemini API 调用失败 - 耗时: ${apiCallDuration}ms, 错误: ${errorMessage}`, errorStack);
                this.logger.error(`[GeminiProProvider] 失败的请求配置: ${JSON.stringify({ 
                  model, 
                  imageConfig, 
                  responseModalities: config.generationConfig.responseModalities,
                  hasPrompt: !!request.prompt,
                  promptLength: request.prompt?.length || 0
                })}`);
                throw apiError;
              }
            })(),
            this.DEFAULT_TIMEOUT,
            'Image generation'
          );
        },
        'Image generation'
      );

      const processingTime = Date.now() - startTime;
      const hasImage = !!result.imageBytes;
      const imageSize = result.imageBytes?.length || 0;
      this.logger.log(`[GeminiProProvider] 图像生成完成 - 总耗时: ${processingTime}ms, success: true, hasImage: ${hasImage}, imageSize: ${imageSize} bytes, textResponseLength: ${result.textResponse?.length || 0}`);
      
      if (!hasImage) {
        this.logger.warn(`[GeminiProProvider] 警告: 返回结果中没有图像数据`);
      }
      
      if (request.imageSize && hasImage) {
        // 估算图像分辨率（粗略估算）
        const estimatedPixels = imageSize > 0 ? Math.sqrt(imageSize / 4) : 0; // 假设每个像素约4字节
        const estimatedResolution = Math.round(estimatedPixels);
        this.logger.log(`[GeminiProProvider] 图像大小估算 - 请求imageSize: ${request.imageSize}, 图像数据大小: ${imageSize} bytes, 估算分辨率: ~${estimatedResolution}x${estimatedResolution}`);
      }

      return {
        success: true,
        data: {
          imageData: result.imageBytes || undefined,
          textResponse: result.textResponse || '',
          hasImage: !!result.imageBytes,
        },
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`[GeminiProProvider] 图像生成失败 - 总耗时: ${processingTime}ms, 错误: ${errorMessage}`, errorStack);
      this.logger.error(`[GeminiProProvider] 失败时的请求参数: ${JSON.stringify({
        model: request.model || this.DEFAULT_MODEL,
        imageSize: request.imageSize,
        aspectRatio: request.aspectRatio,
        thinkingLevel: request.thinkingLevel,
        imageOnly: request.imageOnly,
        promptLength: request.prompt?.length || 0
      })}`);
      return {
        success: false,
        error: {
          code: 'GENERATION_FAILED',
          message: error instanceof Error ? error.message : 'Failed to generate image',
          details: error,
        },
      };
    }
  }

  async editImage(
    request: ImageEditRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    this.logger.log(`Editing image with prompt: ${request.prompt.substring(0, 50)}...`);

    try {
      const { data: imageData, mimeType } = this.normalizeImageInput(request.sourceImage, 'edit');
      const client = this.ensureClient();
      const model = request.model || this.DEFAULT_MODEL;

      // ✅ 关键修改：使用 withRetry 包装编辑请求，增加容错能力
      const result = await this.withRetry(
        async () => {
          return await this.withTimeout(
            (async () => {
              const config: any = {
                safetySettings: [
                  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
                ],
                generationConfig: {
                  responseModalities: request.imageOnly ? ['Image'] : ['Text', 'Image'],
                },
              };

              let imageConfig: any = undefined;

              // 配置 imageConfig（aspectRatio 和 imageSize）
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

              // 配置 thinking_level（Gemini 3 特性，参考官方文档）
              if (request.thinkingLevel) {
                config.generationConfig.thinking_level = request.thinkingLevel;
              }

              const contents = [
                { text: request.prompt },
                {
                  inlineData: {
                    mimeType: mimeType || 'image/png',
                    data: imageData,
                  },
                },
              ];

              // 直接使用非流式 API（和 banana provider 一样简单直接）
              const reqOptions: any = {
                model,
                contents,
                config,
              };

              if (imageConfig) {
                reqOptions.imageConfig = imageConfig;
              }

              const response = await client.models.generateContent(reqOptions);

              return this.parseNonStreamResponse(response, 'Image edit');
            })(),
            this.EDIT_TIMEOUT,  // ✅ 使用更长的超时时间 (180秒)
            'Image edit'
          );
        },
        'Image edit',
        this.MAX_RETRIES  // ✅ 启用重试机制 (3次)
      );

      return {
        success: true,
        data: {
          imageData: result.imageBytes || undefined,
          textResponse: result.textResponse || '',
          hasImage: !!result.imageBytes,
        },
      };
    } catch (error) {
      this.logger.error('Image edit failed:', error);
      return {
        success: false,
        error: {
          code: 'EDIT_FAILED',
          message: error instanceof Error ? error.message : 'Failed to edit image',
          details: error,
        },
      };
    }
  }

  async blendImages(
    request: ImageBlendRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    this.logger.log(
      `Blending ${request.sourceImages.length} images with prompt: ${request.prompt.substring(0, 50)}...`
    );

    try {
      const client = this.ensureClient();
      const model = request.model || this.DEFAULT_MODEL;

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

      // ✅ 关键修改：使用 withRetry 包装融合请求，增加容错能力
      const result = await this.withRetry(
        async () => {
          return await this.withTimeout(
            (async () => {
              const config: any = {
                safetySettings: [
                  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
                ],
                generationConfig: {
                  responseModalities: request.imageOnly ? ['Image'] : ['Text', 'Image'],
                },
              };

              let imageConfig: any = undefined;

              // 配置 imageConfig（aspectRatio 和 imageSize）
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

              // 配置 thinking_level（Gemini 3 特性，参考官方文档）
              if (request.thinkingLevel) {
                config.generationConfig.thinking_level = request.thinkingLevel;
              }

              const reqOptions: any = {
                model,
                contents: [{ text: request.prompt }, ...imageParts],
                config,
              };

              if (imageConfig) {
                reqOptions.imageConfig = imageConfig;
              }

              const response = await client.models.generateContent(reqOptions);

              return this.parseNonStreamResponse(response, 'Image blend');
            })(),
            this.EDIT_TIMEOUT,  // ✅ 使用更长的超时时间 (180秒)
            'Image blend'
          );
        },
        'Image blend',
        this.MAX_RETRIES  // ✅ 启用重试机制 (3次)
      );

      return {
        success: true,
        data: {
          imageData: result.imageBytes || undefined,
          textResponse: result.textResponse || '',
          hasImage: !!result.imageBytes,
        },
      };
    } catch (error) {
      this.logger.error('Image blend failed:', error);
      return {
        success: false,
        error: {
          code: 'BLEND_FAILED',
          message: error instanceof Error ? error.message : 'Failed to blend images',
          details: error,
        },
      };
    }
  }

  async analyzeImage(
    request: ImageAnalysisRequest
  ): Promise<AIProviderResponse<AnalysisResult>> {
    this.logger.log(`Analyzing file...`);

    try {
      const { data: fileData, mimeType } = this.normalizeFileInput(request.sourceImage, 'analysis');
      const client = this.ensureClient();

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
              const response = await client.models.generateContent({
                model: 'gemini-3-pro-preview',
                contents: [
                  { text: analysisPrompt },
                  {
                    inlineData: {
                      mimeType: mimeType || 'image/png',
                      data: fileData,
                    },
                  },
                ],
                config: {
                  safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
                  ],
                },
              });

              if (!response.text) {
                throw new Error('File analysis API returned empty response');
              }

              return { text: response.text };
            })(),
            this.DEFAULT_TIMEOUT,
            'File analysis'
          ),
        'File analysis',
        2
      );

      return {
        success: true,
        data: {
          text: result.text,
          tags: [],
        },
      };
    } catch (error) {
      this.logger.error('Image analysis failed:', error);
      return {
        success: false,
        error: {
          code: 'ANALYSIS_FAILED',
          message: error instanceof Error ? error.message : 'Failed to analyze image',
          details: error,
        },
      };
    }
  }

  async generateText(
    request: TextChatRequest
  ): Promise<AIProviderResponse<TextResult>> {
    this.logger.log(`Generating text response...`);

    try {
      const client = this.ensureClient();
      const finalPrompt = request.prompt;

      // 默认使用非流式 API（更稳定），失败后降级到流式 API
      const result = await this.withRetry(
        async () => {
          return await this.withTimeout(
            (async () => {
              const apiConfig: any = {
                safetySettings: [
                  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                  { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
                ],
                generationConfig: {},
              };

              // 配置 thinking_level（Gemini 3 特性，参考官方文档）
              if (request.thinkingLevel) {
                apiConfig.generationConfig.thinking_level = request.thinkingLevel;
              }

              if (request.enableWebSearch) {
                apiConfig.tools = [{ googleSearch: {} }];
              }

              try {
                // 默认使用非流式 API（更稳定）
                const response = await client.models.generateContent({
                  model: 'gemini-3-pro-preview',
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
                      model: 'gemini-3-pro-preview',
                      contents: [{ text: finalPrompt }],
                      config: apiConfig,
                    });

                    const streamResult = await this.parseStreamResponse(stream, 'Text generation');
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
            'Text generation'
          );
        },
        'Text generation',
        5 // 增加重试次数到 5 次（总共 6 次尝试）
      );

      return {
        success: true,
        data: {
          text: result.text,
        },
      };
    } catch (error) {
      this.logger.error('Text generation failed:', error);
      return {
        success: false,
        error: {
          code: 'TEXT_GENERATION_FAILED',
          message: error instanceof Error ? error.message : 'Failed to generate text',
          details: error,
        },
      };
    }
  }

  private sanitizeAvailableTools(tools?: string[], allowVector: boolean = true): string[] {
    const base = Array.isArray(tools) && tools.length ? tools : [...DEFAULT_TOOLS];
    const unique = Array.from(new Set(base.filter(Boolean)));
    const filtered = allowVector ? unique : unique.filter((tool) => tool !== 'generatePaperJS');

    if (filtered.length > 0) {
      return filtered;
    }

    return allowVector ? [...DEFAULT_TOOLS] : [...DEFAULT_TOOLS.filter((tool) => tool !== 'generatePaperJS')];
  }

  private hasVectorIntent(prompt: string): boolean {
    if (!prompt) return false;
    const lower = prompt.toLowerCase();
    return VECTOR_KEYWORDS.some((keyword) => lower.includes(keyword.toLowerCase()));
  }

  private formatToolList(tools: string[]): string {
    return tools
      .map((tool) => `- ${tool}: ${TOOL_DESCRIPTIONS[tool] || '辅助对话'}`)
      .join('\n');
  }

  async selectTool(
    request: ToolSelectionRequest
  ): Promise<AIProviderResponse<ToolSelectionResult>> {
    this.logger.log('Selecting tool...');

    try {
      const client = this.ensureClient();
      const maxAttempts = 3;
      const delayMs = 1000;
      let lastError: unknown;

      const hasVectorIntent = this.hasVectorIntent(request.prompt);
      const tools = this.sanitizeAvailableTools(request.availableTools, hasVectorIntent);
      const toolListText = this.formatToolList(tools);
      const vectorRule = tools.includes('generatePaperJS')
        ? `只有当用户明确提到以下关键词之一（${VECTOR_KEYWORDS.join(', ')}）或直接要求输出 SVG/Paper.js 矢量代码时，才选择 generatePaperJS；仅描述形状、几何或线条但未出现这些关键词时，不要选择 generatePaperJS，优先 generateImage 或 chatResponse。`
        : '';

      const systemPrompt = `你是一个AI助手工具选择器。根据用户的输入，选择最合适的工具执行。

可用工具:
${toolListText}

${vectorRule ? `${vectorRule}\n\n` : ''}请根据用户的实际需求，智能判断最合适的工具。例如：
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
          const response = await client.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
              { text: systemPrompt },
              { text: `用户输入: ${request.prompt}` }
            ],
            config: {
              safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
              ],
            },
          });

          if (!response.text) {
            this.logger.warn('Tool selection response did not contain text.');
            throw new Error('Empty Gemini response');
          }

          // 解析AI的JSON响应 - 与基础版逻辑一致
          try {
            let jsonText = response.text.trim();

            // 移除 markdown 代码块标记
            if (jsonText.startsWith('```json')) {
              jsonText = jsonText.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
            } else if (jsonText.startsWith('```')) {
              jsonText = jsonText.replace(/^```\s*/i, '').replace(/\s*```$/, '');
            }

            const parsed = JSON.parse(jsonText.trim());
            const rawSelected = parsed.selectedTool || 'chatResponse';
            const selectedTool =
              tools.includes(rawSelected) ? rawSelected : (tools.includes('chatResponse') ? 'chatResponse' : tools[0]);

            this.logger.log(`Tool selected: ${selectedTool}`, { hasVectorIntent });

            return {
              success: true,
              data: {
                selectedTool,
                reasoning: parsed.reasoning || vectorRule,
                confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.85,
              },
            };
          } catch (parseError) {
            this.logger.warn(`Failed to parse tool selection JSON: ${response.text}`);
            // 降级：如果解析失败，默认返回文本对话
            return {
              success: true,
              data: {
                selectedTool: tools.includes('chatResponse') ? 'chatResponse' : tools[0],
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
          selectedTool: tools.includes('chatResponse') ? 'chatResponse' : tools[0],
          reasoning: 'Fallback due to repeated failures',
          confidence: 0.4,
        },
      };
    } catch (error) {
      this.logger.error('Tool selection failed:', error);
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

  private parseNonStreamResponse(
    response: any,
    operationType: string
  ): { imageBytes: string | null; textResponse: string } {
    this.logger.debug(`Parsing ${operationType} non-stream response...`);

    let textResponse: string = '';
    let imageBytes: string | null = null;

    try {
      if (response?.candidates?.[0]?.content?.parts) {
        const parts = response.candidates[0].content.parts;
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
        `${operationType} non-stream parsing completed: text: ${textResponse.length} chars, has image: ${!!imageBytes}`
      );

      return { imageBytes: imageBytes || null, textResponse };
    } catch (error) {
      this.logger.error(`${operationType} non-stream parsing failed:`, error);
      throw error;
    }
  }

  private async parseStreamResponse(
    stream: any,
    operationType: string
  ): Promise<{ imageBytes: string | null; textResponse: string }> {
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
          if (part.text && typeof part.text === 'string') {
            textResponse += part.text;
          }

          if (part.inlineData?.data && typeof part.inlineData.data === 'string') {
            imageDataChunks.push(part.inlineData.data);
          }
        }
      }

      if (imageDataChunks.length > 0) {
        imageBytes = imageDataChunks.join('');
        imageBytes = imageBytes.replace(/\s+/g, '');
        if (!imageBytes || imageBytes.length === 0) {
          imageBytes = null;
        }
      }

      this.logger.log(
        `${operationType} stream parsing completed: ${chunkCount} chunks, text: ${textResponse.length} chars`
      );

      return { imageBytes, textResponse };
    } catch (error) {
      this.logger.error(`${operationType} stream parsing failed:`, error);
      throw error;
    }
  }

  async generatePaperJS(
    request: PaperJSGenerateRequest
  ): Promise<AIProviderResponse<PaperJSResult>> {
    this.logger.log(`📐 Generating Paper.js code...`);

    try {
      const client = this.ensureClient();
      // 使用 gemini-3-pro-preview，与文本对话保持一致
      const model = request.model || 'gemini-3-pro-preview';

      // 系统提示词
      const systemPrompt = `你是一个paper.js代码专家，请根据我的需求帮我生成纯净的paper.js代码，不用其他解释或无效代码，确保使用view.center作为中心，并围绕中心绘图`;

      // 将系统提示词和用户输入拼接
      const finalPrompt = `${systemPrompt}\n\n${request.prompt}`;

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

              // 配置 thinking_level（Gemini 3 特性）
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

      if (!result.text) {
        throw new Error('No code response from API');
      }

      // 清理响应，移除 markdown 代码块包装
      const cleanedCode = this.cleanCodeResponse(result.text);

      this.logger.log(`✅ Paper.js code generation succeeded with ${cleanedCode.length} characters`);

      return {
        success: true,
        data: {
          code: cleanedCode,
        },
      };
    } catch (error) {
      this.logger.error('❌ Paper.js code generation failed:', error);
      return {
        success: false,
        error: {
          code: 'PAPERJS_GENERATION_FAILED',
          message: error instanceof Error ? error.message : 'Failed to generate Paper.js code',
          details: error,
        },
      };
    }
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

  isAvailable(): boolean {
    return !!this.genAI;
  }

  getProviderInfo() {
    return {
      name: 'Google Gemini Pro',
      version: '3.0',
      supportedModels: ['gemini-3-pro-image-preview', 'gemini-3-pro-preview'],
    };
  }
}
