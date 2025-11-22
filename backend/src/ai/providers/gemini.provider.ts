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
export class GeminiProvider implements IAIProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private genAI: GoogleGenAI | null = null;
  private readonly DEFAULT_MODEL = 'gemini-2.5-flash-image';
  private readonly DEFAULT_TIMEOUT = 120000;
  private readonly MAX_RETRIES = 3;

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

              // 配置 thinkingLevel（Gemini 3 特性，但保持兼容性）
              if (request.thinkingLevel) {
                config.generationConfig.thinkingLevel = request.thinkingLevel;
              }

              const stream = await client.models.generateContentStream({
                model,
                contents: request.prompt,
                config,
              });

              return this.parseStreamResponse(stream, 'Image generation');
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

      const result = await this.withTimeout(
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

          // 配置 thinkingLevel（Gemini 3 特性，但保持兼容性）
          if (request.thinkingLevel) {
            config.generationConfig.thinkingLevel = request.thinkingLevel;
          }

          const stream = await client.models.generateContentStream({
            model,
            contents: [
              { text: request.prompt },
              {
                inlineData: {
                  mimeType: mimeType || 'image/png',
                  data: imageData,
                },
              },
            ],
            config,
          });

          return this.parseStreamResponse(stream, 'Image edit');
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

      const result = await this.withTimeout(
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

          // 配置 thinkingLevel（Gemini 3 特性，但保持兼容性）
          if (request.thinkingLevel) {
            config.generationConfig.thinkingLevel = request.thinkingLevel;
          }

          const stream = await client.models.generateContentStream({
            model,
            contents: [{ text: request.prompt }, ...imageParts],
            config,
          });

          return this.parseStreamResponse(stream, 'Image blend');
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
      const client = this.ensureClient();

      const analysisPrompt = request.prompt
        ? `Please analyze the following image (respond in ${request.prompt})`
        : `Please analyze this image in detail`;

      const result = await this.withRetry(
        () =>
          this.withTimeout(
            (async () => {
              const stream = await client.models.generateContentStream({
                model: 'gemini-2.0-flash',
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

              const streamResult = await this.parseStreamResponse(stream, 'Image analysis');
              return { text: streamResult.textResponse };
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

      const result = await this.withTimeout(
        (async () => {
          const apiConfig: any = {
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
          };

          if (request.enableWebSearch) {
            apiConfig.tools = [{ googleSearch: {} }];
          }

          const stream = await client.models.generateContentStream({
            model: 'gemini-2.0-flash',
            contents: [{ text: finalPrompt }],
            config: apiConfig,
          });

          const streamResult = await this.parseStreamResponse(stream, 'Text generation');
          return { text: streamResult.textResponse };
        })(),
        this.DEFAULT_TIMEOUT,
        'Text generation'
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

      const result = await this.withRetry(
        async () => {
          return await this.withTimeout(
            (async () => {
              const response = await client.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: [{ text: request.prompt }],
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

              return { text: response.text };
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
          reasoning: result.text || '',
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
      name: 'Google Gemini',
      version: '2.5',
      supportedModels: ['gemini-2.5-flash-image', 'gemini-2.0-flash'],
    };
  }
}
