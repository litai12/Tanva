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
  MidjourneyButtonInfo,
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

// V7/Niji 唯一支持的鉴权模式：悠船(youchuan)。普通 MJ(147 legacy) 已下线。
type MidjourneyAuthMode = 'youchuan';

@Injectable()
export class MidjourneyProvider implements IAIProvider {
  private readonly logger = new Logger(MidjourneyProvider.name);
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private authMode: MidjourneyAuthMode | null = null;
  private youchuanAppId: string | null = null;
  private youchuanSecretKey: string | null = null;
  // 当 MIDJOURNEY_VIA_NEW_API=1 时，youchuan(/v1/tob/*) 上游改走 new-api 网关：
  // base_url 指向 new-api，鉴权用 Bearer NEW_API_KEY，
  // 上游真实密钥(x-youchuan-app+secret)由 new-api 渠道面板持有。
  private viaNewApi = false;
  private newApiBaseUrl = '';
  private newApiKey = '';

  constructor(
    private readonly config: ConfigService,
    private readonly ossService: OssService,
  ) {
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

    this.viaNewApi =
      String(this.config.get<string>('MIDJOURNEY_VIA_NEW_API') ?? '')
        .trim()
        .toLowerCase() === '1';
    this.newApiBaseUrl = (
      this.config.get<string>('NEW_API_BASE_URL') ?? 'http://localhost:4458'
    )
      .trim()
      .replace(/\/$/, '');
    this.newApiKey = (this.config.get<string>('NEW_API_KEY') ?? '').trim();

    if (this.viaNewApi) {
      if (!this.newApiKey) {
        this.logger.warn(
          'MIDJOURNEY_VIA_NEW_API=1 但缺少 NEW_API_KEY，Midjourney 请求无法通过 new-api 网关鉴权。'
        );
      }
      // 经 new-api 时上游真实密钥由网关持有，本地不再强依赖 YOUCHUAN_* 是否配置。
      this.authMode = 'youchuan';
      this.logger.log(
        `Midjourney provider: V7/Niji(youchuan) 经 new-api 网关 ${this.newApiBaseUrl}/youchuan/v1/tob/*。`
      );
      return;
    }

    if (this.youchuanAppId && this.youchuanSecretKey) {
      this.authMode = 'youchuan';
      this.logger.log('Midjourney provider initialised with Youchuan credentials.');
      return;
    }

    this.logger.warn(
      'Midjourney credentials not configured. Set YOUCHUAN_APP_ID/YOUCHUAN_SECRET_KEY.'
    );
  }

  private ensureConfigured(): MidjourneyAuthMode {
    if (this.viaNewApi && this.newApiKey) {
      return 'youchuan';
    }

    if (this.authMode === 'youchuan' && this.youchuanAppId && this.youchuanSecretKey) {
      return this.authMode;
    }

    throw new ServiceUnavailableException(
      'Midjourney credentials not configured on the server.'
    );
  }

  private hasYouchuanCredentials(): boolean {
    return Boolean(this.youchuanAppId && this.youchuanSecretKey);
  }

  // 仅允许 V7/Niji 两个显式模型；其余(缺失/普通 MJ 旧名)一律拒绝。
  private isSupportedModel(model?: string): boolean {
    const normalized = (model ?? '').trim().toLowerCase();
    return normalized === 'midjourney-v7' || normalized === 'midjourney-niji-7';
  }

  private resolveRequestMode(model?: string): MidjourneyAuthMode {
    // 经 new-api 时优创真实密钥由网关持有，本地无需 YOUCHUAN_* 凭据，
    // 但必须有 NEW_API_KEY 才能向网关鉴权——缺失则快速失败，避免发出空 Bearer。
    if (this.viaNewApi) {
      if (!this.newApiKey) {
        throw new ServiceUnavailableException(
          'V7/Niji 7 已切换到 new-api 网关（MIDJOURNEY_VIA_NEW_API=1），但后端缺少 NEW_API_KEY，无法向网关鉴权。'
        );
      }
    } else if (!this.hasYouchuanCredentials()) {
      throw new ServiceUnavailableException(
        'V7/Niji 7 模式需要配置 Youchuan 账号，但后端未配置（YOUCHUAN_APP_ID / YOUCHUAN_SECRET_KEY），请联系管理员配置。'
      );
    }
    return 'youchuan';
  }

