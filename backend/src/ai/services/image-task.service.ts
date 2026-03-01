import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageGenerationService } from '../image-generation.service';

export type ImageTaskType = 'generate' | 'edit' | 'blend' | 'expand';
export type ImageTaskStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

@Injectable()
export class ImageTaskService {
  private readonly logger = new Logger(ImageTaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageGenService: ImageGenerationService,
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
  ) {
    const task = await this.prisma.imageTask.create({
      data: {
        userId,
        type,
        prompt,
        requestData,
        aiProvider,
        status: 'queued',
        retryCount: 0,
      },
    });

    this.logger.log(`创建图像任务: taskId=${task.id}, type=${type}, userId=${userId}`);

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

    try {
      // 更新状态为处理中
      await this.prisma.imageTask.update({
        where: { id: taskId },
        data: { status: 'processing' },
      });
      this.logger.log(`开始执行任务: taskId=${taskId}, type=${task.type}`);

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

      // 更新任务为成功
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
    } catch (error: any) {
      this.logger.error(`任务执行失败: taskId=${taskId}, error=${error.message}`);

      // 更新任务为失败
      await this.prisma.imageTask.update({
        where: { id: taskId },
        data: {
          status: 'failed',
          error: error.message || '图像生成失败',
          completedAt: new Date(),
        },
      });
    }
  }
}
