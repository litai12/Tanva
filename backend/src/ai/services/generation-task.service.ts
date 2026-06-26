import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
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

const QUEUED_STUCK_MS = 40 * 60 * 1000; // queued 兜底超时（Redis job 可能还在，重启后 worker 会重投）
// 视频/3D 生成可能较久，用较长阈值避免误杀正常任务。默认 1h，env VIDEO_TASK_MAX_DURATION_MS 可调。
const VIDEO_PROCESSING_STUCK_MS = Number(
  process.env.VIDEO_TASK_MAX_DURATION_MS ?? 60 * 60 * 1000,
);
// 图像：worker 侧已有 15min 硬上限(race)+退款；这里取「硬上限 + 5min 上传缓冲」，只兜进程崩溃的孤儿，
// 避免误杀「已出图、正在上传 OSS」尚未写完的任务（race 只包住生成，不包住上传/落库）。
const IMAGE_PROCESSING_STUCK_MS =
  Number(process.env.IMAGE_TASK_MAX_DURATION_MS ?? 15 * 60 * 1000) + 5 * 60 * 1000;
const RECONCILE_INTERVAL_MS = 60 * 1000; // 每分钟扫一次，卡死/孤儿任务无需等下次重启即可被判失败

@Injectable()
export class GenerationTaskService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GenerationTaskService.name);
  private reconcileTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly collabBus?: CollabEventBus,
    @Optional() private readonly collabLog?: CollabEventLog,
  ) {}

  async onModuleInit(): Promise<void> {
    // 启动即扫一次，之后每分钟扫一次：把卡死/孤儿任务判失败（进程常驻也能清理，无需等下次重启）。
    // 用「比正常任务时长更宽」的阈值（见上方常量），避免多实例/滚动发布时误杀其它进程仍在跑的任务。
    await this.reconcileStuckTasks();
    this.reconcileTimer = setInterval(() => {
      void this.reconcileStuckTasks();
    }, RECONCILE_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
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
      // 进度同步：后端无细粒度进度列，按状态给出与本人轮询一致的粗粒度进度
      // (queued=10 / processing=50 / succeeded=100 / failed=0)，让其他在线成员
      // 的节点进度随状态推进，而非仅起止两点。已带 progress 时不覆盖。
      if (typeof payload.progress !== 'number') {
        const p =
          payload.status === 'succeeded' ? 100
          : payload.status === 'processing' ? 50
          : payload.status === 'queued' ? 10
          : payload.status === 'failed' ? 0
          : undefined;
        if (typeof p === 'number') payload = { ...payload, progress: p };
      }
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
    const now = Date.now();
    // 每种任务用各自的阈值，且都比「正常最长耗时」更宽，纯粹兜底卡死/孤儿：
    //   图像 processing：worker 硬上限 + 上传缓冲（约 20min）
    //   视频 processing：40min（视频本就慢）
    //   queued：40min（Redis job 可能还在，重启后 worker 会重投）
    const queuedCutoff = new Date(now - QUEUED_STUCK_MS);
    const videoProcessingCutoff = new Date(now - VIDEO_PROCESSING_STUCK_MS);
    const imageProcessingCutoff = new Date(now - IMAGE_PROCESSING_STUCK_MS);
    try {
      const { count: vProcessing } = await this.prisma.videoTask.updateMany({
        where: { status: 'processing', updatedAt: { lt: videoProcessingCutoff } },
        data: { status: 'failed', error: 'task stuck/orphaned, auto-failed' },
      });
      const { count: iProcessing } = await this.prisma.imageTask.updateMany({
        where: { status: 'processing', updatedAt: { lt: imageProcessingCutoff } },
        data: { status: 'failed', error: 'task stuck/orphaned, auto-failed' },
      });
      const { count: vQueued } = await this.prisma.videoTask.updateMany({
        where: { status: 'queued', updatedAt: { lt: queuedCutoff } },
        data: { status: 'failed', error: 'task orphaned, auto-failed' },
      });
      const { count: iQueued } = await this.prisma.imageTask.updateMany({
        where: { status: 'queued', updatedAt: { lt: queuedCutoff } },
        data: { status: 'failed', error: 'task orphaned, auto-failed' },
      });
      const total = vProcessing + iProcessing + vQueued + iQueued;
      if (total > 0) {
        this.logger.warn(
          `Reconciled stuck tasks:` +
          ` processing(video=${vProcessing} image=${iProcessing})` +
          ` stuck-queued(video=${vQueued} image=${iQueued})`,
        );
      }
    } catch (err) {
      this.logger.error('Failed to reconcile stuck tasks', err);
    }
  }
}