  private buildRequestHeaders(_mode: MidjourneyAuthMode): Record<string, string> {
    // 经 new-api 的 youchuan(V7/Niji) 透传：用 Bearer NEW_API_KEY 向网关鉴权；
    // 上游优创密钥(x-youchuan-app/secret)由 new-api 的 /youchuan 渠道注入。
    if (this.viaNewApi) {
      return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${this.newApiKey}`,
      };
    }

    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-youchuan-app': this.youchuanAppId as string,
      'x-youchuan-secret': this.youchuanSecretKey as string,
    };
  }

  private buildUrl(path: string, _requestMode?: MidjourneyAuthMode): string {
    if (path.startsWith('http')) {
      return path;
    }

    // V7/Niji 经 new-api 的 /youchuan 透传(拼出 /youchuan/v1/tob/*)，
    // 否则直连优创 base url。
    const baseUrl = this.viaNewApi
      ? `${this.newApiBaseUrl}/youchuan`
      : this.config.get<string>('YOUCHUAN_API_BASE_URL')?.trim() ?? 'https://ali.youchuan.cn';

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
      // 提取更友好的错误信息（147 AI 返回 {error: {message, type, ...}} 结构）
      const errorDesc =
        data?.description ||
        (typeof data?.error === 'string' ? data.error : data?.error?.message) ||
        data?.message ||
        data?.comment ||
        response.statusText;
      throw new Error(`MJ 图片生成失败：${errorDesc}`);
    }

    return data as T;
  }

  private async submitTask(
    path: string,
    payload: Record<string, any>,
    operation: string,
    requestMode?: MidjourneyAuthMode
  ): Promise<string> {
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.apiRequest<MidjourneySubmitResponse>(
          'POST',
          path,
          payload,
          `${operation} submit`,
          requestMode
        );

        if (response?.code === 21) {
          throw new Error(
            response.description || 'MJ 任务需要补充信息，请尝试调整提示词后重新提交。'
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
          this.logger.error(
            `[Midjourney] ${operation} did not return task id. Response: ${JSON.stringify(response).slice(0, 500)}`
          );
          throw new Error(`MJ 任务提交后未返回任务 ID，请稍后重试。`);
        }

        return String(taskId);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const msg = lastError.message;

        // queue_full_or_no_account：短暂重试
        const isQueueFull =
          msg.includes('queue_full_or_no_account') ||
          msg.includes('upstream_error');
        if (isQueueFull && attempt < maxRetries) {
          const delayMs = (attempt + 1) * 1500;
          this.logger.warn(
            `[Midjourney] ${operation} queue full, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        throw lastError;
      }
    }

