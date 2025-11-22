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
  AIProviderResponse,
  ImageResult,
  AnalysisResult,
  TextResult,
  ToolSelectionResult,
} from './ai-provider.interface';

@Injectable()
export class GeminiProProvider implements IAIProvider {
  private readonly logger = new Logger(GeminiProProvider.name);
  private genAI: GoogleGenAI | null = null;
  private readonly DEFAULT_MODEL = 'gemini-3-pro-image-preview';
  private readonly DEFAULT_TIMEOUT = 120000;
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

    if (trimmed.startsWith('data:image/')) {
      const match = trimmed.match(/^data:(image\/[\w.+-]+);base64,(.+)$/i);
      if (!match) {
        throw new Error(`Invalid data URL format for ${context} image`);
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
        `Unsupported ${context} image format. Expected a base64 string or data URL.`
      );
    }

    return {
      data: sanitized,
      mimeType: this.inferMimeTypeFromBase64(sanitized),
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

              try {
                // 默认使用非流式 API（更稳定）
                this.logger.debug('Calling non-stream generateContent for image edit...');
                const response = await client.models.generateContent({
                  model,
                  contents,
                  config,
                });
                
                this.logger.debug('Non-stream response received:', {
                  hasCandidates: !!response.candidates,
                  candidatesLength: response.candidates?.length,
                  hasContent: !!response.candidates?.[0]?.content,
                  hasParts: !!response.candidates?.[0]?.content?.parts,
                });
                
                if (!response.candidates?.[0]?.content?.parts) {
                  this.logger.error('Non-stream API returned empty response:', {
                    response: JSON.stringify(response, null, 2).substring(0, 500),
                  });
                  throw new Error('Non-stream API returned empty response');
                }
                
                const result = this.parseNonStreamResponse(response, 'Image edit');
                this.logger.log('Image edit non-stream API succeeded');
                return result;
              } catch (nonStreamError) {
                // 如果非流式 API 失败，降级到流式 API
                const isNetworkError = this.isRetryableError(
                  nonStreamError instanceof Error ? nonStreamError : new Error(String(nonStreamError))
                );
                
                if (isNetworkError) {
                  this.logger.warn('Image edit non-stream API failed, falling back to stream API...');
                  try {
                    const stream = await client.models.generateContentStream({
                      model,
                      contents,
                      config,
                    });

                    const streamResult = await this.parseStreamResponse(stream, 'Image edit');
                    this.logger.log('Image edit stream API fallback succeeded');
                    return streamResult;
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
            'Image edit'
          );
        },
        'Image edit'
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
            this.DEFAULT_TIMEOUT,
            'Image blend'
          );
        },
        'Image blend'
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
