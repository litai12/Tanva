import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIProviderResponse,
  AnalysisResult,
  IAIProvider,
  ImageAnalysisRequest,
  ImageBlendRequest,
  ImageEditRequest,
  ImageGenerationRequest,
  ImageResult,
  MidjourneyActionRequest,
  MidjourneyButtonInfo,
  MidjourneyModalRequest,
  MidjourneyProviderOptions,
  PaperJSGenerateRequest,
  ProviderOptionsPayload,
  TextChatRequest,
  TextResult,
  ToolSelectionRequest,
  ToolSelectionResult,
  PaperJSResult,
} from './ai-provider.interface';

type MidjourneyTaskStatus = 'NOT_START' | 'IN_PROGRESS' | 'FAILURE' | 'FINISHED' | 'SUCCESS' | 'CANCEL';

type MidjourneyTaskResponse = {
  id: string;
  action: string;
  prompt?: string;
  promptEn?: string;
  description?: string;
  state?: string;
  submitTime?: number;
  startTime?: number;
  finishTime?: number;
  imageUrl?: string;
  imageUrls?: string[];
  videoUrl?: string;
  status: MidjourneyTaskStatus | string;
  progress?: string;
  failReason?: string;
  buttons?: MidjourneyButtonInfo[];
  properties?: Record<string, any>;
};

type MidjourneySubmitResponse = {
  code?: number;
  description?: string;
  result?: string;
  properties?: Record<string, any>;
};

@Injectable()
export class MidjourneyProvider implements IAIProvider {
  private readonly logger = new Logger(MidjourneyProvider.name);
  private readonly apiBaseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly defaultMode: 'FAST' | 'RELAX' = 'FAST';
  private apiKey: string | null = null;

  constructor(private readonly config: ConfigService) {
    this.apiBaseUrl =
      this.config.get<string>('MIDJOURNEY_API_BASE_URL') ?? 'https://api1.147ai.com';
    this.pollIntervalMs = Number(
      this.config.get<number>('MIDJOURNEY_POLL_INTERVAL_MS') ?? 4000
    );
    this.maxPollAttempts = Number(
      this.config.get<number>('MIDJOURNEY_POLL_MAX_ATTEMPTS') ?? 60
    );
  }

  async initialize(): Promise<void> {
    this.apiKey =
      this.config.get<string>('MIDJOURNEY_API_KEY') ??
      this.config.get<string>('BANANA_API_KEY') ??
      null;

    if (!this.apiKey) {
      this.logger.warn('Midjourney API key not configured. Provider will remain unavailable.');
      return;
    }

    this.logger.log('Midjourney provider initialised successfully.');
  }

