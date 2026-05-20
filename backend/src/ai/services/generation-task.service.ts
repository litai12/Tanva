import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createAsyncTask,
  updateAsyncTask,
  getAsyncTaskResult,
} from './async-video-task.store';

export interface CreateVideoTaskParams {
  taskId: string;
  userId: string;
  nodeId?: string;
  taskType: string;
  prompt?: string;
  metadata?: Record<string, any>;
}

export interface UpdateVideoTaskParams {
  status?: 'queued' | 'processing' | 'succeeded' | 'failed';
  result?: Record<string, any>;
  error?: string;
  completedAt?: Date;
}

export interface GenerationTaskRecord {
  taskId: string;
  nodeId: string | null;
  category: 'image' | 'video';
  taskType: string;
  status: string;
  result: Record<string, any> | null;
  error: string | null;
  updatedAt: Date;
}

const STUCK_TASK_TIMEOUT_MS = 40 * 60 * 1000; // 40 minutes

@Injectable()
export class GenerationTaskService implements OnModuleInit {
  private readonly logger = new Logger(GenerationTaskService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.reconcileStuckTasks();
  }

  async createVideoTask(params: CreateVideoTaskParams): Promise<void> {
    const { taskId, userId, nodeId, taskType, prompt, metadata } = params;

    createAsyncTask(taskId);

    await this.prisma.videoTask.create({
      data: {
        id: taskId,
        userId,
        nodeId: nodeId ?? null,
        status: 'queued',
        taskType,
        prompt: prompt ?? null,
        metadata: metadata ?? undefined,
      },
    });

    if (nodeId) {
      await this.prisma.videoTask.updateMany({
        where: {
          nodeId,
          userId,
          id: { not: taskId },
          status: { in: ['queued', 'processing'] },
        },
        data: { status: 'failed', error: 'superseded by newer task' },
      });
    }
  }

  async updateVideoTask(taskId: string, update: UpdateVideoTaskParams): Promise<void> {
    const memoryStatus =
      update.status === 'succeeded' ? 'completed' : update.status;

    updateAsyncTask(taskId, {
      status: memoryStatus as any,
      result: update.result as any,
      error: update.error,
    });

    await this.prisma.videoTask
      .update({
        where: { id: taskId },
        data: {
          ...(update.status !== undefined && { status: update.status }),
          ...(update.result !== undefined && { result: update.result }),
          ...(update.error !== undefined && { error: update.error }),
          ...(update.status === 'succeeded' || update.status === 'failed'
            ? { completedAt: update.completedAt ?? new Date() }
            : {}),
        },
      })
      .catch((err: Error) => {
        this.logger.warn(`VideoTask update failed for ${taskId}: ${err.message}`);
      });
  }

  async findVideoTaskById(taskId: string) {
    return this.prisma.videoTask.findUnique({ where: { id: taskId } });
  }

  async batchQueryByNodeIds(
    nodeIds: string[],
    userId: string,
  ): Promise<Record<string, GenerationTaskRecord | null>> {
    const limited = nodeIds.slice(0, 50);
    const result: Record<string, GenerationTaskRecord | null> = {};
    for (const id of limited) result[id] = null;

    const [videoTasks, imageTasks] = await Promise.all([
      this.prisma.videoTask.findMany({
        where: { nodeId: { in: limited }, userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.imageTask.findMany({
        where: { nodeId: { in: limited }, userId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    for (const t of videoTasks) {
      if (!t.nodeId || result[t.nodeId] !== null) continue;
      const memTask = getAsyncTaskResult(t.id);
      const liveStatus =
        memTask?.status === 'completed'
          ? 'succeeded'
          : memTask?.status === 'failed'
          ? 'failed'
          : memTask?.status === 'processing'
          ? 'processing'
          : t.status;

      result[t.nodeId] = {
        taskId: t.id,
        nodeId: t.nodeId,
        category: 'video',
        taskType: t.taskType,
        status: liveStatus,
        result: (memTask?.status === 'completed'
          ? memTask.result
          : t.result) as Record<string, any> | null,
        error: memTask?.error ?? t.error,
        updatedAt: t.updatedAt,
      };
    }

    for (const t of imageTasks) {
      if (!t.nodeId || result[t.nodeId] !== null) continue;
      result[t.nodeId] = {
        taskId: t.id,
        nodeId: t.nodeId,
        category: 'image',
        taskType: t.type,
        status: t.status,
        result: t.imageUrl
          ? {
              imageUrl: t.imageUrl,
              thumbnailUrl: t.thumbnailUrl,
              textResponse: t.textResponse,
            }
          : null,
        error: t.error,
        updatedAt: t.updatedAt,
      };
    }

    return result;
  }

  private async reconcileStuckTasks(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_TASK_TIMEOUT_MS);
    try {
      const { count: vCount } = await this.prisma.videoTask.updateMany({
        where: { status: { in: ['queued', 'processing'] }, updatedAt: { lt: cutoff } },
        data: { status: 'failed', error: 'task orphaned after backend restart' },
      });
      const { count: iCount } = await this.prisma.imageTask.updateMany({
        where: { status: { in: ['queued', 'processing'] }, updatedAt: { lt: cutoff } },
        data: { status: 'failed', error: 'task orphaned after backend restart' },
      });
      if (vCount + iCount > 0) {
        this.logger.warn(
          `Reconciled ${vCount} orphaned video tasks and ${iCount} orphaned image tasks`,
        );
      }
    } catch (err) {
      this.logger.error('Failed to reconcile stuck tasks on startup', err);
    }
  }
}
