import { Injectable, BadRequestException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';
import { ApiResponseStatus } from '../credits/dto/credits.dto';
import type { ServiceType } from '../credits/credits.config';
import { TeamCreditLedgerService } from './team-credit-ledger.service';

export interface ChargeBeginInput {
  userId: string;
  /** 原始 x-team-id 请求头；由本服务判定是否为团队出资（非个人团队）。 */
  teamId?: string | null;
  serviceType: ServiceType;
  model?: string;
  inputImageCount?: number;
  outputImageCount?: number;
  requestParams?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  idempotencyKey?: string;
}

export interface ChargeHandle {
  apiUsageId: string;
  /** 预扣/预留的固定积分额。 */
  amount: number;
  userId: string;
  serviceType: ServiceType;
  /** true=团队出资（不动个人积分，扣团队）；false=个人出资。 */
  teamFunded: boolean;
  teamId?: string;
  duplicate: boolean;
  duplicateReason?: 'idempotency' | 'fingerprint' | 'active-node';
}

/**
 * 统一的「一次 AI 操作计费」抽象层。
 *
 * 把原先散落在 6+ 处（withCredits / withCreditsFromGateway / 视频 provider /
 * 画质增强 / video-task-success·refund / 异步图片 worker / video-gif）各写一遍的
 * 团队 vs 个人判定、skipPersonalDeduction、reserve/deduct/release 生命周期收敛到这里。
 *
 * 关键不变量：
 *  - 团队出资时**不动个人积分**，只走团队账本；
 *  - 团队出资的 apiUsageRecord 始终在 requestParams 打上 `teamId` 标记
 *    （个人「积分使用记录」据此过滤，异步结算据此反查团队上下文）。
 */
@Injectable()
export class CreditChargeService {
  private readonly logger = new Logger(CreditChargeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
    @Optional() private readonly ledger?: TeamCreditLedgerService,
  ) {}

  /** 判定原始 teamId 是否为团队出资（存在、有账本、且非个人团队）。 */
  async resolveTeamFunding(
    teamId?: string | null,
  ): Promise<{ funded: boolean; teamId?: string }> {
    const id = typeof teamId === 'string' && teamId.trim().length > 0 ? teamId.trim() : undefined;
    if (!id || !this.ledger) return { funded: false };
    const team = await this.prisma.team.findUnique({
      where: { id },
      select: { isPersonal: true },
    });
    return team && team.isPersonal === false ? { funded: true, teamId: id } : { funded: false };
  }

  /**
   * 开始计费：预扣（团队模式跳过个人积分，仅落用量记录）+ 团队模式打 teamId 标记 + 预留团队积分。
   * 团队积分不足时把刚建的用量记录标失败并抛 BadRequestException。
   */
  async begin(input: ChargeBeginInput): Promise<ChargeHandle> {
    const { funded, teamId } = await this.resolveTeamFunding(input.teamId);
    // 团队出资：teamId 落 requestParams（唯一标记来源）。
    const requestParams = funded
      ? { ...(input.requestParams || {}), teamId }
      : input.requestParams;

    const deduct = await this.credits.preDeductCredits({
      userId: input.userId,
      serviceType: input.serviceType,
      model: input.model,
      inputImageCount: input.inputImageCount,
      outputImageCount: input.outputImageCount,
      requestParams,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      idempotencyKey: input.idempotencyKey,
      skipPersonalDeduction: funded,
    });

    const handle: ChargeHandle = {
      apiUsageId: deduct.apiUsageId,
      amount: deduct.creditsToDeduct,
      userId: input.userId,
      serviceType: input.serviceType,
      teamFunded: funded,
      teamId: funded ? teamId : undefined,
      duplicate: deduct.duplicate,
      duplicateReason: deduct.duplicateReason,
    };

    if (funded && teamId && !deduct.duplicate) {
      const reserved = await this.ledger!.reserve({
        teamId,
        amount: handle.amount,
        taskId: handle.apiUsageId,
        taskKind: input.serviceType,
        actorUserId: input.userId,
      });
      if (!reserved.reserved) {
        // 预留失败：标记刚建的用量记录失败，避免悬空 PENDING。
        await this.credits
          .updateApiUsageStatus(
            handle.apiUsageId,
            ApiResponseStatus.FAILED,
            reserved.reason ?? '团队积分不足',
            0,
          )
          .catch((e) => this.logger.warn(`标记团队预留失败状态出错: ${this.msg(e)}`));
        throw new BadRequestException(reserved.reason ?? '团队积分不足');
      }
    }

    return handle;
  }

  /**
   * 成功结算：标记用量记录成功（可选）+ 团队模式确认扣除团队积分。
   * 个人模式的余额已在 begin 时扣除，这里只标成功。
   */
  async commit(
    handle: ChargeHandle,
    opts: { processingTime?: number; markSuccess?: boolean } = {},
  ): Promise<void> {
    if (opts.markSuccess !== false) {
      await this.credits
        .updateApiUsageStatus(
          handle.apiUsageId,
          ApiResponseStatus.SUCCESS,
          undefined,
          opts.processingTime ?? 0,
        )
        .catch((e) => this.logger.warn(`标记成功状态出错: ${this.msg(e)}`));
    }
    if (handle.teamFunded && handle.teamId) {
      await this.ledger!
        .deduct({
          teamId: handle.teamId,
          amount: handle.amount,
          taskId: handle.apiUsageId,
          taskKind: handle.serviceType,
          actorUserId: handle.userId,
        })
        .catch((e) => this.logger.warn(`团队积分确认扣除失败: ${this.msg(e)}`));
    }
  }

  /**
   * 失败结算：
   *  - 团队模式：标记失败 + 释放团队预留（无个人积分需退还）；
   *  - 个人模式：优先用调用方提供的 personalRefund（保留各自的重试逻辑），否则标记失败 + refundCredits。
   */
  async rollback(
    handle: ChargeHandle,
    opts: {
      errorMessage: string;
      processingTime?: number;
      personalRefund?: () => Promise<void>;
    },
  ): Promise<void> {
    if (handle.teamFunded && handle.teamId) {
      await this.credits
        .updateApiUsageStatus(
          handle.apiUsageId,
          ApiResponseStatus.FAILED,
          opts.errorMessage,
          opts.processingTime ?? 0,
        )
        .catch((e) => this.logger.warn(`团队模式标记失败状态出错: ${this.msg(e)}`));
      await this.ledger!
        .release({ teamId: handle.teamId, amount: handle.amount, taskId: handle.apiUsageId })
        .catch((e) => this.logger.warn(`团队积分释放失败: ${this.msg(e)}`));
      return;
    }

    if (opts.personalRefund) {
      await opts.personalRefund();
      return;
    }

    await this.credits
      .updateApiUsageStatus(
        handle.apiUsageId,
        ApiResponseStatus.FAILED,
        opts.errorMessage,
        opts.processingTime ?? 0,
      )
      .catch((e) => this.logger.warn(`个人模式标记失败状态出错: ${this.msg(e)}`));
    await this.credits
      .refundCredits(handle.userId, handle.apiUsageId)
      .catch((e) => this.logger.warn(`个人积分退款失败: ${this.msg(e)}`));
  }

  /**
   * 从 apiUsageId 反查计费句柄（异步任务结算用）：读 requestParams.teamId。
   * 非团队记录返回 null，调用方沿用个人结算逻辑。
   */
  async resolveHandle(apiUsageId: string): Promise<ChargeHandle | null> {
    const rec = await this.prisma.apiUsageRecord.findUnique({
      where: { id: apiUsageId },
      select: { userId: true, creditsUsed: true, serviceType: true, requestParams: true },
    });
    if (!rec) return null;
    const params =
      rec.requestParams && typeof rec.requestParams === 'object' && !Array.isArray(rec.requestParams)
        ? (rec.requestParams as Record<string, any>)
        : null;
    const teamId =
      params && typeof params.teamId === 'string' && params.teamId.trim().length > 0
        ? params.teamId.trim()
        : undefined;
    if (!teamId) return null;
    const { funded } = await this.resolveTeamFunding(teamId);
    if (!funded) return null;
    return {
      apiUsageId,
      amount: rec.creditsUsed,
      userId: rec.userId,
      serviceType: rec.serviceType as ServiceType,
      teamFunded: true,
      teamId,
      duplicate: false,
    };
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