  private ensureApiKey(): string {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('Midjourney API key not configured on the server.');
    }
    return this.apiKey;
  }

  private buildUrl(path: string): string {
    if (path.startsWith('http')) {
      return path;
    }
    return `${this.apiBaseUrl.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  private async apiRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    payload?: Record<string, any>,
    operation: string = 'Midjourney request'
  ): Promise<T> {
    const apiKey = this.ensureApiKey();
    const url = this.buildUrl(path);

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: apiKey,
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });

    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!response.ok) {
      this.logger.error(
        `[Midjourney] ${operation} failed: HTTP ${response.status} ${response.statusText} ${text}`
      );
      // 提取更友好的错误信息
      const errorDesc = data?.description || data?.message || response.statusText;
      throw new Error(`Midjourney ${operation} failed: ${errorDesc}`);
    }

    // 检查 API 返回的业务错误码
    if (data?.code && data.code !== 1 && data.code !== 22) {
      // code 1 = 成功, code 22 = 排队中
      const errorMsg = data.description || data.message || 'Unknown API error';
      this.logger.error(`[Midjourney] ${operation} API error: code=${data.code}, ${errorMsg}`);
      throw new Error(`Midjourney ${operation} failed: ${errorMsg}`);
    }

    return data as T;
  }

  private async submitTask(
    path: string,
    payload: Record<string, any>,
    operation: string
  ): Promise<string> {
    const response = await this.apiRequest<MidjourneySubmitResponse>(
      'POST',
      path,
      payload,
      `${operation} submit`
    );

    if (response?.code === 21) {
      throw new Error(
        response.description || 'Midjourney API requires modal input for this action.'
      );
    }

    const taskId = response?.result ?? response?.properties?.taskId;
    if (!taskId) {
      throw new Error(`[Midjourney] ${operation} did not return task id.`);
    }

    return String(taskId);
  }

  private async pollTask(taskId: string, operation: string): Promise<MidjourneyTaskResponse> {
    for (let attempt = 1; attempt <= this.maxPollAttempts; attempt += 1) {
      if (attempt > 1) {
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      }

      const task = await this.apiRequest<MidjourneyTaskResponse>(
        'GET',
        `/mj/task/${taskId}/fetch`,
        undefined,
        `${operation} poll`
      );

      const status = (task.status || '').toUpperCase();

      if (status === 'SUCCESS' || status === 'FINISHED' || status === 'COMPLETED') {
        return task;
      }

      if (status === 'FAILURE' || status === 'FAILED' || status === 'CANCEL') {
        const reason = task.failReason || task.description || 'Unknown reason';
        throw new Error(`Midjourney task ${taskId} failed: ${reason}`);
      }
    }

    throw new Error(`Midjourney task ${taskId} timed out after ${this.maxPollAttempts} attempts`);
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

  private ensureDataUrl(image: string): string {
    const trimmed = image.trim();
    if (trimmed.startsWith('data:image/')) {
      return trimmed;
    }

    // 如果是 URL，抛出错误提示需要使用异步方法
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      throw new Error(
        `Image is a URL, use ensureDataUrlAsync instead: ${trimmed.slice(0, 80)}...`
      );
    }

    const base64 = trimmed.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
    const mimeType = this.inferMimeTypeFromBase64(base64);
    return `data:${mimeType};base64,${base64}`;
  }

  private async ensureDataUrlAsync(image: string): Promise<string> {
    const trimmed = image.trim();
    if (trimmed.startsWith('data:image/')) {
      return trimmed;
    }

    // 如果是 URL，下载并转换为 base64
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      this.logger.log(`[Midjourney] Downloading image from URL: ${trimmed.slice(0, 80)}...`);
      const response = await fetch(trimmed);
      if (!response.ok) {
        throw new Error(`Failed to download image: HTTP ${response.status}`);
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        throw new Error(`URL returned non-image content: ${contentType}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const base64 = buffer.toString('base64');
      return `data:${contentType};base64,${base64}`;
    }

    const base64 = trimmed.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
    const mimeType = this.inferMimeTypeFromBase64(base64);
    return `data:${mimeType};base64,${base64}`;
  }

  private extractMidjourneyOptions(
    providerOptions?: ProviderOptionsPayload
  ): MidjourneyProviderOptions | undefined {
    return providerOptions?.midjourney;
  }

  private buildAccountFilter(options?: MidjourneyProviderOptions) {
    if (!options?.accountFilter) {
      return undefined;
    }

    const filter = options.accountFilter;
    if (
      !filter.channelId &&
      !filter.instanceId &&
      !filter.modes &&
      !filter.remark &&
      typeof filter.remix === 'undefined'
    ) {
      return undefined;
    }

    return filter;
  }

  private aspectRatioToDimensions(
    aspectRatio?: string
  ): 'SQUARE' | 'PORTRAIT' | 'LANDSCAPE' | undefined {
    if (!aspectRatio) {
      return undefined;
    }

    switch (aspectRatio) {
      case '1:1':
        return 'SQUARE';
      case '2:3':
      case '3:4':
      case '4:5':
      case '9:16':
        return 'PORTRAIT';
      case '3:2':
      case '4:3':
      case '5:4':
      case '16:9':
      case '21:9':
        return 'LANDSCAPE';
      default:
        return undefined;
    }
  }

  private extractImageUrl(task: MidjourneyTaskResponse): string | null {
    if (task.imageUrl) {
      return task.imageUrl;
    }

    if (Array.isArray(task.imageUrls) && task.imageUrls.length > 0) {
      return task.imageUrls[0];
    }

    if (task.properties?.imageUrl) {
      return task.properties.imageUrl;
    }

    return null;
  }

  private async downloadImageAsBase64(imageUrl: string | null): Promise<string | null> {
    if (!imageUrl) {
      return null;
    }

    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        this.logger.warn(
          `[Midjourney] Failed to download image: ${response.status} ${response.statusText}`
        );
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return buffer.toString('base64');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[Midjourney] Error downloading image: ${message}`);
      return null;
    }
  }

  private buildImaginePayload(request: ImageGenerationRequest): Record<string, any> {
    const options = this.extractMidjourneyOptions(request.providerOptions);
    const payload: Record<string, any> = {
      prompt: request.prompt,
      mode: options?.mode ?? this.defaultMode,
    };

    if (options?.botType) payload.botType = options.botType;
    if (options?.notifyHook) payload.notifyHook = options.notifyHook;
    if (options?.state) payload.state = options.state;
    if (options?.base64Array?.length) {
      payload.base64Array = options.base64Array.map((img) => this.ensureDataUrl(img));
    }
    const accountFilter = this.buildAccountFilter(options);
    if (accountFilter) payload.accountFilter = accountFilter;

    return payload;
  }

  private async buildBlendPayload(request: ImageBlendRequest): Promise<Record<string, any>> {
    const options = this.extractMidjourneyOptions(request.providerOptions);
    const base64Array = await Promise.all(
      request.sourceImages.map((img) => this.ensureDataUrlAsync(img))
    );
    const payload: Record<string, any> = {
      base64Array,
      dimensions: options?.dimensions ?? this.aspectRatioToDimensions(request.aspectRatio) ?? 'SQUARE',
    };

    if (options?.botType) payload.botType = options.botType;
    if (options?.notifyHook) payload.notifyHook = options.notifyHook;
    if (options?.state) payload.state = options.state;
    const accountFilter = this.buildAccountFilter(options);
    if (accountFilter) payload.accountFilter = accountFilter;

    return payload;
  }

  private async buildEditPayload(request: ImageEditRequest): Promise<Record<string, any>> {
    const options = this.extractMidjourneyOptions(request.providerOptions);
    const sourceImage = request.sourceImage.trim();

    // 如果是 URL，直接嵌入 prompt 中（Midjourney 原生支持）
    const isUrl = sourceImage.startsWith('http://') || sourceImage.startsWith('https://');

    const payload: Record<string, any> = {
      prompt: isUrl ? `${sourceImage} ${request.prompt}` : request.prompt,
      mode: options?.mode ?? this.defaultMode,
    };

    // 如果不是 URL，则使用 base64Array
    if (!isUrl) {
      const imageDataUrl = await this.ensureDataUrlAsync(sourceImage);
      payload.base64Array = [imageDataUrl];
    }

    if (options?.botType) payload.botType = options.botType;
    if (options?.notifyHook) payload.notifyHook = options.notifyHook;
    if (options?.state) payload.state = options.state;
    const accountFilter = this.buildAccountFilter(options);
    if (accountFilter) payload.accountFilter = accountFilter;

    return payload;
  }

  private async buildDescribePayload(request: ImageAnalysisRequest): Promise<Record<string, any>> {
    const options = this.extractMidjourneyOptions(request.providerOptions);
    const payload: Record<string, any> = {
      base64: await this.ensureDataUrlAsync(request.sourceImage),
      dimensions: options?.dimensions ?? 'SQUARE',
    };

    if (options?.botType) payload.botType = options.botType;
    if (options?.notifyHook) payload.notifyHook = options.notifyHook;
    if (options?.state) payload.state = options.state;
    const accountFilter = this.buildAccountFilter(options);
    if (accountFilter) payload.accountFilter = accountFilter;

    return payload;
  }

  private buildSuccessImageResponse(
    task: MidjourneyTaskResponse,
    imageData: string | null,
    extraMetadata: Record<string, any> = {}
  ): AIProviderResponse<ImageResult> {
    const textResponse =
      task.description ||
      task.properties?.finalPrompt ||
      task.promptEn ||
      'Midjourney image generated successfully.';

    const imageUrl = this.extractImageUrl(task);
    const midjourneyMeta = {
      taskId: task.id,
      status: task.status,
      buttons: task.buttons,
      prompt: task.prompt,
      promptEn: task.promptEn,
      description: task.description,
      properties: task.properties,
      imageUrl,
    };

    return {
      success: true,
      data: {
        imageData: imageData ?? undefined,
        textResponse,
        hasImage: Boolean(imageData),
        metadata: {
          provider: 'midjourney',
          imageUrl,
          midjourney: midjourneyMeta,
          ...extraMetadata,
        },
      },
    };
  }

  async generateImage(request: ImageGenerationRequest): Promise<AIProviderResponse<ImageResult>> {
    try {
      const payload = this.buildImaginePayload(request);
      const taskId = await this.submitTask('/mj/submit/imagine', payload, 'generateImage');
      const task = await this.pollTask(taskId, 'generateImage');
      const imageUrl = this.extractImageUrl(task);
      const imageData = await this.downloadImageAsBase64(imageUrl);

      return this.buildSuccessImageResponse(task, imageData);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'MIDJOURNEY_IMAGE_ERROR',
          message,
        },
      };
    }
  }

  async editImage(request: ImageEditRequest): Promise<AIProviderResponse<ImageResult>> {
    try {
      const payload = await this.buildEditPayload(request);
      // 使用 imagine 接口实现图片编辑（通过 base64Array 传入参考图）
      const taskId = await this.submitTask('/mj/submit/imagine', payload, 'editImage');
      const task = await this.pollTask(taskId, 'editImage');
      const imageUrl = this.extractImageUrl(task);
      const imageData = await this.downloadImageAsBase64(imageUrl);

      return this.buildSuccessImageResponse(task, imageData);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'MIDJOURNEY_EDIT_ERROR',
          message,
        },
      };
    }
  }

  async blendImages(request: ImageBlendRequest): Promise<AIProviderResponse<ImageResult>> {
    try {
      if (!Array.isArray(request.sourceImages) || request.sourceImages.length < 2) {
        throw new Error('Midjourney blend requires at least two source images.');
      }

      const payload = await this.buildBlendPayload(request);
      const taskId = await this.submitTask('/mj/submit/blend', payload, 'blendImages');
      const task = await this.pollTask(taskId, 'blendImages');
      const imageUrl = this.extractImageUrl(task);
      const imageData = await this.downloadImageAsBase64(imageUrl);

      return this.buildSuccessImageResponse(task, imageData);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'MIDJOURNEY_BLEND_ERROR',
          message,
        },
      };
    }
  }

  async analyzeImage(request: ImageAnalysisRequest): Promise<AIProviderResponse<AnalysisResult>> {
    try {
      const payload = await this.buildDescribePayload(request);
      const taskId = await this.submitTask('/mj/submit/describe', payload, 'describeImage');
      const task = await this.pollTask(taskId, 'describeImage');

      const describeResult =
        task.properties?.describePrompts ??
        task.properties?.result ??
        task.properties?.finalPrompt ??
        task.description ??
        task.promptEn ??
        'Describe task completed.';

      const text =
        Array.isArray(describeResult) ? describeResult.join('\n') : String(describeResult);

      return {
        success: true,
        data: {
          text,
          tags: task.properties?.tags,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'MIDJOURNEY_DESCRIBE_ERROR',
          message,
        },
      };
    }
  }

  async generateText(_request: TextChatRequest): Promise<AIProviderResponse<TextResult>> {
    return {
      success: false,
      error: {
        code: 'NOT_SUPPORTED',
        message: 'Midjourney provider does not support text chat.',
      },
    };
  }

  async selectTool(
    request: ToolSelectionRequest
  ): Promise<AIProviderResponse<ToolSelectionResult>> {
    const available = request.availableTools ?? [
      'generateImage',
      'editImage',
      'blendImages',
      'analyzeImage',
      'chatResponse',
    ];

    const pick = (tool: string) =>
      available.includes(tool) ? tool : available[0] ?? 'generateImage';

    const imageCount = request.imageCount ?? 0;
    const hasImages = request.hasImages || imageCount > 0 || Boolean(request.hasCachedImage);

    let selectedTool = 'generateImage';
    let reasoning = 'Defaulting to Midjourney imagine.';
    let confidence = 0.55;

    if (hasImages) {
      if (imageCount >= 2) {
        selectedTool = 'blendImages';
        reasoning = 'Multiple images detected, selecting blend mode.';
        confidence = 0.72;
      } else if (request.prompt?.toLowerCase().includes('describe')) {
        selectedTool = 'analyzeImage';
        reasoning = 'Prompt indicates describing an existing image.';
        confidence = 0.68;
      } else {
        selectedTool = 'editImage';
        reasoning = 'Single image detected, switching to edit mode.';
        confidence = 0.65;
      }
    } else if (request.prompt?.toLowerCase().includes('describe')) {
      selectedTool = 'analyzeImage';
      reasoning = 'Prompt explicitly asks for describing an image.';
      confidence = 0.6;
    }

    const finalTool = pick(selectedTool);

    return {
      success: true,
      data: {
        selectedTool: finalTool,
        reasoning,
        confidence,
      },
    };
  }

  async generatePaperJS(
    request: PaperJSGenerateRequest
  ): Promise<AIProviderResponse<PaperJSResult>> {
    this.logger.warn('Paper.js code generation is not supported by Midjourney provider');
    return {
      success: false,
      error: {
        code: 'PAPERJS_NOT_SUPPORTED',
        message: 'Midjourney provider does not support Paper.js code generation',
      },
    };
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  getProviderInfo() {
    return {
      name: 'midjourney',
      version: '1.0.0',
      supportedModels: ['midjourney-fast', 'midjourney-relax'],
    };
  }
  async triggerAction(
    request: MidjourneyActionRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    try {
      const payload = {
        taskId: request.taskId,
        customId: request.customId,
        state: request.state,
        notifyHook: request.notifyHook,
        chooseSameChannel: request.chooseSameChannel,
        accountFilter: request.accountFilter,
      };

      const newTaskId = await this.submitTask('/mj/submit/action', payload, 'action');
      const task = await this.pollTask(newTaskId, 'action');
      const imageUrl = this.extractImageUrl(task);
      const imageData = await this.downloadImageAsBase64(imageUrl);

      return this.buildSuccessImageResponse(task, imageData, {
        parentTaskId: request.taskId,
        actionCustomId: request.customId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'MIDJOURNEY_ACTION_ERROR',
          message,
        },
      };
    }
  }

  async executeModal(
    request: MidjourneyModalRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    try {
      const payload = {
        taskId: request.taskId,
        prompt: request.prompt,
        maskBase64: request.maskBase64,
      };

      const newTaskId = await this.submitTask('/mj/submit/modal', payload, 'modal');
      const task = await this.pollTask(newTaskId, 'modal');
      const imageUrl = this.extractImageUrl(task);
      const imageData = await this.downloadImageAsBase64(imageUrl);

      return this.buildSuccessImageResponse(task, imageData, {
        parentTaskId: request.taskId,
        modalPrompt: request.prompt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'MIDJOURNEY_MODAL_ERROR',
          message,
        },
      };
    }
  }
}
