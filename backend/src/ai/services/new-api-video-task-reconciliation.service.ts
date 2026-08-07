import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiResponseStatus } from '../../credits/dto/credits.dto';
import { CreditsService } from '../../credits/credits.service';
import { CreditChargeService } from '../../team-credits/credit-charge.service';
import { VideoProviderService } from './video-provider.service';
import { GlobalImageHistoryService } from '../../global-image-history/global-image-history.service';

const SEEDANCE_VIDEO_SERVICE_TYPE = 'doubao-video';
const NEW_API_TASK_PREFIX = 'newapi:';
const RECONCILIATION_BATCH_SIZE = 100;

type VideoTaskQueryResult = {
  status: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
};

type PendingUsage = {
  id: string;
  userId: string;
  createdAt: Date;
  requestParams: Prisma.JsonValue | null;
};

/**
 * 服务端兜底收敛 new-api Seedance 异步任务。
 *
 * Seedance 创建时会先扣个人积分/预留团队积分，历史上成功确认主要依赖
 * Flow 页面继续轮询并回调 video-task-success。页面关闭、项目切换或旧节点
 * 未重新水合时，供应商已经完成但 ApiUsageRecord 可能一直停留在 PENDING。
 * 这里按已持久化的 taskId 查询上游，并用与前端相同的幂等结算规则完成收敛。
 */
@Injectable()
export class NewApiVideoTaskReconciliationService {
  private readonly logger = new Logger(NewApiVideoTaskReconciliationService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly creditsService: CreditsService,
    private readonly creditCharge: CreditChargeService,
    private readonly videoProviderService: VideoProviderService,
    private readonly globalImageHistory: GlobalImageHistoryService,
  ) {}

  /**
   * 每分钟补偿一批 Seedance/new-api PENDING 任务。
   * 查询失败只记录日志并保留 PENDING，交给下一轮重试；不会因为一次网关
   * 短暂异常直接退款。
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcilePendingTasks(): Promise<void> {
    if (this.running) {
      this.logger.debug('跳过 Seedance/new-api 任务补偿：上一轮仍在运行');
      return;
    }

    this.running = true;
    try {
      const usages = await this.prisma.apiUsageRecord.findMany({
        where: {
          serviceType: SEEDANCE_VIDEO_SERVICE_TYPE,
          responseStatus: ApiResponseStatus.PENDING,
          requestParams: {
            path: ['taskId'],
            string_starts_with: NEW_API_TASK_PREFIX,
          },
        },
        orderBy: { createdAt: 'asc' },
        take: RECONCILIATION_BATCH_SIZE,
        select: {
          id: true,
          userId: true,
          createdAt: true,
          requestParams: true,
        },
      });

      let checked = 0;
      let settled = 0;
      for (const usage of usages) {
        const taskId = this.readTaskId(usage.requestParams);
        if (!taskId || !taskId.startsWith(NEW_API_TASK_PREFIX)) {
          continue;
        }

        checked += 1;
        try {
          const result = await this.videoProviderService.queryTask('doubao', taskId);
          const didSettle = await this.settlePendingUsage({
            usage,
            taskId,
            result,
          });
          if (didSettle) settled += 1;
        } catch (error) {
          this.logger.warn(
            `Seedance/new-api 任务补偿查询失败 apiUsageId=${usage.id}, taskId=${taskId}: ${this.message(error)}`,
          );
        }
      }

      if (checked > 0 || settled > 0) {
        this.logger.log(
          `Seedance/new-api 任务补偿完成: checked=${checked}, settled=${settled}, candidates=${usages.length}`,
        );
      }
    } catch (error) {
      this.logger.error(`Seedance/new-api 任务补偿失败: ${this.message(error)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * 查询接口的快速结算路径。前端即使没有继续调用 video-task-success，
   * 只要查询拿到了终态，后端也会完成一次幂等结算。
   */
  async settleFromQuery(params: {
    userId: string;
    apiUsageId?: string;
    taskId: string;
    result: VideoTaskQueryResult;
  }): Promise<void> {
    const taskId = params.taskId.trim();
    if (!taskId.startsWith(NEW_API_TASK_PREFIX)) return;

    const usage = await this.findPendingUsage({
      userId: params.userId,
      apiUsageId: params.apiUsageId,
      taskId,
    });
    if (!usage) return;

    await this.settlePendingUsage({
      usage,
      taskId,
      result: params.result,
    });
  }

