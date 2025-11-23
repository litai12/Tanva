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
  private readonly DEFAULT_MODEL = 'gemini-3-pro-image-preview';
  private readonly DEFAULT_TIMEOUT = 120000;
  private readonly EDIT_TIMEOUT = 180000; // 3分钟，编辑图像需要更长时间
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

    let sanitized: string;
    let mimeType: string;

    if (trimmed.startsWith('data:image/')) {
      const match = trimmed.match(/^data:(image\/[\w.+-]+);base64,(.+)$/i);
      if (!match) {
        this.logger.warn(`Invalid data URL detected for ${context} image: ${trimmed.substring(0, 30)}...`);
        throw new BadRequestException(`Invalid data URL format for ${context} image`);
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
          `Unsupported ${context} image payload received. Length=${sanitized.length}, preview="${sanitized.substring(
            0,
            30,
          )}"`,
        );
        throw new BadRequestException(
          `Unsupported ${context} image format. Expected a base64 string or data URL.`,
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
      throw new BadRequestException(
        `${context} image is too large. Maximum size is 15MB (base64: ~20MB). Current size: ~${actualSizeMB}MB`,
      );
    }

    return {
      data: sanitized,
      mimeType,
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

                // 配置 thinkingLevel（Gemini 3 特性）
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

                // 配置 thinkingLevel（Gemini 3 特性）
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

                try {
                  this.logger.debug('Calling non-stream generateContent for image edit...');
                  const response = await client.models.generateContent({
                    model,
                    contents,
                    config,
                  });

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
                    'fetch',
                    'network',
                    'timeout',
                    'socket',
                    'connection',
                    'econn',
                    'enotfound',
                    'refused',
                    'empty response',
                    'no image data',
                  ];
                  const shouldFallback = fallbackTriggers.some((keyword) =>
                    normalizedMessage.includes(keyword)
                  );

                  if (!shouldFallback) {
                    throw nonStreamError;
                  }

                  this.logger.warn(`Image edit non-stream API failed (${errorMessage}), falling back to stream API...`);

                  try {
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
                  } catch (fallbackError) {
                    const fallbackMessage =
                      fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                    this.logger.error(
                      `Both non-stream and stream API failed. Non-stream: ${errorMessage}, Stream: ${fallbackMessage}`
                    );
                    throw new Error(`Image edit failed: ${errorMessage}. Fallback also failed: ${fallbackMessage}`);
                  }
                }
              })(),
              this.EDIT_TIMEOUT,
              'Image edit request'
            );
          },
          'Image edit',
          3,
          1000
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

            // 配置 thinkingLevel（Gemini 3 特性）
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

  /**
   * 生成 Paper.js 代码
   */
  async generatePaperJSCode(request: {
    prompt: string;
    model?: string;
    thinkingLevel?: 'high' | 'low';
    canvasWidth?: number;
    canvasHeight?: number;
  }): Promise<{ code: string; explanation?: string; model: string }> {
    this.logger.log(`Starting Paper.js code generation: ${request.prompt.substring(0, 50)}...`);
    const startTime = Date.now();

    try {
      const client = this.ensureClient();
      const model = request.model || 'gemini-2.0-flash';
      const canvasWidth = request.canvasWidth || 1920;
      const canvasHeight = request.canvasHeight || 1080;

      // 系统提示词 - 使用用户提供的简洁版本
      const systemPrompt = `你是一个paper.js代码专家，请根据我的需求帮我生成纯净的paper.js代码，不用其他解释或无效代码，确保使用view.center作为中心，并围绕中心绘图`;

      // 用户提示词
      const userPrompt = `画布尺寸: ${canvasWidth}x${canvasHeight}
用户需求: ${request.prompt}

请生成符合要求的 Paper.js 代码。`;

      const finalPrompt = `${systemPrompt}\n\n${userPrompt}`;

      this.logger.debug(`Paper.js generation prompt: ${finalPrompt.substring(0, 100)}...`);

      // 🔄 使用重试机制
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
              };

              // 如果设置了高级思考模式
              if (request.thinkingLevel === 'high') {
                apiConfig.thinkingLevel = 'high';
              }

              const stream = await client.models.generateContentStream({
                model,
                contents: [{ text: finalPrompt }],
                config: apiConfig,
              });

              const streamResult = await this.parseStreamResponse(stream, 'Paper.js code generation');
              return { text: streamResult.textResponse };
            })(),
            this.DEFAULT_TIMEOUT,
            'Paper.js code generation request'
          );
        },
        'Paper.js code generation',
        2, // maxRetries: 2次重试
        1000 // baseDelay: 1秒延迟
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
