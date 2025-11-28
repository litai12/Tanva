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

@Injectable()
export class GeminiProProvider implements IAIProvider {
  private readonly logger = new Logger(GeminiProProvider.name);
  private genAI: GoogleGenAI | null = null;
  private readonly DEFAULT_MODEL = 'gemini-3-pro-image-preview';
  private readonly DEFAULT_TIMEOUT = 120000;
  private readonly EDIT_TIMEOUT = 180000; // 3分钟，编辑图像需要更长时间
  private readonly MAX_RETRIES = 3;

  private readonly DEFAULT_AVAILABLE_TOOLS = [
    'generateImage',
    'editImage',
    'blendImages',
    'analyzeImage',
    'chatResponse',
  ];

  private readonly TOOL_DESCRIPTION_MAP: Record<string, string> = {
    generateImage: '生成新的图像',
    editImage: '编辑现有图像',
    blendImages: '融合多张图像',
    analyzeImage: '分析图像内容',
    chatResponse: '文本对话或聊天',
  };

  constructor(private readonly config: ConfigService) {}

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
    ];

    const head = data.substring(0, 20);
    for (const check of headerChecks) {
      if (head.startsWith(check.prefix)) {
        return check.mime;
      }
    }

    return 'image/png';
  }

  private normalizeImageInput(imageInput: string, context: string): { data: string; mimeType: string } {
    if (!imageInput || imageInput.trim().length === 0) {
      throw new Error(`${context} image payload is empty`);
    }

    const trimmed = imageInput.trim();

    let sanitized: string;
    let mimeType: string;

    if (trimmed.startsWith('data:image/')) {
      const match = trimmed.match(/^data:(image\/[\w.+-]+);base64,(.+)$/i);
      if (!match) {
        throw new Error(`Invalid data URL format for ${context} image`);
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
          `Unsupported ${context} image format. Expected a base64 string or data URL.`
        );
      }

      mimeType = this.inferMimeTypeFromBase64(sanitized);
    }

    // 验证图像大小（base64编码后的数据，实际图像大小约为 base64 长度的 3/4）
    // 限制 base64 数据最大为 20MB，对应实际图像约 15MB
    const MAX_BASE64_SIZE = 20 * 1024 * 1024; // 20MB
    if (sanitized.length > MAX_BASE64_SIZE) {
      const actualSizeMB = (sanitized.length * 3 / 4 / 1024 / 1024).toFixed(2);
      this.logger.warn(
        `${context} image is too large. Base64 length: ${sanitized.length}, estimated size: ${actualSizeMB}MB`,
      );
      throw new Error(
        `${context} image is too large. Maximum size is 15MB (base64: ~20MB). Current size: ~${actualSizeMB}MB`,
      );
    }

    return {
      data: sanitized,
      mimeType,
    };
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
    this.logger.log(`Generating image with prompt: ${request.prompt.substring(0, 50)}...`);

    try {
      const client = this.ensureClient();
      const model = request.model || this.DEFAULT_MODEL;

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

              // 配置 imageConfig（aspectRatio 和 imageSize）
              if (request.aspectRatio || request.imageSize) {
                config.generationConfig.imageConfig = {};
                if (request.aspectRatio) {
                  config.generationConfig.imageConfig.aspectRatio = request.aspectRatio;
                }
                if (request.imageSize) {
                  config.generationConfig.imageConfig.imageSize = request.imageSize;
                }
              }

              // 配置 thinking_level（Gemini 3 特性，参考官方文档）
              if (request.thinkingLevel) {
                config.generationConfig.thinking_level = request.thinkingLevel;
              }

              const response = await client.models.generateContent({
                model,
                contents: request.prompt,
                config,
              });

              return this.parseNonStreamResponse(response, 'Image generation');
            })(),
            this.DEFAULT_TIMEOUT,
            'Image generation'
          );
        },
        'Image generation'
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
      this.logger.error('Image generation failed:', error);
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

              // 配置 imageConfig（aspectRatio 和 imageSize）
              if (request.aspectRatio || request.imageSize) {
                config.generationConfig.imageConfig = {};
                if (request.aspectRatio) {
                  config.generationConfig.imageConfig.aspectRatio = request.aspectRatio;
                }
                if (request.imageSize) {
                  config.generationConfig.imageConfig.imageSize = request.imageSize;
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
              const response = await client.models.generateContent({
                model,
                contents,
                config,
              });

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

              // 配置 imageConfig（aspectRatio 和 imageSize）
              if (request.aspectRatio || request.imageSize) {
                config.generationConfig.imageConfig = {};
                if (request.aspectRatio) {
                  config.generationConfig.imageConfig.aspectRatio = request.aspectRatio;
                }
                if (request.imageSize) {
                  config.generationConfig.imageConfig.imageSize = request.imageSize;
                }
              }

              // 配置 thinking_level（Gemini 3 特性，参考官方文档）
              if (request.thinkingLevel) {
                config.generationConfig.thinking_level = request.thinkingLevel;
              }

              const response = await client.models.generateContent({
                model,
                contents: [{ text: request.prompt }, ...imageParts],
                config,
              });

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
    this.logger.log(`Analyzing image...`);

    try {
      const { data: imageData, mimeType } = this.normalizeImageInput(request.sourceImage, 'analysis');
      const client = this.ensureClient();

      const analysisPrompt = request.prompt
        ? `Please analyze the following image (respond in ${request.prompt})`
        : `Please analyze this image in detail`;

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
                      data: imageData,
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
                throw new Error('Image analysis API returned empty response');
              }

              return { text: response.text };
            })(),
            this.DEFAULT_TIMEOUT,
            'Image analysis'
          ),
        'Image analysis',
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

  async selectTool(
    request: ToolSelectionRequest
  ): Promise<AIProviderResponse<ToolSelectionResult>> {
    this.logger.log('Selecting tool...');

    try {
      const client = this.ensureClient();
      const maxAttempts = 3;
      const delayMs = 1000;
      let lastError: unknown;

      // 获取可用工具列表
      const availableTools = request.availableTools && request.availableTools.length > 0
        ? request.availableTools
        : this.DEFAULT_AVAILABLE_TOOLS;

      // 构建工具列表描述
      const toolList = availableTools
        .map((tool) => {
          const description = this.TOOL_DESCRIPTION_MAP[tool] || '自定义工具';
          return `- ${tool}: ${description}`;
        })
        .join('\n');

      // 构建上下文信息（参考 ai.service.ts 的简洁方式）
      const contextInfo: string[] = [];
      contextInfo.push(`用户输入: ${request.prompt}`);
      
      if (request.hasImages !== undefined) {
        contextInfo.push(`用户是否提供了图像: ${request.hasImages ? '是' : '否'}`);
      }
      if (request.imageCount !== undefined) {
        contextInfo.push(`显式提供的图像数量: ${request.imageCount}`);
      }
      if (request.hasCachedImage !== undefined) {
        contextInfo.push(`是否存在缓存图像: ${request.hasCachedImage ? '是' : '否'}`);
      }
      if (request.context?.trim()) {
        contextInfo.push(`额外上下文: ${request.context.trim()}`);
      }

      // 工具选择的系统提示（参考 ai.service.ts 的简洁实现）
      const systemPrompt = `你是一个AI助手工具选择器。根据用户的输入，选择最合适的工具执行。

可用工具:
${toolList}

请以以下JSON格式回复（仅返回JSON，不要其他文字）:
{
  "selectedTool": "工具名称",
  "reasoning": "选择理由"
}`;

      const userPrompt = contextInfo.join('\n');

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const response = await client.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: [
              { text: systemPrompt },
              { text: userPrompt },
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

          // 解析AI的JSON响应（参考 ai.service.ts 的实现）
          try {
            // 提取 JSON 内容（可能被 markdown 代码块包装）
            let jsonText = response.text.trim();

            // 移除 markdown 代码块标记
            if (jsonText.startsWith('```json')) {
              jsonText = jsonText.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
            } else if (jsonText.startsWith('```')) {
              jsonText = jsonText.replace(/^```\s*/i, '').replace(/\s*```$/, '');
            }

            const parsed = JSON.parse(jsonText.trim());
            const rawTool = typeof parsed.selectedTool === 'string' ? parsed.selectedTool.trim() : '';
            
            // 验证工具是否在可用工具列表中
            const normalizedTool = availableTools.find(
              (tool) => tool.toLowerCase() === rawTool.toLowerCase()
            ) || this.selectFallbackTool(availableTools);
            
            const reasoning =
              typeof parsed.reasoning === 'string' && parsed.reasoning.trim().length
                ? parsed.reasoning.trim()
                : `AI 建议使用 ${normalizedTool}`;

            this.logger.log(`Tool selected: ${normalizedTool}`);

            return {
              success: true,
              data: {
                selectedTool: normalizedTool,
                reasoning,
                confidence: 0.85,
              },
            };
          } catch (parseError) {
            this.logger.warn(`Failed to parse tool selection JSON: ${response.text}`);
            // 降级：如果解析失败，使用回退工具
            const fallbackTool = this.selectFallbackTool(availableTools);
            return {
              success: true,
              data: {
                selectedTool: fallbackTool,
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

      // 最后的降级方案：返回回退工具
      const fallbackTool = this.selectFallbackTool(availableTools);
      return {
        success: true,
        data: {
          selectedTool: fallbackTool,
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

  private selectFallbackTool(availableTools: string[]): string {
    if (availableTools.includes('chatResponse')) {
      return 'chatResponse';
    }
    return availableTools[0] || 'chatResponse';
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