  /**
   * 后台补偿成功后，前端重载同一个节点时优先使用已转存的 Tanva OSS 地址，
   * 不再依赖 new-api 的临时结果 URL 仍然有效。
   */
  async getStoredResultForTask(userId: string, taskId: string): Promise<{
    status: 'succeeded' | 'failed';
    videoUrl?: string;
    thumbnailUrl?: string;
    error?: string;
  } | null> {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId.startsWith(NEW_API_TASK_PREFIX)) return null;

    const usage = await this.prisma.apiUsageRecord.findFirst({
      where: {
        userId,
        serviceType: SEEDANCE_VIDEO_SERVICE_TYPE,
        requestParams: {
          path: ['taskId'],
          equals: normalizedTaskId,
        },
        responseStatus: {
          in: [ApiResponseStatus.SUCCESS, ApiResponseStatus.FAILED],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        responseStatus: true,
        errorMessage: true,
        requestParams: true,
      },
    });
    if (!usage) return null;

    const requestParams = this.asJsonObject(usage.requestParams) || {};
    if (usage.responseStatus === ApiResponseStatus.FAILED) {
      return {
        status: 'failed',
        error:
          typeof usage.errorMessage === 'string' && usage.errorMessage.trim()
            ? usage.errorMessage
            : '视频生成任务失败',
      };
    }

    const videoUrl = this.readString(requestParams.settledVideoUrl);
    if (!videoUrl) return null;

    return {
      status: 'succeeded',
      videoUrl,
      thumbnailUrl: this.readString(requestParams.settledThumbnailUrl) || undefined,
    };
  }

  private async findPendingUsage(params: {
    userId: string;
    apiUsageId?: string;
    taskId: string;
  }): Promise<PendingUsage | null> {
    const where: Prisma.ApiUsageRecordWhereInput = {
      userId: params.userId,
      serviceType: SEEDANCE_VIDEO_SERVICE_TYPE,
      responseStatus: ApiResponseStatus.PENDING,
    };

    if (params.apiUsageId) {
      where.id = params.apiUsageId;
    } else {
      where.requestParams = {
        path: ['taskId'],
        equals: params.taskId,
      };
    }

    return this.prisma.apiUsageRecord.findFirst({
      where,
      select: {
        id: true,
        userId: true,
        createdAt: true,
        requestParams: true,
      },
    });
  }

