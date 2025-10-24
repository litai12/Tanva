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
 * Kuai API Provider - 通过 HTTP 代理调用 Gemini API
 * 文档: https://apis.kuai.host/
 */
@Injectable()
export class KuaiProvider implements IAIProvider {
  private readonly logger = new Logger(KuaiProvider.name);
  private apiKey: string | null = null;
  private readonly apiBaseUrl = 'https://apis.kuai.host/v1beta/models';
  private readonly DEFAULT_MODEL = 'gemini-2.5-flash-image-preview';
  private readonly DEFAULT_TIMEOUT = 120000;
  private readonly MAX_RETRIES = 3;

  constructor(private readonly config: ConfigService) {}

  async initialize(): Promise<void> {
    this.apiKey = this.config.get<string>('KUAI_API_KEY') ?? null;

    if (!this.apiKey) {
      this.logger.warn('Kuai API key not configured.');
      return;
    }

    this.logger.log('Kuai API provider initialized successfully');
  }

  private ensureApiKey(): string {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('Kuai API key not configured on the server.');
    }
    return this.apiKey;
  }

  private normalizeModelName(model: string): string {
    const trimmed = model ? model.trim() : '';
    const withoutPrefix = trimmed.startsWith('kuai-') ? trimmed.substring(5) : trimmed;

    if (!withoutPrefix) {
      return this.DEFAULT_MODEL;
    }

    if (withoutPrefix === 'gemini-2.5-flash-image') {
      return 'gemini-2.5-flash-image-preview';
    }

    return withoutPrefix;
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
      throw new Error(`Unsupported ${context} image format. Expected a base64 string or data URL.`);
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
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
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

  private buildContents(input: any): any[] {
    if (!input) {
      return [];
    }

    if (Array.isArray(input)) {
      return input.map((item) => {
        if (item?.role && item?.parts) {
          return item;
        }

        const parts = Array.isArray(item?.parts)
          ? item.parts
          : item?.text || typeof item === 'string'
          ? [{ text: typeof item === 'string' ? item : String(item) }]
          : [item];

        return { role: item?.role || 'user', parts };
      });
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

  private ensureBearerAuthorization(apiKey: string): string {
    const key = apiKey.replace(/^Bearer\s+/i, '').trim();
    return key ? `Bearer ${key}` : 'Bearer';
  }

  private sanitizeToolSelectionResponse(response: string): string {
    if (!response) {
      return response;
    }

    let text = response.trim();

    if (text.startsWith('```json')) {
      text = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    } else if (text.startsWith('```')) {
      text = text.replace(/^```\s*/i, '').replace(/\s*```$/, '');
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }

    return text;
  }

  private pickAvailableTool(desired: string, available?: string[]): string {
    if (!available || available.length === 0) {
      return desired;
    }

    if (available.includes(desired)) {
      return desired;
    }

    if (available.includes('chatResponse')) {
      return 'chatResponse';
    }

    return available[0];
  }

  private fallbackToolSelection(
    request: ToolSelectionRequest,
    reason: string
  ): { tool: string; reasoning: string; confidence: number } {
    const available = request.availableTools;
    const prompt = (request.prompt || '').toLowerCase();
    const hasImages = Boolean(request.hasImages || request.imageCount || request.hasCachedImage);
    const imageCount = request.imageCount ?? 0;

    const pick = (tool: string, fallbackReason: string, confidence = 0.6) => ({
      tool: this.pickAvailableTool(tool, available),
      reasoning: fallbackReason,
      confidence,
    });

    if (!hasImages) {
      return pick('generateImage', reason || 'No input images detected, defaulting to image generation.', 0.7);
    }

    if (imageCount > 1) {
      return pick('blendImages', reason || 'Multiple images supplied, using blend operation.', 0.75);
    }

    const analyzeKeywords = ['分析', '解释', '分析下', 'describe', 'analysis', '分析一下'];
    if (analyzeKeywords.some((keyword) => prompt.includes(keyword))) {
      return pick('analyzeImage', reason || 'Prompt indicates image analysis is required.', 0.7);
    }

    const editKeywords = ['修改', '编辑', '调整', '重绘', '修复', 'edit', 'modify', 'refine'];
    if (editKeywords.some((keyword) => prompt.includes(keyword))) {
      return pick('editImage', reason || 'Prompt suggests editing an existing image.', 0.7);
    }

    return pick('editImage', reason || 'Single input image provided; defaulting to edit mode.', 0.65);
  }

  private async makeRequest(
    model: string,
    contents: any,
    config?: any
  ): Promise<{ imageBytes: string | null; textResponse: string }> {
    const apiKey = this.ensureApiKey();
    const url = `${this.apiBaseUrl}/${model}:generateContent`;

    const headers = {
      Authorization: this.ensureBearerAuthorization(apiKey),
      'Content-Type': 'application/json',
    };

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

    this.logger.debug(`Making request to ${url}`, { 
      model,
      apiKey: apiKey.substring(0, 10) + '...',
      body: JSON.stringify(body).substring(0, 200) 
    });

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error(`API error response: ${errorData}`);
      throw new Error(`Kuai API request failed: ${response.status} ${response.statusText} - ${errorData}`);
    }

    const data = await response.json();
    return this.parseResponse(data, 'API call');
  }

  private parseResponse(data: any, operationType: string): { imageBytes: string | null; textResponse: string } {
    this.logger.debug(`Parsing ${operationType} response...`);

    let textResponse = '';
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

  async editImage(request: ImageEditRequest): Promise<AIProviderResponse<ImageResult>> {
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
      const apiConfig: any = {
        responseModalities: ['TEXT'],
      };

      if (request.enableWebSearch) {
        apiConfig.tools = [{ googleSearch: {} }];
      }

      const result = await this.withTimeout(
        (async () => {
          return await this.makeRequest(model, request.prompt, apiConfig);
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
    this.logger.log('🎯 Selecting tool with intelligent Kuai strategy...', {
      prompt: request.prompt.substring(0, 50),
      availableTools: request.availableTools,
      hasImages: request.hasImages,
      imageCount: request.imageCount,
    });

    try {
      // 🔥 使用智能推理而非固定策略
      const fallback = this.fallbackToolSelection(request, 'Using intelligent Kuai tool selection');

      this.logger.log('✅ Tool selection completed:', {
        selectedTool: fallback.tool,
        reasoning: fallback.reasoning,
        confidence: fallback.confidence,
      });

      return {
        success: true,
        data: {
          selectedTool: fallback.tool,
          reasoning: fallback.reasoning,
          confidence: fallback.confidence,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('❌ Tool selection failed, falling back to generateImage:', errorMsg);

      const selectedTool = this.pickAvailableTool('generateImage', request.availableTools);
      return {
        success: true,
        data: {
          selectedTool,
          reasoning: `Failed to perform intelligent selection: ${errorMsg}. Defaulting to ${selectedTool}.`,
          confidence: 0.5,
        },
      };
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  getProviderInfo() {
    return {
      name: 'Kuai API',
      version: '1.0',
      supportedModels: ['gemini-2.5-flash-image', 'gemini-2.0-flash'],
    };
  }
}
