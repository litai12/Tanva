import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { CreditsService } from '../../credits/credits.service';
import { ApiResponseStatus } from '../../credits/dto/credits.dto';
import { ServiceType } from '../../credits/credits.config';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamCreditLedgerService } from '../../team-credits/team-credit-ledger.service';
import { DEFAULT_TEXT_MODEL, resolveLegacyTextModel } from '../text-models';
import {
  calculateDeepSeekUsage, createDeepSeekPricingSnapshot, estimateDeepSeekReservation,
  DeepSeekPricingSnapshot,
} from '../../desktop-chat/deepseek-pricing';

export const isDeepSeekChatModel = (model?: string): boolean =>
  resolveLegacyTextModel(model) === DEFAULT_TEXT_MODEL;

export interface DeepSeekChatCharge {
  apiUsageId: string;
  userId: string;
  teamId: string | null;
  snapshot: DeepSeekPricingSnapshot;
  reservedCredits: number;
  duplicate: boolean;
  response?: unknown;
  knownUsage?: unknown;
  needsSettlement?: boolean;
}

/** One receipt and one rounded charge per accepted physical model request. */
@Injectable()
export class DeepSeekChatBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
    private readonly ledger: TeamCreditLedgerService,
  ) {}

  async begin(input: {
    userId: string; teamId?: string | null; model: string; serviceType: ServiceType;
    serviceName: string; requestBody: Record<string, unknown>; identity?: string;
  }): Promise<DeepSeekChatCharge> {
    if (!isDeepSeekChatModel(input.model)) throw new ForbiddenException('此模型未纳入DeepSeek Flash计价合同');
    const identity = input.identity || randomUUID();
    const apiUsageId = `deepseek-chat:${createHash('sha256').update(`${input.userId}:${identity}`).digest('hex')}`;
    const bodyHash = createHash('sha256').update(JSON.stringify({ requestBody: input.requestBody,
      teamId: input.teamId || null, model: input.model, serviceType: input.serviceType,
      serviceName: input.serviceName })).digest('hex');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${apiUsageId}, 0))`;
      const prior = await tx.apiUsageRecord.findUnique({ where: { id: apiUsageId } });
      if (prior) {
        const billing = (prior.requestParams as any)?.deepseekBilling;
        if (prior.userId !== input.userId || billing?.bodyHash !== bodyHash) {
          throw new ConflictException({ code: 'DEEPSEEK_IDEMPOTENCY_CONFLICT', apiUsageId });
        }
        if (billing.state !== 'completed' && billing.response === undefined) {
          throw new ConflictException({ code: 'DEEPSEEK_REQUEST_ACCEPTED', apiUsageId, state: billing.state });
        }
        return { apiUsageId, userId: input.userId, teamId: (prior.requestParams as any)?.teamId || null,
          snapshot: billing.snapshot, reservedCredits: billing.reservation.creditsReserved,
          duplicate: true, response: billing.response, knownUsage: billing.usage,
          needsSettlement: billing.state !== 'completed' };
      }
      // Replays use their original quote even if today's calendar cannot quote a new request.
      const snapshot = createDeepSeekPricingSnapshot(new Date());
      const reservation = estimateDeepSeekReservation(snapshot, input.requestBody);
      let teamId: string | null = null;
      if (input.teamId) {
        const team = await tx.team.findUnique({ where: { id: input.teamId }, select: { isPersonal: true, status: true } });
        const member = await tx.teamMembership.findUnique({
          where: { teamId_userId: { teamId: input.teamId, userId: input.userId } }, select: { userId: true },
        });
        if (!team || team.status !== 'active' || !member) throw new ForbiddenException('当前账号无权使用此团队积分');
        if (team.isPersonal === false) teamId = input.teamId;
      }
      await this.credits.deductExact(input.userId, teamId, reservation.creditsReserved, {
        apiUsageId, serviceType: input.serviceType, serviceName: input.serviceName,
        provider: 'new-api', model: input.model, responseStatus: ApiResponseStatus.PENDING,
        requestParams: { deepseekBilling: { state: 'pending', bodyHash, snapshot, reservation },
          ...(teamId ? { teamId } : {}) },
      }, tx);
      if (teamId) {
        const reserved = await this.ledger.reserve({ teamId, amount: reservation.creditsReserved,
          taskId: apiUsageId, taskKind: input.serviceType, actorUserId: input.userId }, tx);
        if (!reserved.reserved) throw new ForbiddenException(reserved.reason || '团队积分预留失败');
      }
      return { apiUsageId, userId: input.userId, teamId, snapshot,
        reservedCredits: reservation.creditsReserved, duplicate: false };
    }, { timeout: 30_000 });
  }

  async complete(charge: DeepSeekChatCharge, usage: unknown, response?: unknown): Promise<void> {
    const calculation = calculateDeepSeekUsage(charge.snapshot, usage);
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${charge.apiUsageId}, 0))`;
      const row = await tx.apiUsageRecord.findUniqueOrThrow({ where: { id: charge.apiUsageId } });
      const billing = (row.requestParams as any)?.deepseekBilling;
      if (billing?.state === 'completed') return;
      if (billing?.state === 'failed') throw new ConflictException('已确认失败的请求不能自动重新结算');
      const settlement = charge.teamId
        ? await this.ledger.settleDesktopChatUsage({ teamId: charge.teamId, taskId: charge.apiUsageId,
          actorUserId: charge.userId, exactCreditNanos: calculation.exactCreditNanos }, tx)
        : await this.credits.settleDesktopChatUsage(charge.userId, charge.apiUsageId, calculation.exactCreditNanos, tx);
      await tx.apiUsageRecord.update({ where: { id: charge.apiUsageId }, data: {
        responseStatus: ApiResponseStatus.SUCCESS, creditsUsed: settlement.creditsCharged,
        inputTokens: calculation.usage.inputTokens, outputTokens: calculation.usage.outputTokens,
        requestParams: { ...(row.requestParams as any), deepseekBilling: { ...billing, state: 'completed',
          calculation, settlement, ...(response === undefined ? {} : { response }), completedAt: new Date().toISOString() } },
      } });
    }, { timeout: 30_000 });
  }

  async uncertain(charge: DeepSeekChatCharge, usage?: unknown, response?: unknown): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${charge.apiUsageId}, 0))`;
      const row = await tx.apiUsageRecord.findUniqueOrThrow({ where: { id: charge.apiUsageId } });
      const billing = (row.requestParams as any)?.deepseekBilling;
      if (billing?.state === 'completed' || billing?.state === 'failed') return;
      await tx.apiUsageRecord.update({ where: { id: charge.apiUsageId }, data: {
        responseStatus: ApiResponseStatus.PENDING,
        requestParams: { ...(row.requestParams as any), deepseekBilling: { ...billing,
          state: 'reconciliation_required', ...(usage === undefined ? {} : { usage }),
          ...(response === undefined ? {} : { response }) } },
      } });
    });
  }

  async rejected(charge: DeepSeekChatCharge): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${charge.apiUsageId}, 0))`;
      const row = await tx.apiUsageRecord.findUniqueOrThrow({ where: { id: charge.apiUsageId } });
      const billing = (row.requestParams as any)?.deepseekBilling;
      if (billing?.state === 'completed' || billing?.state === 'failed') return;
      await tx.apiUsageRecord.update({ where: { id: charge.apiUsageId }, data: {
        responseStatus: ApiResponseStatus.FAILED,
        requestParams: { ...(row.requestParams as any), deepseekBilling: { ...billing, state: 'failed' } },
      } });
      if (charge.teamId) await this.ledger.release({ teamId: charge.teamId,
        amount: charge.reservedCredits, taskId: charge.apiUsageId }, tx);
      else await this.credits.refundCredits(charge.userId, charge.apiUsageId, tx);
    });
  }

  async execute<T>(input: Parameters<DeepSeekChatBillingService['begin']>[0],
    operation: () => Promise<T>, extractUsage: (result: T) => unknown): Promise<T> {
    const charge = await this.begin(input);
    if (charge.duplicate) {
      const rejection = charge.response as { rejectionConfirmed?: boolean; message?: string } | undefined;
      if (rejection?.rejectionConfirmed === true) {
        try { await this.rejected(charge); }
        catch {
          throw new ConflictException({ code: 'DEEPSEEK_REJECTION_RECONCILIATION_REQUIRED', apiUsageId: charge.apiUsageId });
        }
        throw new Error(rejection.message || 'new-api 已明确拒绝此请求');
      }
      if (charge.needsSettlement) {
        try { await this.complete(charge, extractUsage(charge.response as T), charge.response); }
        catch {
          throw new ConflictException({ code: 'DEEPSEEK_RECONCILIATION_REQUIRED', apiUsageId: charge.apiUsageId });
        }
      }
      return charge.response as T;
    }
    let response: T | undefined;
    let usage: unknown;
    try {
      response = await operation();
      usage = extractUsage(response);
      await this.complete(charge, usage, response);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if ((response === undefined || (response as any)?.success === false)
          && /new-api HTTP (400|401|402|403|404|405|413|415|422|429):/.test(message)) {
        try { await this.rejected(charge); }
        catch {
          await this.uncertain(charge, undefined, { rejectionConfirmed: true, message });
          throw new ConflictException({ code: 'DEEPSEEK_REJECTION_RECONCILIATION_REQUIRED', apiUsageId: charge.apiUsageId });
        }
        throw error;
      }
      await this.uncertain(charge, usage, response);
      throw new ConflictException({ code: 'DEEPSEEK_RECONCILIATION_REQUIRED', apiUsageId: charge.apiUsageId,
        message: '请求已受理，费用或结果待核实；原记录保留，未自动重新提交' });
    }
  }
}
