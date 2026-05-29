import { BadGatewayException, forwardRef, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ImageTaskQueueService, type ImageTaskJobPayload } from './image-task-queue.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageGenerationService } from '../image-generation.service';
import { OpenObserveTelemetryService } from '../../telemetry/openobserve-telemetry.service';
import { captureTraceContext, runWithSpan, type PersistedTraceContext } from '../../telemetry/tracing';
import { OssService } from '../../oss/oss.service';
import { CreditsService } from '../../credits/credits.service';
import { ApiResponseStatus } from '../../credits/dto/credits.dto';
import { AIProviderFactory } from '../ai-provider.factory';
import crypto from 'crypto';
import { Readable } from 'stream';
import { CollabEventBus } from '../../team-collab/collab-event-bus.service';
import { CollabEventLog } from '../../team-collab/collab-event-log.service';
import {
  CollabEnvelope,
  TaskBroadcastStatus,
  TaskStatusPayload,
} from '../../team-collab/types';

export type ImageTaskType = 'generate' | 'edit' | 'blend' | 'expand';
export type ImageTaskStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

/**
 * 根据任务类型和模型映射到 ServiceType
 */
function resolveTaskServiceType(taskType: ImageTaskType, model?: string): string {
  const normalizedModel = model?.trim().toLowerCase();
  switch (taskType) {
    case 'generate':
      if (normalizedModel?.includes('gpt-image-2')) return 'gpt-image-2';
      if (normalizedModel?.includes('seedream')) return 'doubao-seedream-5-0-260128';
      if (normalizedModel?.includes('3.1')) return 'gemini-3.1-image';
      if (normalizedModel?.includes('2.5')) return 'gemini-2.5-image';
      return 'gemini-3-pro-image';
    case 'edit':
      if (normalizedModel?.includes('3.1')) return 'gemini-3.1-image-edit';
      if (normalizedModel?.includes('2.5')) return 'gemini-2.5-image-edit';
      return 'gemini-image-edit';
    case 'blend':
      if (normalizedModel?.includes('3.1')) return 'gemini-3.1-image-blend';
      if (normalizedModel?.includes('2.5')) return 'gemini-2.5-image-blend';
      return 'gemini-image-blend';
    default:
      return 'gemini-3-pro-image';
  }
}

function normalizeBananaRoute(
  value: unknown,
): 'normal' | 'stable' | 'ultra' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'normal' || normalized === 'apimart') return 'normal';
  if (normalized === 'stable' || normalized === 'tencent') return 'stable';
  if (normalized === 'ultra' || normalized === 'beqlee') return 'ultra';
  return null;
}

@Injectable()
export class ImageTaskService {
  private readonly logger = new Logger(ImageTaskService.name);

  // 单个图像任务最大执行时长，超过即判定卡死并标记失败（默认 15 分钟，可用环境变量覆盖）
  private static readonly TASK_MAX_DURATION_MS = Number(
    process.env.IMAGE_TASK_MAX_DURATION_MS ?? 15 * 60 * 1000,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageGenService: ImageGenerationService,
    private readonly providerFactory: AIProviderFactory,
    private readonly telemetryService: OpenObserveTelemetryService,
    private readonly oss: OssService,
    private readonly creditsService: CreditsService,
    @Inject(forwardRef(() => ImageTaskQueueService))
    private readonly imageTaskQueue: ImageTaskQueueService,
    @Optional() private readonly collabBus?: CollabEventBus,
    @Optional() private readonly collabLog?: CollabEventLog,
  ) {}

  private async publishTaskStatus(
    projectId: string | undefined | null,
    payload: {
      taskId: string;
      nodeId?: string | null;
      taskType: string;
      status: TaskBroadcastStatus;
      resultPreview?: TaskStatusPayload['resultPreview'];
      error?: string | null;
    },
  ): Promise<void> {
    if (!projectId || !this.collabBus || !this.collabLog) return;
    try {
      const seq = await this.collabLog.nextSeq(projectId);
      const envelope: CollabEnvelope<TaskStatusPayload> = {
        type: 'task_status',
        payload: {
          taskId: payload.taskId,
          nodeId: payload.nodeId ?? null,
          taskType: payload.taskType,
          category: 'image',
          status: payload.status,
          resultPreview: payload.resultPreview ?? null,
          error: payload.error ?? null,
        },
        ts: Date.now(),
        seq,
      };
      await this.collabLog.append(projectId, envelope);
      await this.collabBus.publish(projectId, envelope);
    } catch (err) {
      this.logger.warn(
        `publishTaskStatus failed (project=${projectId} task=${payload.taskId}): ${(err as Error).message}`,
      );
    }
  }

