import { BadGatewayException, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
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
): 'normal' | 'stable' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'normal' || normalized === 'apimart') return 'normal';
  if (normalized === 'stable' || normalized === 'tencent') return 'stable';
  return null;
}

@Injectable()
export class ImageTaskService {
  private readonly logger = new Logger(ImageTaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageGenService: ImageGenerationService,
    private readonly providerFactory: AIProviderFactory,
    private readonly telemetryService: OpenObserveTelemetryService,
    private readonly oss: OssService,
    private readonly creditsService: CreditsService,
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
  ): 'normal' | 'stable' | null {
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

    if (this.isGeminiProvider(providerName)) {
      const resizedData = Array.isArray(taskRequestData.imageUrls)
        ? { ...taskRequestData, imageUrls: taskRequestData.imageUrls.map((u: unknown) => typeof u === 'string' ? this.oss.withImageResize(u) : u) }
        : taskRequestData;
      return this.imageGenService.generateImage(resizedData as any);
    }

    const provider = this.providerFactory.getProvider(model, providerName ?? undefined);
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

    const task = await this.prisma.imageTask.create({
      data: {
        userId,
        type,
        prompt,
        requestData: requestPayload,
        aiProvider,
        status: 'queued',
        retryCount: 0,
        nodeId: nodeId ?? null,
      },
    });

    this.logger.log(`创建图像任务: taskId=${task.id}, type=${type}, userId=${userId}`);
    void this.telemetryService.ingestGenerationTask({
      traceId: persistedTraceContext.traceId || null,
      parentRequestId: persistedTraceContext.parentRequestId || null,
      taskId: task.id,
      taskType: type,
      stage: 'queued',
      userId,
      provider: aiProvider || null,
      prompt: prompt?.slice(0, 500) || null,
      status: 'queued',
      metadata: {
        requestKeys: Object.keys(requestPayload),
      },
      receivedAt: new Date().toISOString(),
    });

    const projectId =
      typeof (requestData as any)?.projectId === 'string'
        ? ((requestData as any).projectId as string)
        : undefined;
    void this.publishTaskStatus(projectId, {
      taskId: task.id,
      nodeId: nodeId ?? null,
      taskType: type,
      status: 'queued',
    });

    // 异步执行任务（不等待）
    this.executeTask(task.id).catch((error) => {
      this.logger.error(`任务执行失败: taskId=${task.id}, error=${error.message}`);
    });

    return task;
  }

  /**
   * 查询任务状态
   */
  async getTaskStatus(taskId: string, userId: string) {
    const task = await this.prisma.imageTask.findFirst({
      where: { id: taskId, userId },
    });

    if (!task) {
      throw new NotFoundException(`任务不存在: taskId=${taskId}`);
    }

    return task;
  }

  /**
   * 执行图像生成任务
   */
  private async executeTask(taskId: string): Promise<void> {
    const task = await this.prisma.imageTask.findUnique({ where: { id: taskId } });
    if (!task) {
      this.logger.error(`任务不存在: taskId=${taskId}`);
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

          let result: any;

          switch (taskType) {
            case 'generate':
              result = await this.runGenerateTask(task, taskRequestData || {}, model);
              break;
            case 'edit':
              result = await this.imageGenService.editImage(task.requestData as any);
              break;
            case 'blend':
              result = await this.imageGenService.blendImages(task.requestData as any);
              break;
            case 'expand':
              throw new Error('扩图功能暂未实现异步模式');
            default:
              throw new Error(`不支持的任务类型: ${taskType}`);
          }

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

          await this.prisma.imageTask.update({
            where: { id: taskId },
            data: {
              status: 'succeeded',
              imageUrl: persistedImageUrl,
              thumbnailUrl: persistedThumbnailUrl,
              textResponse: result.textResponse,
              completedAt: new Date(),
            },
          });

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
