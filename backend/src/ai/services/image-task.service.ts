import { BadGatewayException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageGenerationService } from '../image-generation.service';
import { OpenObserveTelemetryService } from '../../telemetry/openobserve-telemetry.service';
import { captureTraceContext, runWithSpan, type PersistedTraceContext } from '../../telemetry/tracing';
import { OssService } from '../../oss/oss.service';
import crypto from 'crypto';
import { Readable } from 'stream';

export type ImageTaskType = 'generate' | 'edit' | 'blend' | 'expand';
export type ImageTaskStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

@Injectable()
export class ImageTaskService {
  private readonly logger = new Logger(ImageTaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageGenService: ImageGenerationService,
    private readonly telemetryService: OpenObserveTelemetryService,
    private readonly oss: OssService,
  ) {}

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

    await runWithSpan(
      `image-task.${task.type}`,
      taskTraceContext,
      {
        'app.task.id': taskId,
        'app.task.type': task.type,
        'app.user.id': task.userId,
        'app.ai.provider': task.aiProvider || 'unknown',
      },
      async () => {
        try {
          const startedAt = Date.now();
          await this.prisma.imageTask.update({
            where: { id: taskId },
            data: { status: 'processing' },
          });
          this.logger.log(`开始执行任务: taskId=${taskId}, type=${task.type}`);
          void this.telemetryService.ingestGenerationTask({
            traceId: taskTraceContext.traceId || null,
            parentRequestId: taskTraceContext.parentRequestId || null,
            taskId,
            taskType: task.type,
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

          switch (task.type) {
            case 'generate':
              result = await this.imageGenService.generateImage(task.requestData as any);
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
              throw new Error(`不支持的任务类型: ${task.type}`);
          }

          const taskImagePayload =
            typeof result?.imageUrl === 'string' && /^https?:\/\//i.test(result.imageUrl)
              ? result.imageUrl
              : typeof result?.imageData === 'string'
              ? result.imageData
              : '';

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

          this.logger.log(`任务执行成功: taskId=${taskId}`);
          void this.telemetryService.ingestGenerationTask({
            traceId: taskTraceContext.traceId || null,
            parentRequestId: taskTraceContext.parentRequestId || null,
            taskId,
            taskType: task.type,
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
          this.logger.error(`任务执行失败: taskId=${taskId}, error=${error.message}`);

          await this.prisma.imageTask.update({
            where: { id: taskId },
            data: {
              status: 'failed',
              error: error.message || '图像生成失败',
              completedAt: new Date(),
            },
          });
          void this.telemetryService.ingestGenerationTask({
            traceId: taskTraceContext.traceId || null,
            parentRequestId: taskTraceContext.parentRequestId || null,
            taskId,
            taskType: task.type,
            stage: 'failed',
            userId: task.userId,
            provider: task.aiProvider || null,
            prompt: task.prompt?.slice(0, 500) || null,
            status: 'failed',
            error: error?.message || '图像生成失败',
            receivedAt: new Date().toISOString(),
          });
        }
      },
    );
  }
}
