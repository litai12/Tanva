import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

type VideoQuality = 'hd' | 'sd';

const SORA2_VIDEO_MODELS: Record<VideoQuality, string> = {
  hd: process.env.SORA2_HD_MODEL || 'sora-2-pro-reverse',
  sd: process.env.SORA2_SD_MODEL || 'sora-2-reverse',
};

const SORA2_FAILED_STATUSES = ['failed', 'error', 'blocked', 'terminated'];
const SORA2_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.webm', '.mkv'];
const SORA2_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const SORA2_ASYNC_HOST_HINTS = ['asyncdata.', 'asyncndata.'];
const SORA2_MAX_FOLLOW_DEPTH = 2;
const SORA2_FETCH_TIMEOUT_MS = 60000;
const SORA2_MAX_RETRY = 3;
const SORA2_RETRY_BASE_DELAY_MS = 1200;
const SORA2_POLL_INTERVAL_MS = 5000;
const SORA2_POLL_MAX_ATTEMPTS = 120;
const SORA2_POLL_STATUSES = ['queued', 'processing', 'downloading', 'pending'];

interface Sora2ResolvedMedia {
  videoUrl?: string;
  thumbnailUrl?: string;
  referencedUrls: string[];
  taskInfo?: Record<string, any> | null;
  taskId?: string;
  status?: string;
  errorMessage?: string;
}

interface GenerateVideoOptions {
  prompt: string;
  referenceImageUrls?: string[];
  quality?: VideoQuality;
}

export interface Sora2VideoResult {
  videoUrl: string;
  content: string;
  thumbnailUrl?: string;
  referencedUrls: string[];
  status?: string;
  taskId?: string;
  taskInfo?: Record<string, any> | null;
}

@Injectable()
export class Sora2VideoService {
  private readonly logger = new Logger(Sora2VideoService.name);
  private readonly apiBase = process.env.SORA2_API_ENDPOINT || 'https://api1.147ai.com';
  private readonly apiKey = process.env.SORA2_API_KEY;