  private extractBase64Payload(imageValue: string): string {
    const trimmed = imageValue.trim();
    const match = trimmed.match(/^data:[^;,]+;base64,(.+)$/i);
    return (match ? match[1] : trimmed).replace(/\s+/g, '');
  }

  private inferImageMimeFromBuffer(buffer: Buffer): { mimeType: string; extension: string } {
    if (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    ) {
      return { mimeType: 'image/png', extension: 'png' };
    }

    if (buffer.length >= 3 && buffer.subarray(0, 3).toString('hex') === 'ffd8ff') {
      return { mimeType: 'image/jpeg', extension: 'jpg' };
    }

    if (buffer.length >= 6) {
      const header = buffer.subarray(0, 6).toString('ascii');
      if (header === 'GIF87a' || header === 'GIF89a') {
        return { mimeType: 'image/gif', extension: 'gif' };
      }
    }

    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return { mimeType: 'image/webp', extension: 'webp' };
    }

    throw new BadGatewayException('图像任务输出不是受支持的图片格式，无法上传到 OSS');
  }

  private async uploadImagePayloadToOss(
    imageValue: string,
    userId: string,
  ): Promise<{ url: string; key: string; mimeType: string; size: number }> {
    if (!this.oss.isEnabled()) {
      throw new ServiceUnavailableException('OSS 未配置或已禁用，无法持久化图像任务结果');
    }

    const payload = this.extractBase64Payload(imageValue);
    if (!payload) {
      throw new BadGatewayException('图像任务输出为空，无法上传到 OSS');
    }

    const decodeCandidate = (encoding: BufferEncoding): Buffer => {
      try {
        return Buffer.from(payload, encoding);
      } catch {
        return Buffer.alloc(0);
      }
    };

    let buffer = decodeCandidate('base64');
    if (!buffer.length) {
      buffer = decodeCandidate('base64url');
    }
    if (!buffer.length) {
      throw new BadGatewayException('图像任务输出解码失败，无法上传到 OSS');
    }

    let mimeType: string;
    let extension: string;
    try {
      ({ mimeType, extension } = this.inferImageMimeFromBuffer(buffer));
    } catch (error) {
      const bufferAlt = decodeCandidate('base64url');
      if (!bufferAlt.length) throw error;
      ({ mimeType, extension } = this.inferImageMimeFromBuffer(bufferAlt));
      buffer = bufferAlt;
    }

    const userTag = crypto.createHash('sha1').update(String(userId)).digest('hex').slice(0, 8);
    const key = `uploads/ai/tasks/${userTag}/${Date.now()}-${crypto
      .randomBytes(6)
      .toString('hex')}.${extension}`;

    const { url } = await this.oss.putStream(key, Readable.from(buffer), {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });

    return { url, key, mimeType, size: buffer.length };
  }

  private async uploadRemoteImageToOss(
    imageUrl: string,
    userId: string,
  ): Promise<{ url: string; key: string; mimeType: string; size: number }> {
    if (!this.oss.isEnabled()) {
      throw new ServiceUnavailableException('OSS 未配置或已禁用，无法持久化图像任务结果');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(imageUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new BadGatewayException(`抓取图像任务外链失败: HTTP ${response.status}`);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.startsWith('image/')) {
        throw new BadGatewayException(`图像任务外链返回了非法 content-type: ${contentType || 'unknown'}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const { mimeType, extension } = this.inferImageMimeFromBuffer(buffer);
      const userTag = crypto.createHash('sha1').update(String(userId)).digest('hex').slice(0, 8);
      const key = `uploads/ai/tasks/${userTag}/${Date.now()}-${crypto
        .randomBytes(6)
        .toString('hex')}.${extension}`;

      const { url } = await this.oss.putStream(key, Readable.from(buffer), {
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });

      return { url, key, mimeType, size: buffer.length };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private resolveAsyncTaskProviderName(
    taskProvider: unknown,
    requestProvider: unknown,
  ): string | null {
    const raw =
      typeof requestProvider === 'string' && requestProvider.trim().length > 0
        ? requestProvider.trim()
        : typeof taskProvider === 'string' && taskProvider.trim().length > 0
          ? taskProvider.trim()
          : '';
    if (!raw) return null;
    return raw.toLowerCase();
  }

  private isGeminiProvider(providerName: string | null): boolean {
    return !providerName || providerName === 'gemini' || providerName === 'gemini-pro';
  }

  private summarizeRequestPrompt(prompt?: unknown): string | undefined {
    if (typeof prompt !== 'string') return undefined;
    const trimmed = prompt.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private extractRenderableRequestImageRefs(values: unknown[]): string[] {
    const candidates: string[] = [];
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) continue;
      if (/^[A-Za-z0-9+/=]{80,}$/.test(trimmed)) continue;
      if (!candidates.includes(trimmed)) {
        candidates.push(trimmed);
      }
    }
    return candidates;
  }

  private asOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private asOptionalBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
  }

  private resolveBananaImageRouteFromTaskRequestData(
    requestData: Record<string, any> | null,
  ): 'normal' | 'stable' | 'ultra' | null {
    if (!requestData) return null;
    return (
      normalizeBananaRoute(requestData.bananaImageRoute) ||
      normalizeBananaRoute(requestData?.providerOptions?.banana?.imageRoute) ||
      normalizeBananaRoute(requestData?.providerOptions?.bananaImageRoute)
    );
  }

  private resolveAsyncTaskOutputImageCount(
    taskType: ImageTaskType,
    requestData: Record<string, any> | null,
  ): number {
    if (taskType !== 'generate') return 1;
    if (!requestData) return 1;

    const batchMode = requestData.batchMode === true;
    const batchCountRaw = Number(requestData.batchCount);
    if (batchMode && Number.isFinite(batchCountRaw) && batchCountRaw > 1) {
      return Math.max(1, Math.min(10, Math.floor(batchCountRaw)));
    }

    return 1;
  }

  private resolveAsyncTaskInputImageCount(
    taskType: ImageTaskType,
    requestData: Record<string, any> | null,
  ): number {
    if (!requestData) return 0;

    if (taskType === 'generate') {
      const refs = this.extractRenderableRequestImageRefs(
        Array.isArray(requestData.imageUrls) ? requestData.imageUrls : [],
      );
      return refs.length;
    }

    if (taskType === 'edit') {
      const refs = this.extractRenderableRequestImageRefs([
        requestData.sourceImageUrl,
        requestData.sourceImage,
      ]);
      return refs.length > 0 ? 1 : 0;
    }

    if (taskType === 'blend') {
      const refs = this.extractRenderableRequestImageRefs([
        ...(Array.isArray(requestData.sourceImageUrls) ? requestData.sourceImageUrls : []),
        ...(Array.isArray(requestData.sourceImages) ? requestData.sourceImages : []),
      ]);
      return refs.length;
    }

    return 0;
  }

  private buildAsyncTaskCreditRequestParams(
    taskId: string,
    taskType: ImageTaskType,
    requestData: Record<string, any> | null,
    providerName: string | null,
  ): Record<string, any> {
    const prompt = this.summarizeRequestPrompt(requestData?.prompt);
    const imageRefs = this.extractRenderableRequestImageRefs([
      ...(Array.isArray(requestData?.imageUrls) ? requestData.imageUrls : []),
      ...(Array.isArray(requestData?.sourceImageUrls) ? requestData.sourceImageUrls : []),
      ...(Array.isArray(requestData?.sourceImages) ? requestData.sourceImages : []),
      requestData?.sourceImageUrl,
      requestData?.sourceImage,
    ]);
    const resolvedRoute = this.resolveBananaImageRouteFromTaskRequestData(requestData);

    const normalizedProviderOptions = (() => {
      const providerOptions = requestData?.providerOptions;
      if (!providerOptions || typeof providerOptions !== 'object') return undefined;

      const legacyRoute = normalizeBananaRoute((providerOptions as any).bananaImageRoute);
      const nestedRoute = normalizeBananaRoute((providerOptions as any)?.banana?.imageRoute);
      const finalRoute = resolvedRoute || nestedRoute || legacyRoute;
      if (!finalRoute) return undefined;

      return {
        bananaImageRoute: finalRoute,
        banana: {
          imageRoute: finalRoute,
        },
      };
    })();

    return {
      taskId,
      taskType,
      ...(this.asOptionalString(providerName) ? { aiProvider: this.asOptionalString(providerName) } : {}),
      ...(this.asOptionalString(requestData?.model) ? { model: this.asOptionalString(requestData?.model) } : {}),
      ...(this.asOptionalString(requestData?.imageSize)
        ? { imageSize: this.asOptionalString(requestData?.imageSize) }
        : {}),
      ...(this.asOptionalString(requestData?.aspectRatio)
        ? { aspectRatio: this.asOptionalString(requestData?.aspectRatio) }
        : {}),
      ...(this.asOptionalString(requestData?.quality)
        ? { quality: this.asOptionalString(requestData?.quality) }
        : {}),
      ...(this.asOptionalString(requestData?.background)
        ? { background: this.asOptionalString(requestData?.background) }
        : {}),
      ...(this.asOptionalString(requestData?.moderation)
        ? { moderation: this.asOptionalString(requestData?.moderation) }
        : {}),
      ...(this.asOptionalBoolean(requestData?.officialFallback) !== undefined
        ? { officialFallback: this.asOptionalBoolean(requestData?.officialFallback) }
        : {}),
      ...(resolvedRoute ? { bananaImageRoute: resolvedRoute } : {}),
      ...(normalizedProviderOptions ? { providerOptions: normalizedProviderOptions } : {}),
      ...(prompt ? { requestPrompt: prompt } : {}),
      ...(imageRefs[0] ? { requestThumbnailUrl: imageRefs[0] } : {}),
      ...(imageRefs.length > 0 ? { requestThumbnailUrls: imageRefs } : {}),
    };
  }

  private async runGenerateTask(
    task: { prompt: string; aiProvider?: string | null },
    taskRequestData: Record<string, any>,
    model?: string,
  ): Promise<any> {
    const providerName = this.resolveAsyncTaskProviderName(
      task.aiProvider,
      taskRequestData?.aiProvider,
    );

    const provider = this.providerFactory.getProvider(model, this.isGeminiProvider(providerName) ? 'new-api' : (providerName ?? undefined));
    const result = await provider.generateImage({
      prompt: task.prompt,
      model,
      imageOnly: taskRequestData.imageOnly,
      aspectRatio: taskRequestData.aspectRatio,
      imageSize: taskRequestData.imageSize,
      thinkingLevel: taskRequestData.thinkingLevel,
      outputFormat: taskRequestData.outputFormat,
      providerOptions: taskRequestData.providerOptions,
      enableWebSearch: taskRequestData.enableWebSearch,
      imageUrls: Array.isArray(taskRequestData.imageUrls)
        ? taskRequestData.imageUrls
            .filter(
              (item: unknown): item is string =>
                typeof item === 'string' && item.trim().length > 0,
            )
            .map((url) => this.oss.withImageResize(url))
        : undefined,
      googleSearch: taskRequestData.googleSearch,
      googleImageSearch: taskRequestData.googleImageSearch,
      batchMode: taskRequestData.batchMode,
      batchCount: taskRequestData.batchCount,
      officialFallback: taskRequestData.officialFallback,
      quality: taskRequestData.quality,
      background: taskRequestData.background,
      moderation: taskRequestData.moderation,
      outputCompression: taskRequestData.outputCompression,
      maskUrl: taskRequestData.maskUrl,
    } as any);

    if (!result?.success || !result?.data) {
      throw new Error(result?.error?.message || 'Failed to generate image');
    }

    return {
      imageData: result.data.imageData,
      imageUrl:
        typeof result.data.imageUrl === 'string' && result.data.imageUrl.trim().length > 0
          ? result.data.imageUrl.trim()
          : typeof result.data.metadata?.imageUrl === 'string' &&
            result.data.metadata.imageUrl.trim().length > 0
            ? String(result.data.metadata.imageUrl).trim()
            : undefined,
      textResponse: result.data.textResponse || '',
      metadata: result.data.metadata || {},
    };
  }

  /**
   * 创建图像生成任务
   */
  async createTask(
    userId: string,
    type: ImageTaskType,
    prompt: string,
    requestData: Record<string, any>,
    aiProvider?: string,
    traceContext?: PersistedTraceContext,
    nodeId?: string,
  ) {
    const persistedTraceContext = captureTraceContext(traceContext);
    const requestPayload = {
      ...(requestData || {}),
      traceId: persistedTraceContext.traceId || null,
      parentRequestId: persistedTraceContext.parentRequestId || null,
      parentSpanId: persistedTraceContext.parentSpanId || null,
      traceFlags: persistedTraceContext.traceFlags ?? 1,
    };

    // 生成 taskId，完整 payload 进队列，DB 写入推迟到 worker 侧执行（削峰）
    const taskId = crypto.randomUUID();

    this.logger.log(`创建图像任务: taskId=${taskId}, type=${type}, userId=${userId}`);

    await this.imageTaskQueue.addJob({
      taskId,
      userId,
      type,
      prompt,
      requestData: requestPayload,
      aiProvider,
      nodeId: nodeId ?? null,
    });

    void this.telemetryService.ingestGenerationTask({
      traceId: persistedTraceContext.traceId || null,
      parentRequestId: persistedTraceContext.parentRequestId || null,
      taskId,
      taskType: type,
      stage: 'queued',
      userId,
      provider: aiProvider || null,
      prompt: prompt?.slice(0, 500) || null,
      status: 'queued',
      metadata: { requestKeys: Object.keys(requestPayload) },
      receivedAt: new Date().toISOString(),
    });

    const projectId =
      typeof (requestData as any)?.projectId === 'string'
        ? ((requestData as any).projectId as string)
        : undefined;
    void this.publishTaskStatus(projectId, {
      taskId,
      nodeId: nodeId ?? null,
      taskType: type,
      status: 'queued',
    });

    return { id: taskId, status: 'queued' as const };
  }

  async isTaskInQueue(taskId: string): Promise<boolean> {
    return this.imageTaskQueue.hasJob(taskId);
  }

  /**
   * 查询任务状态
   */
  async getTaskStatus(taskId: string, userId: string) {
    const task = await this.prisma.imageTask.findFirst({
      where: { id: taskId, userId },
    });

    if (task) {
      // 孤儿/卡死兜底：创建已超过最大时长（默认 15min）却仍未结束的任务，前端查询时直接判失败，
      // 让前端停止轮询。进程崩溃/重启会让 worker 来不及写终态、DB 行卡在 processing；这里在轮询时纠正。
      // 说明：这里只纠正状态、不退款——活进程里超时的任务由 worker 的 15min race 负责退款；
      // 进程崩溃导致的孤儿退款是已知缺口（worker 自扣的 apiUsageId 未落库），见对话中的后续跟进。
      if (task.status === 'processing' || task.status === 'queued') {
        const ageMs = Date.now() - new Date(task.createdAt).getTime();
        if (ageMs > ImageTaskService.TASK_MAX_DURATION_MS) {
          const reason = `任务超过 ${Math.round(
            ImageTaskService.TASK_MAX_DURATION_MS / 60000,
          )} 分钟未完成，已判定为孤儿任务`;
          // 原子翻转，避免并发轮询重复处理。
          await this.prisma.imageTask.updateMany({
            where: { id: taskId, status: { in: ['queued', 'processing'] } },
            data: { status: 'failed', error: reason, completedAt: new Date() },
          });
          this.logger.warn(`孤儿任务查询时判失败: taskId=${taskId}, age=${Math.round(ageMs / 1000)}s`);
          return { ...task, status: 'failed', error: reason };
        }
      }
      return task;
    }

    // DB 记录尚未写入（任务仍在队列中等待 worker 处理）
    const inQueue = await this.imageTaskQueue.hasJob(taskId);
    if (inQueue) {
      return { id: taskId, status: 'queued', userId, createdAt: new Date(), updatedAt: new Date() };
    }

    throw new NotFoundException(`任务不存在: taskId=${taskId}`);
  }

  /**
   * 执行图像生成任务
   */
  /** Worker 调用的入口（携带完整 payload，DB 写入在此进行） */
  async executeTaskFromJob(payload: ImageTaskJobPayload): Promise<void> {
    const { taskId, userId, type, prompt, requestData, aiProvider, nodeId } = payload;

    // 幂等写入：若 job 被重投递，upsert 保证不重复创建
    const task = await this.prisma.imageTask.upsert({
      where: { id: taskId },
      create: {
        id: taskId,
        userId,
        type,
        prompt,
        requestData,
        aiProvider,
        status: 'queued',
        retryCount: 0,
        nodeId: nodeId ?? null,
      },
      update: {}, // 已存在则不覆盖
    });

    return this.executeTaskCore(task);
  }

  /** @deprecated 保留供直接按 ID 触发（管理后台等场景） */
  async executeTaskById(taskId: string): Promise<void> {
    const task = await this.prisma.imageTask.findUnique({ where: { id: taskId } });
    if (!task) {
      this.logger.error(`任务不存在: taskId=${taskId}`);
      return;
    }
    return this.executeTaskCore(task);
  }

  private async executeTaskCore(task: Awaited<ReturnType<typeof this.prisma.imageTask.findUniqueOrThrow>>): Promise<void> {
    const taskId = task.id;

    // 幂等闸门：只处理 queued 的任务。已 succeeded/processing/failed 的行直接跳过，
    // 避免重启后积压的旧 job 重投递时重复生成、重复预扣积分（double-charge）。
    if (task.status !== 'queued') {
      this.logger.warn(
        `跳过非 queued 任务: taskId=${taskId}, status=${task.status}（重复投递或重启 reconcile 所致）`,
      );
      return;
    }

    const taskRequestData =
      task.requestData && typeof task.requestData === 'object'
        ? (task.requestData as Record<string, any>)
        : null;
    const taskTraceContext: PersistedTraceContext = {
      traceId: taskRequestData?.traceId || null,
      parentRequestId: taskRequestData?.parentRequestId || null,
      parentSpanId: taskRequestData?.parentSpanId || null,
      traceFlags:
        typeof taskRequestData?.traceFlags === 'number' ? taskRequestData.traceFlags : 1,
    };

    // 解析任务的服务类型
    const model = taskRequestData?.model as string | undefined;
    const taskType = task.type as ImageTaskType;
    const serviceType = resolveTaskServiceType(taskType, model);
    const outputImageCount = this.resolveAsyncTaskOutputImageCount(
      taskType,
      taskRequestData,
    );
    const inputImageCount = this.resolveAsyncTaskInputImageCount(
      taskType,
      taskRequestData,
    );
    const resolvedTaskProviderName = this.resolveAsyncTaskProviderName(
      task.aiProvider,
      taskRequestData?.aiProvider,
    );
    const apiUsageId = taskRequestData?.apiUsageId as string | undefined;

    // 如果有 apiUsageId，则说明已在控制器层预扣积分；否则需要自己处理
    const needsCreditsProcessing = !apiUsageId;

    await runWithSpan(
      `image-task.${taskType}`,
      taskTraceContext,
      {
        'app.task.id': taskId,
        'app.task.type': task.type,
        'app.user.id': task.userId,
        'app.ai.provider': task.aiProvider || 'unknown',
        'app.credits.apiUsageId': apiUsageId || 'none',
        'app.credits.needsProcessing': needsCreditsProcessing,
      },
      async () => {
        const startedAt = Date.now();
        let effectiveApiUsageId: string | undefined = apiUsageId;

        try {
          // 如果需要自己处理积分，则先预扣积分
          if (needsCreditsProcessing) {
            try {
              const deductResult = await this.creditsService.preDeductCredits({
                userId: task.userId,
                serviceType: serviceType as any,
                model,
                inputImageCount,
                outputImageCount,
                requestParams: this.buildAsyncTaskCreditRequestParams(
                  taskId,
                  taskType,
                  taskRequestData,
                  resolvedTaskProviderName,
                ),
              });
              effectiveApiUsageId = deductResult.apiUsageId;
              this.logger.debug(
                `异步任务预扣积分: taskId=${taskId}, apiUsageId=${effectiveApiUsageId}`
              );
            } catch (deductError) {
              // 预扣积分失败，标记任务失败
              const errorMsg =
                deductError instanceof Error ? deductError.message : String(deductError);
              this.logger.error(`异步任务预扣积分失败: taskId=${taskId}, error=${errorMsg}`);
              await this.prisma.imageTask.update({
                where: { id: taskId },
                data: {
                  status: 'failed',
                  error: `积分预扣失败: ${errorMsg}`,
                  completedAt: new Date(),
                },
              });
              return;
            }
          }

          await this.prisma.imageTask.update({
            where: { id: taskId },
            data: { status: 'processing' },
          });
          void this.publishTaskStatus(
            taskRequestData?.projectId as string | undefined,
            {
              taskId,
              nodeId: task.nodeId ?? null,
              taskType,
              status: 'processing',
            },
          );
          this.logger.log(
            `开始执行任务: taskId=${taskId}, type=${taskType}, apiUsageId=${effectiveApiUsageId}`
          );
          void this.telemetryService.ingestGenerationTask({
            traceId: taskTraceContext.traceId || null,
            parentRequestId: taskTraceContext.parentRequestId || null,
            taskId,
            taskType,
            stage: 'processing',
            userId: task.userId,
            provider: task.aiProvider || null,
            prompt: task.prompt?.slice(0, 500) || null,
            status: 'processing',
            metadata: {
              requestKeys: task.requestData && typeof task.requestData === 'object'
                ? Object.keys(task.requestData as Record<string, unknown>)
                : [],
            },
            receivedAt: new Date().toISOString(),
          });

          const generate = async (): Promise<any> => {
            switch (taskType) {
              case 'generate':
                return await this.runGenerateTask(task, taskRequestData || {}, model);
              case 'edit': {
                const editProvider = this.providerFactory.getProvider(model, 'new-api');
                const editResult = await editProvider.editImage(taskRequestData as any);
                if (!editResult?.success || !editResult?.data) {
                  throw new Error(editResult?.error?.message || 'Failed to edit image');
                }
                return { imageData: editResult.data.imageData, imageUrl: editResult.data.imageUrl, textResponse: editResult.data.textResponse || '' };
              }
              case 'blend': {
                const blendProvider = this.providerFactory.getProvider(model, 'new-api');
                const blendResult = await blendProvider.blendImages(taskRequestData as any);
                if (!blendResult?.success || !blendResult?.data) {
                  throw new Error(blendResult?.error?.message || 'Failed to blend images');
                }
                return { imageData: blendResult.data.imageData, imageUrl: blendResult.data.imageUrl, textResponse: blendResult.data.textResponse || '' };
              }
              case 'expand':
                throw new Error('扩图功能暂未实现异步模式');
              default:
                throw new Error(`不支持的任务类型: ${taskType}`);
            }
          };

          // 最大时长上限：生图超过该时长即判定为卡死，抛错走下方 catch（标记 failed + 退款 + 释放 worker 槽位）。
          const timeoutMs = ImageTaskService.TASK_MAX_DURATION_MS;
          let timeoutHandle: NodeJS.Timeout | undefined;
          const result: any = await Promise.race([
            generate(),
            new Promise<never>((_, reject) => {
              timeoutHandle = setTimeout(
                () =>
                  reject(
                    new Error(
                      `图像生成超时（超过 ${Math.round(timeoutMs / 60000)} 分钟），已自动判定为失败`,
                    ),
                  ),
                timeoutMs,
              );
            }),
          ]).finally(() => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
          });

          const taskImagePayload =
            typeof result?.imageUrl === 'string' && /^https?:\/\//i.test(result.imageUrl)
              ? result.imageUrl
              : typeof result?.imageData === 'string'
              ? result.imageData
              : '';

          if (!taskImagePayload) {
            throw new BadGatewayException('Image task succeeded but no image payload returned');
          }

          let persistedImageUrl: string | null = null;
          let persistedThumbnailUrl: string | null = null;
          if (taskImagePayload) {
            if (/^https?:\/\//i.test(taskImagePayload)) {
              const uploaded = await this.uploadRemoteImageToOss(taskImagePayload, task.userId);
              persistedImageUrl = uploaded.url;
              persistedThumbnailUrl = uploaded.url;
            } else {
              const uploaded = await this.uploadImagePayloadToOss(taskImagePayload, task.userId);
              persistedImageUrl = uploaded.url;
              persistedThumbnailUrl = uploaded.url;
            }
          }

          // 仅当任务仍是 processing 时才写成功，避免覆盖「孤儿兜底/对账」已判定的 failed
          // （生成接近 15min 上限、上传又拖过线时可能发生）。被判失败则丢弃这次迟到的成功结果。
          const { count: succeededCount } = await this.prisma.imageTask.updateMany({
            where: { id: taskId, status: 'processing' },
            data: {
              status: 'succeeded',
              imageUrl: persistedImageUrl,
              thumbnailUrl: persistedThumbnailUrl,
              textResponse: result.textResponse,
              completedAt: new Date(),
            },
          });

          if (succeededCount === 0) {
            this.logger.warn(`任务已被判失败，丢弃迟到的成功结果: taskId=${taskId}`);
            return;
          }

          void this.publishTaskStatus(
            taskRequestData?.projectId as string | undefined,
            {
              taskId,
              nodeId: task.nodeId ?? null,
              taskType,
              status: 'succeeded',
              resultPreview: persistedImageUrl
                ? { url: persistedImageUrl, thumbnailUrl: persistedThumbnailUrl ?? undefined }
                : null,
            },
          );

          // 任务成功，更新积分状态为成功
          if (effectiveApiUsageId) {
            try {
              await this.creditsService.updateApiUsageStatus(
                effectiveApiUsageId,
                ApiResponseStatus.SUCCESS,
                undefined,
                Date.now() - startedAt
              );
            } catch (updateError) {
              this.logger.warn(
                `更新API使用记录状态失败: taskId=${taskId}, apiUsageId=${effectiveApiUsageId}, error=${updateError}`
              );
            }
          }

          this.logger.log(`任务执行成功: taskId=${taskId}`);
          void this.telemetryService.ingestGenerationTask({
            traceId: taskTraceContext.traceId || null,
            parentRequestId: taskTraceContext.parentRequestId || null,
            taskId,
            taskType,
            stage: 'succeeded',
            userId: task.userId,
            provider: task.aiProvider || null,
            prompt: task.prompt?.slice(0, 500) || null,
            status: 'succeeded',
            durationMs: Date.now() - startedAt,
            metadata: {
              hasImage: Boolean(persistedImageUrl),
              hasTextResponse: Boolean(result?.textResponse),
            },
            receivedAt: new Date().toISOString(),
          });
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(`任务执行失败: taskId=${taskId}, error=${errorMessage}`);

          await this.prisma.imageTask.update({
            where: { id: taskId },
            data: {
              status: 'failed',
              error: errorMessage || '图像生成失败',
              completedAt: new Date(),
            },
          });

          void this.publishTaskStatus(
            taskRequestData?.projectId as string | undefined,
            {
              taskId,
              nodeId: task.nodeId ?? null,
              taskType,
              status: 'failed',
              error: errorMessage || '图像生成失败',
            },
          );

          // 任务失败，标记积分状态为失败并触发退款
          if (effectiveApiUsageId) {
            try {
              await this.creditsService.updateApiUsageStatus(
                effectiveApiUsageId,
                ApiResponseStatus.FAILED,
                errorMessage,
                Date.now() - startedAt
              );
              // 执行退款
              await this.creditsService.refundCredits(task.userId, effectiveApiUsageId);
              this.logger.log(
                `异步任务失败已退款: taskId=${taskId}, apiUsageId=${effectiveApiUsageId}`
              );
            } catch (creditsError) {
              const creditsErrorMsg =
                creditsError instanceof Error ? creditsError.message : String(creditsError);
              this.logger.error(
                `异步任务积分退款失败: taskId=${taskId}, apiUsageId=${effectiveApiUsageId}, error=${creditsErrorMsg}`
              );
            }
          }

          void this.telemetryService.ingestGenerationTask({
            traceId: taskTraceContext.traceId || null,
            parentRequestId: taskTraceContext.parentRequestId || null,
            taskId,
            taskType,
            stage: 'failed',
            userId: task.userId,
            provider: task.aiProvider || null,
            prompt: task.prompt?.slice(0, 500) || null,
            status: 'failed',
            error: errorMessage || '图像生成失败',
            receivedAt: new Date().toISOString(),
          });
        }
      },
    );
  }
}
