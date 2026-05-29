import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createAsyncTask,
  updateAsyncTask,
} from './async-video-task.store';
import { CollabEventBus } from '../../team-collab/collab-event-bus.service';
import { CollabEventLog } from '../../team-collab/collab-event-log.service';
import {
  CollabEnvelope,
  TaskStatusPayload,
} from '../../team-collab/types';

export interface CreateVideoTaskParams {
  taskId: string;
  userId: string;
  nodeId?: string;
  taskType: string;
  prompt?: string;
  metadata?: Record<string, any>;
  projectId?: string;
}

export interface UpdateVideoTaskParams {
  status?: 'queued' | 'processing' | 'succeeded' | 'failed';
  result?: Record<string, any>;
  error?: string;
  completedAt?: Date;
}

const STUCK_TASK_TIMEOUT_MS = 40 * 60 * 1000; // 40 minutes

@Injectable()
export class GenerationTaskService implements OnModuleInit {
  private readonly logger = new Logger(GenerationTaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly collabBus?: CollabEventBus,
    @Optional() private readonly collabLog?: CollabEventLog,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcileStuckTasks();
  }

  async createVideoTask(params: CreateVideoTaskParams): Promise<void> {
    const { taskId, userId, nodeId, taskType, prompt, metadata, projectId } = params;

    createAsyncTask(taskId);

    const persistedMetadata =
      projectId || metadata
        ? { ...(metadata ?? {}), ...(projectId ? { projectId } : {}) }
        : undefined;

    await this.prisma.videoTask.create({
      data: {
        id: taskId,
        userId,
        nodeId: nodeId ?? null,
        status: 'queued',
        taskType,
        prompt: prompt ?? null,
        metadata: persistedMetadata as any,
      },
    });

    if (projectId) {
      await this.publishTaskStatus(projectId, {
        taskId,
        nodeId: nodeId ?? null,
        taskType,
        category: 'video',
        status: 'queued',
      });
    }

    // Supersede previous queued/processing tasks for this node.
    // Race condition: a concurrent request arriving between create and this updateMany could
    // create another task for the same nodeId. The id:{not:taskId} guard ensures we never
    // supersede ourselves; both concurrent tasks will supersede their shared predecessors,
    // which is acceptable — the node UI will reflect whichever task completes last.
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
    // Memory store uses 'pending'/'processing'/'completed'/'failed'; DB uses 'queued'/'processing'/'succeeded'/'failed'
    const memoryStatus =
      update.status === 'succeeded' ? 'completed' :
      update.status === 'queued' ? 'pending' :
      update.status;

    updateAsyncTask(taskId, {
      status: memoryStatus as any,
      result: update.result as any,
      error: update.error,
    });

    let projectIdFromDb: string | null = null;
    let nodeIdFromDb: string | null = null;
    let taskType: string | undefined;
    try {
      const before = await this.prisma.videoTask.findUnique({
        where: { id: taskId },
        select: { metadata: true, nodeId: true, taskType: true },
      });
      const meta = (before?.metadata as any) ?? null;
      if (meta && typeof meta === 'object' && typeof meta.projectId === 'string') {
        projectIdFromDb = meta.projectId;
      }
      nodeIdFromDb = before?.nodeId ?? null;
      taskType = before?.taskType ?? undefined;
    } catch {}

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

    if (projectIdFromDb && update.status) {
      const resultPreview = this.extractResultPreview(update.result);
      await this.publishTaskStatus(projectIdFromDb, {
        taskId,
        nodeId: nodeIdFromDb,
        taskType: taskType ?? 'video',
        category: 'video',
        status: update.status,
        resultPreview,
        error: update.error ?? null,
      });
    }
  }

  /**
   * Publish a task_status envelope to project subscribers. Safe to call when
   * collab services are unavailable — silently no-ops.
   */
  async publishTaskStatus(
    projectId: string,
    payload: TaskStatusPayload,
  ): Promise<void> {
    if (!this.collabBus || !this.collabLog) return;
    try {
      const seq = await this.collabLog.nextSeq(projectId);
      const envelope: CollabEnvelope<TaskStatusPayload> = {
        type: 'task_status',
        payload,
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

  private extractResultPreview(
    result: Record<string, any> | undefined,
  ): TaskStatusPayload['resultPreview'] {
    if (!result) return null;
    const url =
      typeof result.url === 'string'
        ? result.url
        : typeof result.videoUrl === 'string'
        ? result.videoUrl
        : typeof result.imageUrl === 'string'
        ? result.imageUrl
        : undefined;
    const thumbnailUrl =
      typeof result.thumbnailUrl === 'string'
        ? result.thumbnailUrl
        : typeof result.coverUrl === 'string'
        ? result.coverUrl
        : undefined;
    if (!url && !thumbnailUrl) return null;
    return { url, thumbnailUrl };
  }

  async findVideoTaskById(taskId: string) {
    return this.prisma.videoTask.findUnique({ where: { id: taskId } });
  }

  async batchQueryByTaskIds(
    taskIds: string[],
    userId: string,
  ): Promise<Record<string, { status: string; imageUrl?: string; thumbnailUrl?: string; textResponse?: string; error?: string } | null>> {
    const limited = taskIds.slice(0, 100);
    const result: Record<string, { status: string; imageUrl?: string; thumbnailUrl?: string; textResponse?: string; error?: string } | null> = {};
    for (const id of limited) result[id] = null;

    const imageTasks = await this.prisma.imageTask.findMany({
      where: { id: { in: limited }, userId },
    });

    for (const t of imageTasks) {
      result[t.id] = {
        status: t.status,
        imageUrl: t.imageUrl ?? undefined,
        thumbnailUrl: t.thumbnailUrl ?? undefined,
        textResponse: t.textResponse ?? undefined,
        error: t.error ?? undefined,
      };
    }

    return result;
  }


  private async reconcileStuckTasks(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_TASK_TIMEOUT_MS);
    try {
      // `processing` → immediately orphan on startup regardless of age.
      // The process died; there is no worker still running these tasks.
      //
      // `queued` → only orphan if stuck for > 40 min (Redis job may still exist
      // and the worker will re-pick it up after restart).
      const { count: vProcessing } = await this.prisma.videoTask.updateMany({
        where: { status: 'processing', updatedAt: { lt: cutoff } },
        data: { status: 'failed', error: 'task orphaned after backend restart' },
      });
      const { count: iProcessing } = await this.prisma.imageTask.updateMany({
        where: { status: 'processing', updatedAt: { lt: cutoff } },
        data: { status: 'failed', error: 'task orphaned after backend restart' },
      });
      const { count: vQueued } = await this.prisma.videoTask.updateMany({
        where: { status: 'queued', updatedAt: { lt: cutoff } },
        data: { status: 'failed', error: 'task orphaned after backend restart' },
      });
      const { count: iQueued } = await this.prisma.imageTask.updateMany({
        where: { status: 'queued', updatedAt: { lt: cutoff } },
        data: { status: 'failed', error: 'task orphaned after backend restart' },
      });
      const total = vProcessing + iProcessing + vQueued + iQueued;
      if (total > 0) {
        this.logger.warn(
          `Reconciled orphaned tasks on startup:` +
          ` processing(video=${vProcessing} image=${iProcessing})` +
          ` stuck-queued(video=${vQueued} image=${iQueued})`,
        );
      }
    } catch (err) {
      this.logger.error('Failed to reconcile stuck tasks on startup', err);
    }
  }
}
