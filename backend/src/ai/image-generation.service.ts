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
  imageOnly?: boolean;
}

interface EditImageRequest {
  prompt: string;
  sourceImage: string; // base64
  model?: string;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
  imageOnly?: boolean;
}

interface BlendImagesRequest {
  prompt: string;
  sourceImages: string[]; // base64 array
  model?: string;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
  imageOnly?: boolean;
}

interface AnalyzeImageRequest {
  prompt?: string;
  sourceImage: string; // base64
  model?: string;
}

interface TextChatRequest {
  prompt: string;
  model?: string;
  enableWebSearch?: boolean;
}

interface ParsedStreamResponse {
  imageBytes: string | null;
  textResponse: string;
}

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);
  private readonly genAI: GoogleGenAI | null;
  private readonly DEFAULT_MODEL = 'gemini-2.5-flash-image';
  private readonly DEFAULT_TIMEOUT = 120000;
  private readonly MAX_IMAGE_RETRIES = 5;
  private readonly IMAGE_RETRY_DELAY_BASE = 500;

  constructor(private readonly config: ConfigService) {
    const apiKey =
      this.config.get<string>('GOOGLE_GEMINI_API_KEY') ??
      this.config.get<string>('VITE_GOOGLE_GEMINI_API_KEY');

    if (!apiKey) {
      this.logger.warn('Google Gemini API key not configured. Image generation will be unavailable.');
      this.genAI = null;
      return;
    }

    this.genAI = new GoogleGenAI({ apiKey });
    this.logger.log('Google GenAI client initialized for image generation.');
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
      throw new BadRequestException(`${context} image payload is empty`);
    }

    const trimmed = imageInput.trim();

    if (trimmed.startsWith('data:image/')) {
      const match = trimmed.match(/^data:(image\/[\w.+-]+);base64,(.+)$/i);
      if (!match) {
        this.logger.warn(`Invalid data URL detected for ${context} image: ${trimmed.substring(0, 30)}...`);
        throw new BadRequestException(`Invalid data URL format for ${context} image`);
      }

      const [, mimeType, base64Data] = match;
      const sanitized = base64Data.replace(/\s+/g, '');

      return {
        data: sanitized,
        mimeType: mimeType || 'image/png',
      };
    }

    // 某些前端环境可能在字符串两端添加引号
    const withoutQuotes = trimmed.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
    const sanitized = withoutQuotes.replace(/\s+/g, '');
    const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;

    if (!base64Regex.test(sanitized)) {
      this.logger.warn(
        `Unsupported ${context} image payload received. Length=${sanitized.length}, preview="${sanitized.substring(
          0,
          30,
        )}"`,
      );
      throw new BadRequestException(
        `Unsupported ${context} image format. Expected a base64 string or data URL.`,
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
    maxRetries: number = 2,
    baseDelay: number = 1000
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

        if (attempt <= maxRetries) {
          const delay = baseDelay;
          this.logger.warn(`${operationType} attempt ${attempt} failed: ${lastError.message}, retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          this.logger.error(`${operationType} failed after all attempts`);
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

  async generateImage(request: GenerateImageRequest): Promise<ImageGenerationResult> {
    this.logger.log(`Generating image with prompt: ${request.prompt.substring(0, 50)}...`);

    const client = this.ensureClient();
    const model = request.model || this.DEFAULT_MODEL;
    const startTime = Date.now();

    let lastResult: ParsedStreamResponse | null = null;

    for (let attempt = 1; attempt <= this.MAX_IMAGE_RETRIES; attempt++) {
      this.logger.debug(`Image generation attempt ${attempt}/${this.MAX_IMAGE_RETRIES}`);

      try {
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
                };

                const responseModalities = request.imageOnly ? ['Image'] : ['Text', 'Image'];
                config.responseModalities = responseModalities;

                if (request.aspectRatio) {
                  config.imageConfig = {
                    aspectRatio: request.aspectRatio,
                  };
                }

                const stream = await client.models.generateContentStream({
                  model,
                  contents: request.prompt,
                  config,
                });

                return this.parseStreamResponse(stream, 'Image generation');
              })(),
              this.DEFAULT_TIMEOUT,
              'Image generation request'
            );
          },
          'Image generation',
          3,
          1000
        );

        lastResult = result;

        if (result.imageBytes && result.imageBytes.length > 0) {
          this.logger.log(`Successfully generated image on attempt ${attempt}`);
          break;
        } else {
          this.logger.warn(`Attempt ${attempt} did not return image data`);

          if (attempt < this.MAX_IMAGE_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, this.IMAGE_RETRY_DELAY_BASE));
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Image generation attempt ${attempt} failed: ${message}`);

        if (attempt === this.MAX_IMAGE_RETRIES) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, this.IMAGE_RETRY_DELAY_BASE));
      }
    }

    if (!lastResult) {
      throw new Error('All image generation attempts failed');
    }

    const processingTime = Date.now() - startTime;
    this.logger.log(`Image generation completed in ${processingTime}ms`);

    return {
      imageData: lastResult.imageBytes || undefined,
      textResponse: lastResult.textResponse || '',
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

    const client = this.ensureClient();
    const model = request.model || this.DEFAULT_MODEL;
    const startTime = Date.now();

    let lastResult: ParsedStreamResponse | null = null;

    for (let attempt = 1; attempt <= this.MAX_IMAGE_RETRIES; attempt++) {
      this.logger.debug(`Image edit attempt ${attempt}/${this.MAX_IMAGE_RETRIES}`);

      try {
        const result = await this.withTimeout(
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
            };

            const responseModalities = request.imageOnly ? ['Image'] : ['Text', 'Image'];
            config.responseModalities = responseModalities;

            if (request.aspectRatio) {
              config.imageConfig = {
                aspectRatio: request.aspectRatio,
              };
            }

            const stream = await client.models.generateContentStream({
              model,
              contents: [
                { text: request.prompt },
                {
                  inlineData: {
                    mimeType: sourceMimeType,
                    data: sourceImageData,
                  },
                },
              ],
              config,
            });

            return this.parseStreamResponse(stream, 'Image edit');
          })(),
          this.DEFAULT_TIMEOUT,
          'Image edit request'
        );

        lastResult = result;

        if (result.imageBytes && result.imageBytes.length > 0) {
          this.logger.log(`Successfully edited image on attempt ${attempt}`);
          break;
        } else {
          this.logger.warn(`Attempt ${attempt} did not return image data`);

          if (attempt < this.MAX_IMAGE_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, this.IMAGE_RETRY_DELAY_BASE));
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Image edit attempt ${attempt} failed: ${message}`);

        if (attempt === this.MAX_IMAGE_RETRIES) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, this.IMAGE_RETRY_DELAY_BASE));
      }
    }

    if (!lastResult) {
      throw new Error('All image edit attempts failed');
    }

    const processingTime = Date.now() - startTime;
    this.logger.log(`Image edit completed in ${processingTime}ms`);

    return {
      imageData: lastResult.imageBytes || undefined,
      textResponse: lastResult.textResponse || '',
    };
  }

  async blendImages(request: BlendImagesRequest): Promise<ImageGenerationResult> {
    this.logger.log(`Blending ${request.sourceImages.length} images with prompt: ${request.prompt.substring(0, 50)}...`);

    const client = this.ensureClient();
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

    let lastResult: ParsedStreamResponse | null = null;

    for (let attempt = 1; attempt <= this.MAX_IMAGE_RETRIES; attempt++) {
      this.logger.debug(`Image blend attempt ${attempt}/${this.MAX_IMAGE_RETRIES}`);

      try {
        const result = await this.withTimeout(
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
            };

            const responseModalities = request.imageOnly ? ['Image'] : ['Text', 'Image'];
            config.responseModalities = responseModalities;

            if (request.aspectRatio) {
              config.imageConfig = {
                aspectRatio: request.aspectRatio,
              };
            }

            const stream = await client.models.generateContentStream({
              model,
              contents: [{ text: request.prompt }, ...imageParts],
              config,
            });

            return this.parseStreamResponse(stream, 'Image blend');
          })(),
          this.DEFAULT_TIMEOUT,
          'Image blend request'
        );

        lastResult = result;

        if (result.imageBytes && result.imageBytes.length > 0) {
          this.logger.log(`Successfully blended images on attempt ${attempt}`);
          break;
        } else {
          this.logger.warn(`Attempt ${attempt} did not return image data`);

          if (attempt < this.MAX_IMAGE_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, this.IMAGE_RETRY_DELAY_BASE));
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Image blend attempt ${attempt} failed: ${message}`);

        if (attempt === this.MAX_IMAGE_RETRIES) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, this.IMAGE_RETRY_DELAY_BASE));
      }
    }

    if (!lastResult) {
      throw new Error('All image blend attempts failed');
    }

    const processingTime = Date.now() - startTime;
    this.logger.log(`Image blend completed in ${processingTime}ms`);

    return {
      imageData: lastResult.imageBytes || undefined,
      textResponse: lastResult.textResponse || '',
    };
  }

  async analyzeImage(request: AnalyzeImageRequest): Promise<{ text: string }> {
    this.logger.log(`Analyzing image with prompt: ${request.prompt?.substring(0, 50) || 'full analysis'}...`);

    const { data: sourceImageData, mimeType: sourceMimeType } = this.normalizeImageInput(
      request.sourceImage,
      'analysis',
    );
    this.logger.debug(
      `Normalized analysis source image: mimeType=${sourceMimeType}, length=${sourceImageData.length}`,
    );

    const client = this.ensureClient();
    const model = request.model || 'gemini-2.0-flash';

    const analysisPrompt = request.prompt
      ? `Please analyze the following image (respond in Chinese):\n\n${request.prompt}`
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
                      data: sourceImageData,
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

              const streamResult = await this.parseStreamResponse(stream, 'Image analysis');
              return { text: streamResult.textResponse };
            })(),
            this.DEFAULT_TIMEOUT,
            'Image analysis request'
          ),
        'Image analysis',
        2,
        1200
      );

      const processingTime = Date.now() - startTime;
      this.logger.log(`Image analysis completed in ${processingTime}ms`);

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

    const client = this.ensureClient();
    const model = request.model || 'gemini-2.0-flash';
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
}
