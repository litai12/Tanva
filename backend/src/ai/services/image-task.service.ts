import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageGenerationService } from '../image-generation.service';
import { OpenObserveTelemetryService } from '../../telemetry/openobserve-telemetry.service';
import { captureTraceContext, runWithSpan, type PersistedTraceContext } from '../../telemetry/tracing';

export type ImageTaskType = 'generate' | 'edit' | 'blend' | 'expand';
export type ImageTaskStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

@Injectable()
export class ImageTaskService {
  private readonly logger = new Logger(ImageTaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageGenService: ImageGenerationService,
    private readonly telemetryService: OpenObserveTelemetryService,
  ) {}

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

          await this.prisma.imageTask.update({
            where: { id: taskId },
            data: {
              status: 'succeeded',
              imageUrl: result.imageData,
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
              hasImage: Boolean(result?.imageData),
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