    throw lastError!;
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
        const reason = task.failReason || task.description || task.comment || '未知原因';
        throw new Error(`MJ 任务执行失败：${reason}`);
      }
    }

    throw new Error(`MJ 任务超时（等待 ${this.maxPollAttempts} 次后仍未完成），请稍后重试。`);
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
        throw new Error(`图片下载失败：HTTP ${response.status}`);
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        throw new Error(`图片 URL 返回的内容不是图片格式：${contentType}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const base64 = buffer.toString('base64');
      return `data:${contentType};base64,${base64}`;
    }

    const base64 = trimmed.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
    const mimeType = this.inferMimeTypeFromBase64(base64);
    return `data:${mimeType};base64,${base64}`;
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
      throw new Error('图片输入不能为空。');
    }

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }

    const dataUrl = await this.ensureDataUrlAsync(trimmed);
    const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!match) {
      throw new Error('不支持的图片格式，请使用 JPG/PNG/WebP/GIF。');
    }

    const [, contentType, base64] = match;
    const ossUrl = await this.uploadBufferToOSS(
      Buffer.from(base64, 'base64'),
      contentType,
      'uploads/midjourney/input'
    );

    if (!ossUrl) {
      throw new Error('图片上传到 OSS 失败，无法提交到 MJ。');
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

    // youchuan /v1/tob/diffusion 不支持 MJ V7 专属参数，过滤掉
    const unsupportedPatterns = [
      /--cref\s+\S+/gi,
      /--sref\s+\S+/gi,
      /--oref\s+\S+/gi,
      /--iw\s+\S+/gi,
      /--sw\s+\S+/gi,
      /--sv\s+\S+/gi,
      /--ow\s+\S+/gi,
      /--exp\s+\S+/gi,
    ];
    let cleanedPrompt = prompt.trim();
    for (const pattern of unsupportedPatterns) {
      cleanedPrompt = cleanedPrompt.replace(pattern, '');
    }

    // 悠船对极长「说明 + Markdown」整段容易返回 5xx；与前端 MJ V7 清洗对齐，硬上限兜底
    const MAX_YOUCHUAN_TEXT_CHARS = 10000;
    if (cleanedPrompt.length > MAX_YOUCHUAN_TEXT_CHARS) {
      cleanedPrompt = cleanedPrompt.slice(0, MAX_YOUCHUAN_TEXT_CHARS).trim();
    }

    const text = [...promptImageUrls, cleanedPrompt].filter(Boolean).join(' ').trim();
    if (!text) {
      throw new Error('V7/Niji 7 模式需要至少提供提示词或参考图片。');
    }

    return { text };
  }

  private buildSuccessImageResponse(
    task: MidjourneyTaskResponse,
    imageData: string | null,
    ossUrl: string | null,
    extraMetadata: Record<string, any> = {},
    ossImageUrls?: Array<string | null>
  ): AIProviderResponse<ImageResult> {
    const textResponse =
      task.description ||
      task.properties?.finalPrompt ||
      task.promptEn ||
      'Midjourney image generated successfully.';

    const originalImageUrl = this.extractImageUrl(task);
    // 浼樺厛浣跨敤 OSS URL
    const imageUrl = ossUrl || originalImageUrl;

    // 鑾峰彇鎵€鏈夊浘鐗?URLs锛堜紭鍏堣繑鍥炶浆瀛樺悗鐨?OSS URL锛?
    const originalImageUrls = Array.isArray(task.imageUrls)
      ? task.imageUrls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
      : originalImageUrl
      ? [originalImageUrl]
      : [];
    const persistedImageUrls = Array.isArray(ossImageUrls)
      ? ossImageUrls
          .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
          .map((url) => url.trim())
      : [];
    const imageUrls = persistedImageUrls.length > 0
      ? persistedImageUrls
      : imageUrl
      ? [imageUrl]
      : originalImageUrls;

    const midjourneyMeta = {
      taskId: task.id,
      status: task.status,
      /** 閮ㄥ垎 147 閾捐矾鎻愪氦 /mj/submit/action 鏃堕渶瑕佸甫鍥?*/
      state: task.state,
      buttons: task.buttons,
      prompt: task.prompt,
      promptEn: task.promptEn,
      description: task.description,
      properties: task.properties,
      imageUrl,
      imageUrls, // 杩斿洖鎵€鏈夊浘鐗?URL
      originalImageUrl,
      originalImageUrls,
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

  // ===== 经 new-api task API 的受管出图（MIDJOURNEY_VIA_NEW_API=1）=====
  // V7/Niji(type 64 优创适配器) 与 普通 MJ(type 65 mj-proxy 适配器) 统一走
  // new-api 的 task API：POST /v1/video/generations → 轮询 /v1/video/generations/{id}。
  // distributor 按 model 命中 abilities 选渠道，计费走 ModelPrice；上游真实密钥在面板。

  // toNewApiImageUrls：把输入图(http 直接用 / base64 传 OSS)统一成 http URL。
  private async toNewApiImageUrls(imageInputs: string[]): Promise<string[]> {
    const urls: string[] = [];
    for (const img of imageInputs) {
      if (typeof img !== 'string' || !img.trim()) continue;
      urls.push(await this.toPromptImageUrl(img));
    }
    return urls;
  }

  private async submitNewApiTask(
    model: string,
    prompt: string,
    imageUrls: string[]
  ): Promise<string> {
    const url = `${this.newApiBaseUrl}/v1/video/generations`;
    const body: Record<string, any> = {
      model,
      prompt: (prompt ?? '').replace(/\r?\n/g, ' ').trim(),
    };
    if (imageUrls.length > 0) body.images = imageUrls;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${this.newApiKey}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg =
        data?.error?.message || data?.message ||
        (typeof data?.error === 'string' ? data.error : undefined) ||
        text || `HTTP ${res.status}`;
      throw new Error(`MJ 提交失败：${msg}`);
    }
    const taskId =
      data?.task_id || data?.id || data?.data?.task_id || data?.data?.id;
    if (!taskId) {
      throw new Error('new-api 未返回 task_id');
    }
    this.logger.log(`[Midjourney] new-api task submitted: ${taskId} (model=${model})`);
    return String(taskId);
  }

  // 轮询 new-api task；返回合成的 MidjourneyTaskResponse 复用既有 OSS/响应逻辑。
  private async pollNewApiImageTask(taskId: string): Promise<MidjourneyTaskResponse> {
    for (let attempt = 1; attempt <= this.maxPollAttempts; attempt += 1) {
      if (attempt > 1) {
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      }
      const res = await fetch(
        `${this.newApiBaseUrl}/v1/video/generations/${encodeURIComponent(taskId)}`,
        { headers: { Accept: 'application/json', Authorization: `Bearer ${this.newApiKey}` } }
      );
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      if (!res.ok) {
        this.logger.warn(`[Midjourney] new-api task fetch HTTP ${res.status}: ${text?.slice(0, 200)}`);
        continue;
      }
      const task = data?.data ?? data;
      const status = String(task?.status ?? '').toUpperCase();
      const resultUrl = task?.result_url || task?.resultUrl || task?.url;
      if (status === 'SUCCESS' || status === 'SUCCEEDED') {
        if (!resultUrl) continue; // 状态成功但 URL 尚未就绪，继续轮询
        return {
          id: taskId,
          action: 'diffusion',
          status: 'SUCCESS',
          imageUrl: resultUrl,
          imageUrls: [resultUrl],
        };
      }
      if (status === 'FAILURE' || status === 'FAILED') {
        throw new Error(`MJ 任务失败：${task?.fail_reason || task?.failReason || '未知原因'}`);
      }
    }
    throw new Error(`MJ 任务超时（等待 ${this.maxPollAttempts} 次后仍未完成），请稍后重试。`);
  }

  // runManagedImage：generate/edit/blend 经 new-api 受管路径的统一实现。
  private async runManagedImage(
    model: string,
    prompt: string,
    imageInputs: string[]
  ): Promise<AIProviderResponse<ImageResult>> {
    try {
      const images = await this.toNewApiImageUrls(imageInputs);
      const taskId = await this.submitNewApiTask(model, prompt, images);
      const task = await this.pollNewApiImageTask(taskId);

      const imageUrl = this.extractImageUrl(task);
      const allImageUrls =
        Array.isArray(task.imageUrls) && task.imageUrls.length > 0
          ? task.imageUrls
          : imageUrl
          ? [imageUrl]
          : [];
      const ossUrls = await this.uploadImagesToOSS(allImageUrls);
      const ossUrl =
        ossUrls.find((u): u is string => typeof u === 'string' && u.trim().length > 0) || null;
      const imageData = ossUrl ? null : await this.downloadImageAsBase64(imageUrl);

      return this.buildSuccessImageResponse(task, imageData, ossUrl, {}, ossUrls);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: { code: 'MIDJOURNEY_IMAGE_ERROR', message } };
    }
  }

  // 仅允许显式的 V7/Niji 模型；缺失或普通 MJ 旧名返回干净错误响应。
  private rejectUnsupportedModel(model?: string): AIProviderResponse<ImageResult> | null {
    if (this.isSupportedModel(model)) {
      return null;
    }
    return {
      success: false,
      error: {
        code: 'MIDJOURNEY_IMAGE_ERROR',
        message: '普通 Midjourney 已下线，请使用 Midjourney V7 或 Niji 7。',
      },
    };
  }

  async generateImage(request: ImageGenerationRequest): Promise<AIProviderResponse<ImageResult>> {
    const rejected = this.rejectUnsupportedModel(request.model);
    if (rejected) return rejected;
    if (this.viaNewApi) {
      return this.runManagedImage(
        request.model as string,
        request.prompt ?? '',
        Array.isArray(request.imageUrls) ? request.imageUrls : []
      );
    }
    try {
      const requestMode = this.resolveRequestMode(request.model);
      const payload = await this.buildYouchuanDiffusionPayload(
        request.prompt ?? '',
        Array.isArray(request.imageUrls) ? request.imageUrls : []
      );
      const taskId = await this.submitTask(
        '/v1/tob/diffusion',
        payload,
        'generateImage',
        requestMode
      );
      const task = await this.pollTask(taskId, 'generateImage', requestMode);

      // 鑾峰彇鎵€鏈夊浘鐗?URLs锛堝崟鍥惧満鏅叏鍥炶惤鍒?extractImageUrl锛?
      const imageUrl = this.extractImageUrl(task);
      const allImageUrls =
        Array.isArray(task.imageUrls) && task.imageUrls.length > 0
          ? task.imageUrls
          : imageUrl
          ? [imageUrl]
          : [];

      // 涓婁紶鎵€鏈夊浘鐗囧埌 OSS锛堢敤浜?Youchuan 澶氬浘鍦烘櫙锛?
      const ossUrls = await this.uploadImagesToOSS(allImageUrls);
      const ossUrl =
        ossUrls.find((url): url is string => typeof url === 'string' && url.trim().length > 0) || null;

      // 濡傛灉 OSS 涓婁紶澶辫触锛宖allback 鍒?base64
      const imageData = ossUrl ? null : await this.downloadImageAsBase64(imageUrl);

      return this.buildSuccessImageResponse(task, imageData, ossUrl, {}, ossUrls);
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
    const rejected = this.rejectUnsupportedModel(request.model);
    if (rejected) return rejected;
    if (this.viaNewApi) {
      return this.runManagedImage(
        request.model as string,
        request.prompt ?? '',
        request.sourceImage ? [request.sourceImage] : []
      );
    }
    try {
      const requestMode = this.resolveRequestMode(request.model);

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
    const rejected = this.rejectUnsupportedModel(request.model);
    if (rejected) return rejected;
    if (!Array.isArray(request.sourceImages) || request.sourceImages.length < 2) {
      return {
        success: false,
        error: { code: 'MIDJOURNEY_IMAGE_ERROR', message: 'MJ Blend 至少需要两张图片进行融合。' },
      };
    }
    if (this.viaNewApi) {
      return this.runManagedImage(
        request.model as string,
        request.prompt ?? '',
        request.sourceImages
      );
    }
    try {
      const requestMode = this.resolveRequestMode(request.model);

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

  async analyzeImage(_request: ImageAnalysisRequest): Promise<AIProviderResponse<AnalysisResult>> {
    // MJ Describe（图生文）依赖已下线的普通 MJ(/mj/submit/describe) 链路，V7/Niji 不支持。
    return {
      success: false,
      error: {
        code: 'MIDJOURNEY_DESCRIBE_ERROR',
        message: 'MJ Describe（图生文）已下线，请使用 Midjourney V7 或 Niji 7 的生图能力。',
      },
    };
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
      (this.viaNewApi && this.newApiKey) ||
      (this.authMode === 'youchuan' && this.youchuanAppId && this.youchuanSecretKey)
    );
  }

  getProviderInfo() {
    return {
      name: 'midjourney',
      version: '1.0.0',
      supportedModels: ['midjourney-v7', 'midjourney-niji-7'],
    };
  }
}