  async generateVideo(options: GenerateVideoOptions): Promise<Sora2VideoResult> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('Sora2 API Key 未配置');
    }

    const quality: VideoQuality = options.quality === 'sd' ? 'sd' : 'hd';
    const model = this.getModelForQuality(quality);

    let attempt = 0;
    let lastError: unknown = null;
    const startedAt = Date.now();

    while (attempt < SORA2_MAX_RETRY) {
      attempt += 1;
      try {
        this.logger.log(
          `Sora2 video generation attempt ${attempt}/${SORA2_MAX_RETRY} (quality=${quality}, model=${model})`,
        );

        const requestPayload = {
          model,
          stream: true,
          messages: this.buildMessages(options.prompt, options.referenceImageUrls),
        };

        const response = await fetch(`${this.apiBase}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(requestPayload),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const message = errorData?.message || `HTTP ${response.status}`;
          throw new ServiceUnavailableException(`Sora2 请求失败: ${message}`);
        }

        const fullContent = await this.processStream(response);
        let resolved = await this.resolveSora2Response(fullContent);

        if (resolved.status && SORA2_FAILED_STATUSES.includes(resolved.status)) {
          const errorType = resolved.taskInfo?.error?.type || resolved.status;
          const message =
            resolved.taskInfo?.error?.message || resolved.errorMessage || 'Sora2 返回失败状态';
          throw new BadRequestException(`Sora2 生成失败 [${errorType}]: ${message}`);
        }

        const needsPoll =
          (resolved.status && SORA2_POLL_STATUSES.includes(resolved.status)) ||
          (!resolved.videoUrl && (resolved.taskId || resolved.taskInfo));

        if (needsPoll) {
          this.logger.log(
            `Sora2 task ${resolved.taskId ?? 'unknown'} is still processing, start polling`,
          );
          const taskUrls = resolved.referencedUrls.filter((url) => this.isAsyncTaskUrl(url));
          if (taskUrls.length === 0) {
            throw new ServiceUnavailableException('Sora2 返回处理中状态，但没有可用的任务跟踪链接');
          }

          const pollResult = await this.pollTaskUntilComplete(taskUrls);
          if (!pollResult) {
            throw new ServiceUnavailableException('视频生成超时，请稍后刷新重试');
          }

          if (pollResult.status && SORA2_FAILED_STATUSES.includes(pollResult.status)) {
            const errorType = pollResult.taskInfo?.error?.type || pollResult.status;
            const message =
              pollResult.taskInfo?.error?.message ||
              pollResult.errorMessage ||
              'Sora2 生成失败';
            throw new BadRequestException(`Sora2 生成失败 [${errorType}]: ${message}`);
          }

          resolved = pollResult;
        }

        if (!resolved.videoUrl) {
          const preview = resolved.referencedUrls.slice(0, 5).join('\n');
          this.logger.error(
            `Sora2 未返回视频 URL，参考链接: ${preview || '无'}, 内容片段: ${fullContent.slice(0, 200)}`,
          );
          throw new ServiceUnavailableException('Sora2 未返回有效的视频 URL');
        }

        const duration = ((Date.now() - startedAt) / 1000).toFixed(2);
        this.logger.log(`Sora2 视频生成成功，耗时 ${duration}s`);

        return {
          videoUrl: resolved.videoUrl,
          content: resolved.taskInfo
            ? `视频已生成（任务 ID: ${resolved.taskId || resolved.taskInfo?.id || 'unknown'}）`
            : '视频已生成，可在下方预览。',
          thumbnailUrl: resolved.thumbnailUrl,
          referencedUrls: resolved.referencedUrls,
          status: resolved.status,
          taskId: resolved.taskId,
          taskInfo: resolved.taskInfo,
        };
      } catch (error) {
        lastError = error;
        if (error instanceof BadRequestException) {
          throw error;
        }

        const retryable = this.isRetryableVideoError(error);
        this.logger.warn(
          `Sora2 attempt ${attempt} failed${retryable ? ', will retry' : ''}: ${
            error instanceof Error ? error.message : error
          }`,
        );

        if (retryable && attempt < SORA2_MAX_RETRY) {
          const wait = SORA2_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          await this.delay(wait);
          continue;
        }

        if (error instanceof ServiceUnavailableException) {
          throw error;
        }

        throw new ServiceUnavailableException(
          error instanceof Error ? error.message : 'Sora2 调用失败',
        );
      }
    }

    const message =
      lastError instanceof Error ? lastError.message : 'Sora2 视频生成重试仍失败，请稍后再试';
    throw new ServiceUnavailableException(message);
  }

  getModelForQuality(quality: VideoQuality): string {
    return SORA2_VIDEO_MODELS[quality] || SORA2_VIDEO_MODELS.hd;
  }

  private buildMessages(prompt: string, imageUrls?: string[]) {
    const content: Array<
      | { type: 'text'; text: string }
      | {
          type: 'image_url';
          image_url: { url: string };
        }
    > = [
      {
        type: 'text',
        text: prompt,
      },
    ];

    const normalizedImages = (imageUrls || [])
      .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
      .map((url) => url.trim());

    normalizedImages.forEach((url) => {
      content.push({
        type: 'image_url',
        image_url: { url },
      });
    });

    return [
      {
        role: 'user',
        content,
      },
    ];
  }

  private async processStream(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new ServiceUnavailableException('Sora2 响应不可读取');
    }

    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') continue;

          try {
            const parsed = JSON.parse(payload);
            const chunk = parsed?.choices?.[0]?.delta?.content;
            if (chunk) {
              fullContent += chunk;
            }
          } catch {
            this.logger.debug(`无法解析 Sora2 流式片段: ${payload}`);
          }
        }
      }

      if (buffer.startsWith('data: ')) {
        const payload = buffer.slice(6);
        if (payload !== '[DONE]') {
          try {
            const parsed = JSON.parse(payload);
            const chunk = parsed?.choices?.[0]?.delta?.content;
            if (chunk) {
              fullContent += chunk;
            }
          } catch {
            this.logger.debug(`无法解析最终流式片段: ${payload}`);
          }
        }
      }

      return fullContent.trim();
    } finally {
      reader.releaseLock();
    }
  }

  private async resolveSora2Response(rawContent: string): Promise<Sora2ResolvedMedia> {
    const referencedUrls = new Set<string>();
    const visitedTaskUrls = new Set<string>();
    let videoUrl: string | undefined;
    let thumbnailUrl: string | undefined;
    let taskInfo: Record<string, any> | null = null;
    let status: string | undefined;
    let taskId: string | undefined;
    let errorMessage: string | undefined;

    type QueueEntry = { type: 'text' | 'url'; payload: string; depth: number };
    const queue: QueueEntry[] = [{ type: 'text', payload: rawContent, depth: 0 }];

    while (queue.length) {
      const current = queue.shift()!;
      if (current.depth > SORA2_MAX_FOLLOW_DEPTH) {
        continue;
      }

      if (current.type === 'url') {
        if (visitedTaskUrls.has(current.payload)) continue;
        visitedTaskUrls.add(current.payload);
        const payload = await this.safeFetchTextWithTimeout(current.payload);
        if (payload) {
          queue.push({ type: 'text', payload, depth: current.depth + 1 });
        }
        continue;
      }

      const parsed = this.tryParseJson(current.payload);
      if (parsed) {
        taskInfo = { ...(taskInfo || {}), ...parsed };
        if (!status && typeof parsed.status === 'string') {
          status = parsed.status;
        }
        if (!taskId && typeof parsed.id === 'string') {
          taskId = parsed.id;
        }
        if (!errorMessage) {
          errorMessage =
            typeof parsed.error?.message === 'string'
              ? parsed.error.message
              : typeof parsed.message === 'string'
              ? parsed.message
              : undefined;
        }
        this.collectUrlsFromObject(parsed, referencedUrls);
      } else {
        this.extractUrlsFromText(current.payload).forEach((url) => referencedUrls.add(url));
      }

      if (!videoUrl) {
        videoUrl = this.pickFirstMatchingUrl(referencedUrls, (url) =>
          this.isLikelyVideoUrl(url),
        );
      }
      if (!thumbnailUrl) {
        thumbnailUrl = this.pickFirstMatchingUrl(referencedUrls, (url) =>
          this.isLikelyImageUrl(url),
        );
      }

      if (!videoUrl) {
        const taskCandidates = Array.from(referencedUrls).filter(
          (url) => this.isAsyncTaskUrl(url) && !visitedTaskUrls.has(url),
        );
        taskCandidates.slice(0, 2).forEach((url) => {
          queue.push({ type: 'url', payload: url, depth: current.depth + 1 });
        });
      }
    }

    return {
      videoUrl,
      thumbnailUrl,
      referencedUrls: Array.from(referencedUrls),
      taskInfo,
      status,
      taskId,
      errorMessage,
    };
  }

  private async pollTaskUntilComplete(taskUrls: string[]): Promise<Sora2ResolvedMedia | null> {
    let attempt = 0;

    while (attempt < SORA2_POLL_MAX_ATTEMPTS) {
      attempt += 1;
      await this.delay(SORA2_POLL_INTERVAL_MS);

      for (const taskUrl of taskUrls) {
        try {
          const payload = await this.safeFetchTextWithTimeout(taskUrl);
          if (!payload) continue;

          const resolved = await this.resolveSora2Response(payload);
          if (resolved.status && SORA2_FAILED_STATUSES.includes(resolved.status)) {
            return resolved;
          }

          if (resolved.videoUrl) {
            return resolved;
          }

          if (resolved.status && SORA2_POLL_STATUSES.includes(resolved.status)) {
            break;
          }
        } catch (error) {
          this.logger.warn(`轮询 Sora2 任务失败: ${taskUrl} ${error instanceof Error ? error.message : error}`);
        }
      }
    }

    this.logger.warn('Sora2 任务轮询超时');
    return null;
  }

  private async safeFetchTextWithTimeout(
    url: string,
    timeoutMs: number = SORA2_FETCH_TIMEOUT_MS,
  ): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        this.logger.warn(`Sora2 任务跟进请求失败: ${url} ${response.status}`);
        return null;
      }
      return await response.text();
    } catch (error) {
      this.logger.warn(
        `无法访问 Sora2 任务地址 ${url}: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private tryParseJson(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  private normalizeUrlCandidate(value: string): string {
    return value.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/[,.;)\]\s]+$/g, '');
  }

  private extractUrlsFromText(text: string): string[] {
    const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    return matches.map((value) => this.normalizeUrlCandidate(value));
  }

  private collectUrlsFromObject(value: unknown, bucket: Set<string>) {
    if (!value) return;
    if (typeof value === 'string') {
      if (value.startsWith('http')) {
        bucket.add(this.normalizeUrlCandidate(value));
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => this.collectUrlsFromObject(item, bucket));
      return;
    }
    if (typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach((item) =>
        this.collectUrlsFromObject(item, bucket),
      );
    }
  }

  private pickFirstMatchingUrl(
    urls: Iterable<string>,
    matcher: (url: string) => boolean,
  ): string | undefined {
    for (const url of urls) {
      if (matcher(url)) {
        return url;
      }
    }
    return undefined;
  }

  private isLikelyVideoUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return SORA2_VIDEO_EXTENSIONS.some((ext) => lower.includes(ext));
  }

  private isLikelyImageUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return SORA2_IMAGE_EXTENSIONS.some((ext) => lower.includes(ext));
  }

  private isAsyncTaskUrl(url: string): boolean {
    return SORA2_ASYNC_HOST_HINTS.some((mark) => url.includes(mark));
  }

  private isRetryableVideoError(error: unknown): boolean {
    const code = (error as any)?.code as string | undefined;
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (code?.startsWith('HTTP_5')) return true;
    if (code === 'NETWORK_ERROR') return true;
    if (/load failed/i.test(message)) return true;
    if (/failed to fetch/i.test(message)) return true;
    if (/network.*error/i.test(message)) return true;
    if (/timeout/i.test(message)) return true;
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
