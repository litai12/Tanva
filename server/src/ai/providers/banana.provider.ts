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
  AIProviderResponse,
  ImageResult,
  AnalysisResult,
  TextResult,
  ToolSelectionResult,
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
  private readonly apiBaseUrl = 'https://147ai.com/v1beta/models';
  private readonly DEFAULT_MODEL = 'gemini-2.5-flash-image-preview';
  private readonly DEFAULT_TIMEOUT = 120000;
  private readonly MAX_RETRIES = 3;

  constructor(private readonly config: ConfigService) {}

  async initialize(): Promise<void> {
    this.apiKey = this.config.get<string>('BANANA_API_KEY');

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
    // banana-gemini-2.5-flash-image -> gemini-2.5-flash-image
    return model.startsWith('banana-') ? model.substring(7) : model;
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
          const delay = 1000 * attempt;
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

  private async makeRequest(
    model: string,
    contents: any,
    config?: any
  ): Promise<{ imageBytes: string | null; textResponse: string }> {
    const apiKey = this.ensureApiKey();
    const url = `${this.apiBaseUrl}/${model}:generateContent`;

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    // 构建请求体，更好地支持Gemini API格式
    const body: any = {
      contents: Array.isArray(contents)
        ? contents.map(part =>
            typeof part === 'string'
              ? { role: 'user', parts: [{ text: part }] }
              : part
          )
        : [{ role: 'user', parts: [{ text: contents }] }],
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

    try {
      const model = this.normalizeModelName(request.model || this.DEFAULT_MODEL);
      this.logger.debug(`Using model: ${model}`);

      const result = await this.withRetry(
        async () => {
          return await this.withTimeout(
            (async () => {
              const config: any = {
                responseModalities: request.imageOnly ? ['IMAGE'] : ['TEXT', 'IMAGE'],
              };

              if (request.aspectRatio) {
                config.imageConfig = { aspectRatio: request.aspectRatio };
              }

              return await this.makeRequest(model, request.prompt, config);
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
      const model = this.normalizeModelName(request.model || this.DEFAULT_MODEL);

      const result = await this.withTimeout(
        (async () => {
          const config: any = {
            responseModalities: request.imageOnly ? ['IMAGE'] : ['TEXT', 'IMAGE'],
          };

          if (request.aspectRatio) {
            config.imageConfig = { aspectRatio: request.aspectRatio };
          }

          return await this.makeRequest(
            model,
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
      const model = this.normalizeModelName(request.model || this.DEFAULT_MODEL);

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

      const result = await this.withTimeout(
        (async () => {
          const config: any = {
            responseModalities: request.imageOnly ? ['IMAGE'] : ['TEXT', 'IMAGE'],
          };

          if (request.aspectRatio) {
            config.imageConfig = { aspectRatio: request.aspectRatio };
          }

          return await this.makeRequest(
            model,
            [{ text: request.prompt }, ...imageParts],
            config
          );
        })(),
        this.DEFAULT_TIMEOUT,
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
      const model = this.normalizeModelName(request.model || 'gemini-2.0-flash');

      const analysisPrompt = request.prompt
        ? `Please analyze the following image (respond in ${request.prompt})`
        : `Please analyze this image in detail`;

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
                      data: imageData,
                    },
                  },
                ],
                {}
              );
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
          text: result.textResponse,
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
      const model = this.normalizeModelName(request.model || 'gemini-2.0-flash');
      const apiConfig: any = {};

      if (request.enableWebSearch) {
        apiConfig.tools = [{ googleSearch: {} }];
      }

      const result = await this.withTimeout(
        (async () => {
          return await this.makeRequest(
            model,
            request.prompt,
            apiConfig
          );
        })(),
        this.DEFAULT_TIMEOUT,
        'Text generation'
      );

      return {
        success: true,
        data: {
          text: result.textResponse,
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
      const model = this.normalizeModelName(request.model || 'gemini-2.0-flash');

      const result = await this.withRetry(
        async () => {
          return await this.withTimeout(
            (async () => {
              return await this.makeRequest(
                model,
                request.prompt,
                {}
              );
            })(),
            this.DEFAULT_TIMEOUT,
            'Tool selection'
          );
        },
        'Tool selection'
      );

      return {
        success: true,
        data: {
          selectedTool: 'generateImage',
          reasoning: result.textResponse || '',
          confidence: 0.85,
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

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  getProviderInfo() {
    return {
      name: 'Banana API',
      version: '1.0',
      supportedModels: ['gemini-2.5-flash-image-preview', 'gemini-2.0-flash'],
    };
  }
}
