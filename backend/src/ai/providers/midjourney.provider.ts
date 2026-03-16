import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OssService } from '../../oss/oss.service';
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
  comment?: string;
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
  jobId?: string;
  comment?: string;
  data?: Record<string, any>;
  properties?: Record<string, any>;
};

type MidjourneyAuthMode = 'legacy' | 'youchuan';

@Injectable()
export class MidjourneyProvider implements IAIProvider {
  private readonly logger = new Logger(MidjourneyProvider.name);
  private readonly apiBaseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly defaultMode: 'FAST' | 'RELAX' = 'FAST';
  private authMode: MidjourneyAuthMode | null = null;
  private apiKey: string | null = null;
  private youchuanAppId: string | null = null;
  private youchuanSecretKey: string | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly ossService: OssService,
  ) {
    const hasYouchuanConfig = Boolean(
      this.config.get<string>('YOUCHUAN_APP_ID') && this.config.get<string>('YOUCHUAN_SECRET_KEY')
    );
    // Legacy 模式优先使用 SORA2_ENDPOINT
    const sora2Endpoint = this.config.get<string>('SORA2_API_ENDPOINT')?.trim() ?? null;
    const midjourneyBaseUrl = this.config.get<string>('MIDJOURNEY_API_BASE_URL')?.trim() ?? null;
    const youchuanBaseUrl = this.config.get<string>('YOUCHUAN_API_BASE_URL')?.trim() ?? null;

    // 优先级: MIDJOURNEY_API_BASE_URL > SORA2_ENDPOINT > YOUCHUAN_API_BASE_URL > 默认
    this.apiBaseUrl = midjourneyBaseUrl ?? sora2Endpoint ?? youchuanBaseUrl ?? (hasYouchuanConfig ? 'https://ali.youchuan.cn' : 'https://api1.147ai.com');
    this.pollIntervalMs = Number(
      this.config.get<number>('MIDJOURNEY_POLL_INTERVAL_MS') ?? 4000
    );
    this.maxPollAttempts = Number(
      this.config.get<number>('MIDJOURNEY_POLL_MAX_ATTEMPTS') ?? 60
    );
  }

  async initialize(): Promise<void> {
    this.youchuanAppId = this.config.get<string>('YOUCHUAN_APP_ID')?.trim() ?? null;
    this.youchuanSecretKey = this.config.get<string>('YOUCHUAN_SECRET_KEY')?.trim() ?? null;
    this.apiKey =
      this.config.get<string>('MIDJOURNEY_API_KEY') ??
      this.config.get<string>('BANANA_API_KEY') ??
      null;

    if (this.apiKey) {
      this.authMode = 'legacy';
      this.logger.log(`Midjourney provider initialised with legacy 147 credentials (endpoint: ${this.apiBaseUrl}).`);
      return;
    }

    if (this.youchuanAppId && this.youchuanSecretKey) {
      this.authMode = 'youchuan';
      this.logger.log('Midjourney provider initialised with Youchuan credentials.');
      return;
    }

    this.logger.warn(
      'Midjourney credentials not configured. Set YOUCHUAN_APP_ID/YOUCHUAN_SECRET_KEY or MIDJOURNEY_API_KEY.'
    );
  }

  private ensureConfigured(): MidjourneyAuthMode {
    if (this.authMode === 'youchuan' && this.youchuanAppId && this.youchuanSecretKey) {
      return this.authMode;
    }

    if (this.authMode === 'legacy' && this.apiKey) {
      return this.authMode;
    }

    throw new ServiceUnavailableException(
      'Midjourney credentials not configured on the server.'
    );
  }

  private isYouchuanMode(): boolean {
    return this.ensureConfigured() === 'youchuan';
  }

  private hasYouchuanCredentials(): boolean {
    return Boolean(this.youchuanAppId && this.youchuanSecretKey);
  }

  private shouldUseYouchuanModel(model?: string): boolean {
    const normalized = (model ?? '').trim().toLowerCase();
    // mj_imagine 等老模型名称走 legacy (147 API)
    if (normalized === 'mj_imagine' || normalized.startsWith('mj_')) {
      return false;
    }
    return (
      normalized === 'midjourney-v7' ||
      normalized === 'midjourney-niji-7' ||
      normalized === 'niji-7'
    );
  }

  private resolveRequestMode(model?: string): MidjourneyAuthMode {
    if (this.shouldUseYouchuanModel(model)) {
      if (!this.hasYouchuanCredentials()) {
        throw new ServiceUnavailableException(
          'Youchuan credentials not configured on the server for Midjourney V7 / Niji 7.'
        );
      }
      return 'youchuan';
    }

    if (this.apiKey) {
      return 'legacy';
    }

    return this.ensureConfigured();
  }

  private buildRequestHeaders(mode: MidjourneyAuthMode): Record<string, string> {
    if (mode === 'youchuan') {
      return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-youchuan-app': this.youchuanAppId as string,
        'x-youchuan-secret': this.youchuanSecretKey as string,
      };
    }

    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: this.apiKey as string,
    };
  }

  private buildUrl(path: string, requestMode?: MidjourneyAuthMode): string {
    if (path.startsWith('http')) {
      return path;
    }

    // 根据 requestMode 使用不同的 base URL
    const baseUrl = requestMode === 'youchuan'
      ? (this.config.get<string>('YOUCHUAN_API_BASE_URL')?.trim() ?? 'https://ali.youchuan.cn')
      : this.apiBaseUrl;

    return `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  private async apiRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    payload?: Record<string, any>,
    operation: string = 'Midjourney request',
    requestMode?: MidjourneyAuthMode
  ): Promise<T> {
    const mode = requestMode ?? this.ensureConfigured();
    const url = this.buildUrl(path, mode);

    // 打印完整的请求 URL
    this.logger.log(`[Midjourney] ${mode} API request: ${method} ${url}`);

    // 只在 POST 请求时打印简洁日志
    if (method === 'POST' && payload) {
      const logPayload: Record<string, any> = {
        ...payload,
        base64Array: payload.base64Array ? `[${payload.base64Array.length}张图片]` : undefined,
      };
      // 只在 prompt 存在时添加
      if (payload.prompt !== undefined) {
        logPayload.prompt = payload.prompt.slice(0, 50) + (payload.prompt.length > 50 ? '...' : '');
      }
      if (payload.text !== undefined) {
        logPayload.text = payload.text.slice(0, 50) + (payload.text.length > 50 ? '...' : '');
      }
      this.logger.log(
        `[Midjourney] API(${mode}): ${method} ${path}, model: ${payload.mode || 'FAST'}, payload: ${JSON.stringify(logPayload)}`
      );
    }

    const response = await fetch(url, {
      method,
      headers: this.buildRequestHeaders(mode),
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
      const errorDesc =
        data?.description || data?.message || data?.comment || data?.error || response.statusText;
      throw new Error(`Midjourney ${operation} failed: ${errorDesc}`);
    }

    // 检查 API 返回的业务错误码
    if (mode === 'legacy' && data?.code && data.code !== 1 && data.code !== 22) {
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
    operation: string,
    requestMode?: MidjourneyAuthMode
  ): Promise<string> {
    const response = await this.apiRequest<MidjourneySubmitResponse>(
      'POST',
      path,
      payload,
      `${operation} submit`,
      requestMode
    );

    if (response?.code === 21) {
      throw new Error(
        response.description || 'Midjourney API requires modal input for this action.'
      );
    }

    const taskId =
      (response as any)?.id ??
      (response as any)?.jobId ??
      (response as any)?.data?.jobId ??
      (response as any)?.cost?.jobId ??
      (typeof (response as any)?.result === 'object' ? ((response as any).result as any)?.jobId : undefined) ??
      (response as any)?.result ??
      (response as any)?.properties?.taskId;
    if (!taskId) {
      // 打印完整响应以便调试
      this.logger.error(
        `[Midjourney] ${operation} did not return task id. Response: ${JSON.stringify(response).slice(0, 500)}`
      );
      throw new Error(`[Midjourney] ${operation} did not return task id.`);
    }

    return String(taskId);
  }

  private async pollTask(
    taskId: string,
    operation: string,
    requestMode?: MidjourneyAuthMode
  ): Promise<MidjourneyTaskResponse> {
    const mode = requestMode ?? this.ensureConfigured();
    for (let attempt = 1; attempt <= this.maxPollAttempts; attempt += 1) {
      if (attempt > 1) {
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      }

      const taskResponse = await this.apiRequest<any>(
        'GET',
        mode === 'youchuan'
          ? `/v1/tob/job/${encodeURIComponent(taskId)}`
          : `/mj/task/${taskId}/fetch`,
        undefined,
        `${operation} poll`,
        mode
      );
      const task = mode === 'youchuan'
        ? this.normalizeYouchuanTaskResponse(taskResponse, taskId)
        : (taskResponse as MidjourneyTaskResponse);

      // 添加轮询日志
      if (mode === 'youchuan') {
        this.logger.log(
          `[Midjourney] Youchuan poll attempt ${attempt}: status=${task.status}, progress=${task.progress}, images=${task.imageUrls?.length}`
        );
      }

      const status = this.normalizeTaskStatus(task);

      // Youchuan 特殊处理：即使状态是成功，也要确保有图片 URL
      const hasImageUrl = task.imageUrls && task.imageUrls.length > 0;

      if (status === 'SUCCESS' || status === 'FINISHED' || status === 'COMPLETED') {
        // Youchuan 模式下，状态成功但没有图片时继续轮询
        if (mode === 'youchuan' && !hasImageUrl && attempt < this.maxPollAttempts) {
          this.logger.log(`[Midjourney] Youchuan status=成功 but no image yet, continuing to poll...`);
          continue;
        }
        return task;
      }

      if (status === 'FAILURE' || status === 'FAILED' || status === 'CANCEL') {
        const reason = task.failReason || task.description || task.comment || 'Unknown reason';
        throw new Error(`Midjourney task ${taskId} failed: ${reason}`);
      }
    }

    throw new Error(`Midjourney task ${taskId} timed out after ${this.maxPollAttempts} attempts`);
  }

  private normalizeTaskStatus(task: MidjourneyTaskResponse): string {
    const raw = String(task.status || task.comment || '').trim();
    const upper = raw.toUpperCase();

    // Youchuan 中文状态支持
    if (raw === '成功' || raw === 'SUCCESS' || upper.includes('JOBSTATUSSUCCESS')) return 'SUCCESS';
    if (raw === '失败' || raw === 'FAILED' || raw === 'FAILURE') return 'FAILURE';
    if (
      upper.includes('JOBSTATUSFAIL') ||
      upper.includes('JOBSTATUSERROR') ||
      upper.includes('JOBSTATUSREJECT') ||
      upper.includes('JOBSTATUSTEXTREJECT') ||
      upper.includes('JOBSTATUSBADPROMPT') ||
      upper.includes('JOBSTATUSINVALIDPARAMETER') ||
      upper.includes('JOBSTATUSTIMEOUT') ||
      upper.includes('JOBSTATUSREQUESTTIMEOUT') ||
      upper.includes('JOBSTATUSINVALIDIMAGEPROMPTLINK') ||
      upper.includes('JOBSTATUSCREDITNOTENOUGH') ||
      upper.includes('JOBSTATUSIMAGEPROMPTDENIED') ||
      upper.includes('JOBSTATUSDUPLICATEIMAGE')
    ) {
      return 'FAILURE';
    }
    if (upper.includes('JOBSTATUSCANCELED')) return 'CANCEL';
    if (
      upper.includes('JOBSTATUSCREATED') ||
      upper.includes('JOBSTATUSRUNNING') ||
      upper.includes('JOBSTATUSQUEUED')
    ) {
      return 'IN_PROGRESS';
    }

    return upper;
  }

  private normalizeYouchuanTaskResponse(raw: any, fallbackTaskId: string): MidjourneyTaskResponse {
    // 打印完整的原始响应以便调试
    this.logger.log(`[Midjourney] Youchuan raw response: ${JSON.stringify(raw).slice(0, 1000)}`);

    const imageUrls = this.extractYouchuanImageUrls(raw);
    const comment =
      this.pickString(raw?.comment, raw?.data?.comment, raw?.result?.comment) ?? undefined;
    const prompt =
      this.pickString(raw?.prompt, raw?.text, raw?.data?.prompt, raw?.data?.text) ?? undefined;
    const description =
      this.pickString(raw?.description, raw?.message, raw?.data?.message, comment) ?? undefined;
    const taskId =
      this.pickString(raw?.jobId, raw?.id, raw?.data?.jobId, raw?.result?.jobId) ?? fallbackTaskId;

    return {
      id: taskId,
      action: 'diffusion',
      prompt,
      description,
      comment,
      imageUrl: imageUrls[0],
      imageUrls,
      progress: this.pickString(raw?.progress, raw?.data?.progress) ?? undefined,
      status: comment || this.pickString(raw?.status, raw?.data?.status) || 'IN_PROGRESS',
      properties: {
        raw,
      },
    };
  }

  private extractYouchuanImageUrls(raw: any): string[] {
    // Youchuan API 可能返回的字段: imageUrl, images, output, imgUrl, url, result_url, urls, data.images, result.images 等
    const candidates = [
      raw?.urls,
      raw?.imageUrl,
      raw?.imgUrl,
      raw?.url,
      raw?.resultUrl,
      raw?.imageUrls,
      raw?.images,
      raw?.output,
      raw?.data?.imageUrl,
      raw?.data?.imgUrl,
      raw?.data?.url,
      raw?.data?.resultUrl,
      raw?.data?.urls,
      raw?.data?.imageUrls,
      raw?.data?.images,
      raw?.data?.output,
      raw?.result?.imageUrl,
      raw?.result?.imgUrl,
      raw?.result?.url,
      raw?.result?.resultUrl,
      raw?.result?.urls,
      raw?.result?.imageUrls,
      raw?.result?.images,
      raw?.result?.output,
    ];
    const urls = new Set<string>();
    for (const candidate of candidates) {
      for (const url of this.flattenUrlCandidate(candidate)) {
        urls.add(url);
      }
    }
    return Array.from(urls);
  }

  private flattenUrlCandidate(candidate: any): string[] {
    if (!candidate) return [];
    if (typeof candidate === 'string') {
      return /^https?:\/\//i.test(candidate.trim()) ? [candidate.trim()] : [];
    }
    if (Array.isArray(candidate)) {
      return candidate.flatMap((item) => this.flattenUrlCandidate(item));
    }
    if (typeof candidate === 'object') {
      return [
        ...this.flattenUrlCandidate(candidate.url),
        ...this.flattenUrlCandidate(candidate.imageUrl),
        ...this.flattenUrlCandidate(candidate.imageUrls),
        ...this.flattenUrlCandidate(candidate.images),
      ];
    }
    return [];
  }

  private pickString(...values: any[]): string | null {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
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

    const rawImageUrls = this.extractYouchuanImageUrls(task.properties?.raw);
    if (rawImageUrls.length > 0) {
      return rawImageUrls[0];
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

  private async uploadBufferToOSS(
    buffer: Buffer,
    contentType: string,
    folder: string
  ): Promise<string | null> {
    try {
      const ext = contentType.includes('webp')
        ? 'webp'
        : contentType.includes('jpeg')
          ? 'jpg'
          : contentType.includes('gif')
            ? 'gif'
            : 'png';
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const key = `${folder}/${timestamp}_${randomId}.${ext}`;

      const result = await this.ossService.putBuffer(key, buffer, contentType);
      if (result.url) {
        this.logger.log(`[Midjourney] Image uploaded to OSS: ${result.url}`);
        return result.url;
      }
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[Midjourney] Error uploading to OSS: ${message}`);
      return null;
    }
  }

  private async uploadImageToOSS(imageUrl: string | null): Promise<string | null> {
    if (!imageUrl) return null;

    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        this.logger.warn(`[Midjourney] Failed to download image for OSS: ${response.status}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = response.headers.get('content-type') || 'image/png';
      return this.uploadBufferToOSS(buffer, contentType, 'uploads/midjourney');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[Midjourney] Error uploading to OSS: ${message}`);
      return null;
    }
  }

  // 上传多张图片到 OSS
  private async uploadImagesToOSS(imageUrls: string[]): Promise<(string | null)[]> {
    if (!imageUrls || imageUrls.length === 0) return [];
    
    try {
      const results = await Promise.all(
        imageUrls.map(url => this.uploadImageToOSS(url))
      );
      return results;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[Midjourney] Error uploading multiple images to OSS: ${message}`);
      return imageUrls.map(() => null);
    }
  }

  private async toPromptImageUrl(image: string): Promise<string> {
    const trimmed = image.trim();
    if (!trimmed) {
      throw new Error('Empty image input is not allowed.');
    }

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }

    const dataUrl = await this.ensureDataUrlAsync(trimmed);
    const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!match) {
      throw new Error('Unsupported image input format for Youchuan image reference.');
    }

    const [, contentType, base64] = match;
    const ossUrl = await this.uploadBufferToOSS(
      Buffer.from(base64, 'base64'),
      contentType,
      'uploads/midjourney/input'
    );

    if (!ossUrl) {
      throw new Error('Failed to upload image reference to OSS.');
    }

    return ossUrl;
  }

  private async buildYouchuanDiffusionPayload(
    prompt: string,
    imageInputs: string[] = []
  ): Promise<Record<string, any>> {
    const promptImageUrls = (
      await Promise.all(
        imageInputs
          .filter((input): input is string => typeof input === 'string' && input.trim().length > 0)
          .map((input) => this.toPromptImageUrl(input))
      )
    ).filter(Boolean);

    const text = [...promptImageUrls, prompt.trim()].filter(Boolean).join(' ').trim();
    if (!text) {
      throw new Error('Midjourney V7/Niji 7 requires at least a prompt or image reference.');
    }

    return { text };
  }

  private async buildImaginePayload(
    request: ImageGenerationRequest,
    requestMode: MidjourneyAuthMode
  ): Promise<Record<string, any>> {
    if (requestMode === 'youchuan') {
      return this.buildYouchuanDiffusionPayload(
        request.prompt ?? '',
        Array.isArray(request.imageUrls) ? request.imageUrls : []
      );
    }

    const options = this.extractMidjourneyOptions(request.providerOptions);
    // Midjourney 只支持纯文生图，不支持图片输入
    const promptParts: string[] = [];
    const base64Array: string[] = [];
    const imageInputs = Array.isArray(request.imageUrls) ? request.imageUrls : [];

    for (const input of imageInputs) {
      if (typeof input !== 'string') continue;
      const trimmed = input.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        promptParts.push(trimmed);
        continue;
      }
      base64Array.push(trimmed);
    }

    promptParts.push(request.prompt);

    const payload: Record<string, any> = {
      prompt: promptParts.filter(Boolean).join(' ').trim(),
      mode: options?.mode ?? this.defaultMode,
      // 147 API 需要指定模型名称
      model: request.model ?? 'mj_imagine',
    };

    if (base64Array.length > 0) {
      payload.base64Array = base64Array;
    }

    if (options?.botType) payload.botType = options.botType;
    if (options?.notifyHook) payload.notifyHook = options.notifyHook;
    if (options?.state) payload.state = options.state;
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

    // 将图片转换为 data URL 格式
    const imageDataUrl = await this.ensureDataUrlAsync(sourceImage);

    const payload: Record<string, any> = {
      action: 'EDITS',
      prompt: request.prompt,
      base64Array: [imageDataUrl],
    };

    if (options?.botType) payload.botType = options.botType;
    if (options?.notifyHook) payload.notifyHook = options.notifyHook;
    if (options?.state) payload.state = options.state;
    if (options?.remix !== undefined) payload.remix = options.remix;
    const accountFilter = this.buildAccountFilter(options);
    if (accountFilter) payload.accountFilter = accountFilter;

    return payload;
  }

  /**
   * 构建用于 /mj/submit/imagine 接口的图生图请求
   * 如果是 URL，直接在 prompt 中引用；如果是 base64，使用 base64Array
   */
  private async buildEditPayloadForImagine(request: ImageEditRequest): Promise<Record<string, any>> {
    const options = this.extractMidjourneyOptions(request.providerOptions);
    const sourceImage = request.sourceImage.trim();
    const isUrl = sourceImage.startsWith('http://') || sourceImage.startsWith('https://');

    const payload: Record<string, any> = {
      mode: options?.mode ?? this.defaultMode,
    };

    if (isUrl) {
      // URL 格式：在 prompt 前添加图片 URL
      payload.prompt = `${sourceImage} ${request.prompt}`;
    } else {
      // base64 格式：使用 base64Array
      const imageDataUrl = await this.ensureDataUrlAsync(sourceImage);
      payload.prompt = request.prompt;
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
    ossUrl: string | null,
    extraMetadata: Record<string, any> = {}
  ): AIProviderResponse<ImageResult> {
    const textResponse =
      task.description ||
      task.properties?.finalPrompt ||
      task.promptEn ||
      'Midjourney image generated successfully.';

    const originalImageUrl = this.extractImageUrl(task);
    // 优先使用 OSS URL
    const imageUrl = ossUrl || originalImageUrl;
    
    // 获取所有图片 URLs（用于 Youchuan 多图场景）
    const imageUrls = task.imageUrls || (imageUrl ? [imageUrl] : []);
    
    const midjourneyMeta = {
      taskId: task.id,
      status: task.status,
      buttons: task.buttons,
      prompt: task.prompt,
      promptEn: task.promptEn,
      description: task.description,
      properties: task.properties,
      imageUrl,
      imageUrls, // 返回所有图片 URL
      originalImageUrl,
    };

    return {
      success: true,
      data: {
        imageData: imageData ?? undefined,
        textResponse,
        hasImage: Boolean(imageData) || Boolean(ossUrl),
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
      const requestMode = this.resolveRequestMode(request.model);
      const payload = await this.buildImaginePayload(request, requestMode);
      const taskId = await this.submitTask(
        requestMode === 'youchuan' ? '/v1/tob/diffusion' : '/mj/submit/imagine',
        payload,
        'generateImage',
        requestMode
      );
      const task = await this.pollTask(taskId, 'generateImage', requestMode);
      
      // 获取所有图片 URLs
      const allImageUrls = task.imageUrls || [];
      const imageUrl = this.extractImageUrl(task);
      
      // 上传所有图片到 OSS（用于 Youchuan 多图场景）
      const ossUrls = await this.uploadImagesToOSS(allImageUrls);
      const ossUrl = ossUrls.length > 0 ? ossUrls[0] : null;
      
      // 如果 OSS 上传失败，fallback 到 base64
      const imageData = ossUrl ? null : await this.downloadImageAsBase64(imageUrl);

      return this.buildSuccessImageResponse(task, imageData, ossUrl);
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
      const requestMode = this.resolveRequestMode(request.model);

      if (requestMode === 'youchuan') {
        const payload = await this.buildYouchuanDiffusionPayload(request.prompt ?? '', [
          request.sourceImage,
        ]);
        const taskId = await this.submitTask(
          '/v1/tob/diffusion',
          payload,
          'editImage',
          requestMode
        );
        const task = await this.pollTask(taskId, 'editImage', requestMode);
        const imageUrl = this.extractImageUrl(task);
        const ossUrl = await this.uploadImageToOSS(imageUrl);
        const imageData = ossUrl ? null : await this.downloadImageAsBase64(imageUrl);

        return this.buildSuccessImageResponse(task, imageData, ossUrl);
      }

      // 使用 /mj/submit/imagine 接口 + base64Array 实现图生图
      const options = this.extractMidjourneyOptions(request.providerOptions);
      const imageDataUrl = await this.ensureDataUrlAsync(request.sourceImage.trim());

      const payload: Record<string, any> = {
        prompt: request.prompt,
        mode: options?.mode ?? this.defaultMode,
        base64Array: [imageDataUrl],
      };

      if (options?.botType) payload.botType = options.botType;
      if (options?.notifyHook) payload.notifyHook = options.notifyHook;
      if (options?.state) payload.state = options.state;
      const accountFilter = this.buildAccountFilter(options);
      if (accountFilter) payload.accountFilter = accountFilter;

      const taskId = await this.submitTask('/mj/submit/imagine', payload, 'editImage', requestMode);
      const task = await this.pollTask(taskId, 'editImage', requestMode);
      const imageUrl = this.extractImageUrl(task);
      const ossUrl = await this.uploadImageToOSS(imageUrl);
      const imageData = ossUrl ? null : await this.downloadImageAsBase64(imageUrl);

      return this.buildSuccessImageResponse(task, imageData, ossUrl);
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
      const requestMode = this.resolveRequestMode(request.model);
      if (!Array.isArray(request.sourceImages) || request.sourceImages.length < 2) {
        throw new Error('Midjourney blend requires at least two source images.');
      }

      if (requestMode === 'youchuan') {
        const payload = await this.buildYouchuanDiffusionPayload(
          request.prompt ?? '',
          request.sourceImages
        );
        const taskId = await this.submitTask(
          '/v1/tob/diffusion',
          payload,
          'blendImages',
          requestMode
        );
        const task = await this.pollTask(taskId, 'blendImages', requestMode);
        const imageUrl = this.extractImageUrl(task);
        const ossUrl = await this.uploadImageToOSS(imageUrl);
        const imageData = ossUrl ? null : await this.downloadImageAsBase64(imageUrl);

        return this.buildSuccessImageResponse(task, imageData, ossUrl);
      }

      const payload = await this.buildBlendPayload(request);
      const taskId = await this.submitTask('/mj/submit/blend', payload, 'blendImages', requestMode);
      const task = await this.pollTask(taskId, 'blendImages', requestMode);
      const imageUrl = this.extractImageUrl(task);
      const ossUrl = await this.uploadImageToOSS(imageUrl);
      const imageData = ossUrl ? null : await this.downloadImageAsBase64(imageUrl);

      return this.buildSuccessImageResponse(task, imageData, ossUrl);
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
      const requestMode = this.resolveRequestMode(request.model);
      if (requestMode === 'youchuan') {
        throw new Error('Youchuan Midjourney provider does not expose describe-image API yet.');
      }

      const payload = await this.buildDescribePayload(request);
      const taskId = await this.submitTask(
        '/mj/submit/describe',
        payload,
        'describeImage',
        requestMode
      );
      const task = await this.pollTask(taskId, 'describeImage', requestMode);

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
    return Boolean(
      (this.authMode === 'youchuan' && this.youchuanAppId && this.youchuanSecretKey) ||
      (this.authMode === 'legacy' && this.apiKey)
    );
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
      if (this.isYouchuanMode()) {
        throw new Error('Youchuan Midjourney provider does not support legacy action buttons.');
      }

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
      const ossUrl = await this.uploadImageToOSS(imageUrl);
      const imageData = ossUrl ? null : await this.downloadImageAsBase64(imageUrl);

      return this.buildSuccessImageResponse(task, imageData, ossUrl, {
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
      if (this.isYouchuanMode()) {
        throw new Error('Youchuan Midjourney provider does not support legacy modal actions.');
      }

      const payload = {
        taskId: request.taskId,
        prompt: request.prompt,
        maskBase64: request.maskBase64,
      };

      const newTaskId = await this.submitTask('/mj/submit/modal', payload, 'modal');
      const task = await this.pollTask(newTaskId, 'modal');
      const imageUrl = this.extractImageUrl(task);
      const ossUrl = await this.uploadImageToOSS(imageUrl);
      const imageData = ossUrl ? null : await this.downloadImageAsBase64(imageUrl);

      return this.buildSuccessImageResponse(task, imageData, ossUrl, {
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