  private async settlePendingUsage(params: {
    usage: PendingUsage;
    taskId: string;
    result: VideoTaskQueryResult;
  }): Promise<boolean> {
    const status = String(params.result.status || '').trim().toLowerCase();
    const processingTime = Math.max(0, Date.now() - params.usage.createdAt.getTime());
    const current = await this.prisma.apiUsageRecord.findUnique({
      where: { id: params.usage.id },
      select: { userId: true, responseStatus: true },
    });

    if (
      !current ||
      current.userId !== params.usage.userId ||
      current.responseStatus !== ApiResponseStatus.PENDING
    ) {
      return false;
    }

    if (this.isSuccessStatus(status)) {
      await this.persistSuccessfulResult(params.usage.id, params.result);
      await this.recordSuccessfulVideoAsset(params.usage, params.taskId, params.result);

      const teamHandle = await this.creditCharge.resolveHandle(params.usage.id);
      if (teamHandle) {
        await this.creditCharge.commit(teamHandle, { processingTime });
      } else {
        const inputTokens = this.readFiniteNumber(params.result.inputTokens);
        const outputTokens = this.readFiniteNumber(params.result.outputTokens);
        if (inputTokens !== undefined && outputTokens !== undefined) {
          await this.creditsService.settleSeed2TokenCreditsForUser(
            params.usage.userId,
            params.usage.id,
            inputTokens,
            outputTokens,
          );
        }
        await this.creditsService.markApiUsageSuccessForUser(
          params.usage.userId,
          params.usage.id,
          processingTime,
        );
      }

      this.logger.log(
        `✅ Seedance/new-api 任务自动确认成功 apiUsageId=${params.usage.id}, taskId=${params.taskId}`,
      );
      return true;
    }

    if (!this.isFailureStatus(status)) return false;

    const errorMessage = params.result.error || '视频生成任务失败';
    try {
      await this.creditsService.markApiUsageFailedForUser(
        params.usage.userId,
        params.usage.id,
        errorMessage,
        processingTime,
      );
    } catch (error) {
      // 前端/另一轮补偿可能已经把同一条记录确认成功。成功状态不可退款，
      // 此时让成功结果保持最终状态，不把上游查询竞态升级成告警故障。
      if (this.message(error).includes('成功的 API 调用不支持退款')) {
        return false;
      }
      throw error;
    }

    const teamHandle = await this.creditCharge.resolveHandle(params.usage.id);
    if (teamHandle) {
      await this.creditCharge.rollback(teamHandle, {
        errorMessage,
        processingTime,
      });
    } else {
      await this.creditsService.refundCredits(params.usage.userId, params.usage.id);
    }

    this.logger.log(
      `✅ Seedance/new-api 任务自动失败退款 apiUsageId=${params.usage.id}, taskId=${params.taskId}`,
    );
    return true;
  }

  private async persistSuccessfulResult(
    apiUsageId: string,
    result: VideoTaskQueryResult,
  ): Promise<void> {
    if (!result.videoUrl) return;

    try {
      await this.creditsService.updateApiUsageRequestParams(apiUsageId, {
        settledVideoUrl: result.videoUrl,
        ...(result.thumbnailUrl ? { settledThumbnailUrl: result.thumbnailUrl } : {}),
      });
    } catch (error) {
      // 账务终态不能被结果元数据写入失败阻塞；下次项目加载仍可重新查询上游。
      this.logger.warn(
        `Seedance 成功结果地址保存失败 apiUsageId=${apiUsageId}: ${this.message(error)}`,
      );
    }
  }

  private async recordSuccessfulVideoAsset(
    usage: PendingUsage,
    taskId: string,
    result: VideoTaskQueryResult,
  ): Promise<void> {
    if (!result.videoUrl) return;

    const requestParams = this.asJsonObject(usage.requestParams) || {};
    try {
      await this.globalImageHistory.recordVideoForTask({
        userId: usage.userId,
        taskId,
        videoUrl: result.videoUrl,
        thumbnailUrl: result.thumbnailUrl,
        prompt: this.readString(requestParams.prompt) || undefined,
        sourceType: 'seedance20Video',
        sourceProjectId:
          this.readString(requestParams.clientProjectId) ||
          this.readString(requestParams.projectId) ||
          undefined,
        metadata: {
          provider: 'doubao',
          model: this.readString(requestParams.model) || undefined,
          apiUsageId: usage.id,
        },
      });
    } catch (error) {
      // 素材历史的可用性不能阻塞账务终态；下次对同一成功任务查询时仍会再次
      // 触发补写，且 taskId 去重保证不会产生重复记录。
      this.logger.warn(
        `Seedance 成功视频写入全局历史失败 apiUsageId=${usage.id}, taskId=${taskId}: ${this.message(error)}`,
      );
    }
  }

  private isSuccessStatus(status: string): boolean {
    return status === 'success' || status === 'succeeded' || status === 'completed';
  }

  private isFailureStatus(status: string): boolean {
    return (
      status === 'failed' ||
      status === 'failure' ||
      status === 'error' ||
      status === 'cancelled' ||
      status === 'canceled'
    );
  }

  private readTaskId(value: Prisma.JsonValue | null): string | null {
    const object = this.asJsonObject(value);
    const taskId = this.readString(object?.taskId);
    return taskId || null;
  }

  private asJsonObject(value: Prisma.JsonValue | null): Record<string, any> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, any>)
      : null;
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private readFiniteNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
