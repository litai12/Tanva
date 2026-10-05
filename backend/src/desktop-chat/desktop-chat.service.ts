import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ApiUsageRecord } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';
import { ApiResponseStatus } from '../credits/dto/credits.dto';
import { TeamCreditsPublisher } from '../team-collab/team-credits-publisher.service';
import { TeamCreditLedgerService } from '../team-credits/team-credit-ledger.service';
import { DESKTOP_CHAT_MODEL, DesktopChatMeta, DesktopScope, REQUEST_TIMEOUT_MS, canonicalJson, chatDiagnostic, failedChatHttpStatus, hash, identifier, receipt, upstreamDiagnostic, usageId, validateCompletion } from './desktop-chat.protocol';
import { createDeepSeekPricingSnapshot, calculateDeepSeekUsage, estimateDeepSeekReservation } from './deepseek-pricing';
import { GatewayConsumptionOrdersService } from '../consumption-orders/gateway-consumption-orders.service';

/** One durable ApiUsageRecord primary key per user/request. Admission, receipt,
 * and wallet change share a transaction. Unknown accepted work is never resent. */
@Injectable()
export class DesktopChatService {
  private fetchImpl: typeof fetch = fetch;
  private modelCache?: { expires: number; available: boolean };
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService,
    private readonly credits: CreditsService, private readonly ledger: TeamCreditLedgerService, @Optional() private readonly publisher?: TeamCreditsPublisher,
    @Optional() private readonly consumptionOrders?: GatewayConsumptionOrdersService) {}
  private gateway() {
    const base = (this.config.get<string>('NEW_API_BASE_URL') || 'http://localhost:4458').replace(/\/+$/, '').replace(/\/v1$/, '');
    const key = this.config.get<string>('NEW_API_KEY') || this.config.get<string>('NEW_API_TOKEN') || '';
    return { base, key };
  }
  private async scope(userId: string, rawTeamId: unknown, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<DesktopScope> {
    if (rawTeamId === undefined || rawTeamId === '') return { kind: 'personal' };
    const teamId = identifier(rawTeamId, 'X-Tanva-Team-Id');
    const team = await db.team.findUnique({ where: { id: teamId }, select: { isPersonal: true, status: true } });
    const member = await db.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId } }, select: { userId: true } });
    if (!team || team.isPersonal || team.status !== 'active' || !member) throw new ForbiddenException('当前账号无权使用此团队积分');
    return { kind: 'team', teamId };
  }
  async billing(userId: string, teamId?: unknown) {
    const scope = await this.scope(userId, teamId);
    const personal = await this.credits.getAccountDetails(userId);
    const memberships = await this.prisma.teamMembership.findMany({ where: { userId }, include: { team: { include: { creditAccount: true } } } });
    const wallets = [{ id: 'personal', kind: 'personal', name: '个人积分', balance: personal.balance,
      availableCredits: personal.balance, frozenCredits: 0, canCharge: true }, ...memberships
      .filter(m => !m.team.isPersonal && m.team.status === 'active').map(m => {
        const account = m.team.creditAccount;
        const used = Date.now() - m.quotaCycleStartAt.getTime() >= 30 * 86400_000 ? 0 : m.creditUsedThisCycle;
        const available = account ? Math.max(0, account.balance - account.frozenBalance) : 0;
        const quota = Math.max(0, Math.min(available,
          m.creditQuotaMonthly == null ? available : m.creditQuotaMonthly - used,
          m.creditQuotaTotal == null ? available : m.creditQuotaTotal - m.creditUsedTotal));
        return { id: m.teamId, teamId: m.teamId, kind: 'team', name: m.team.name,
          balance: account?.balance ?? 0, availableCredits: quota, frozenCredits: account?.frozenBalance ?? 0,
          canCharge: !!account, ...(!account ? { unavailableReason: '团队积分账户未建立' } : {}) };
      })];
    const selected = wallets.find(wallet => wallet.id === (scope.kind === 'team' ? scope.teamId : 'personal'));
    if (!selected) throw new ForbiddenException('当前积分账户不可用');
    return { scope, balance: selected.balance, availableCredits: selected.availableCredits,
      frozenCredits: selected.frozenCredits, unit: 'credits', canCharge: selected.canCharge, wallets };
  }
  private async modelAvailable() {
    const { base, key } = this.gateway();
    if (!key) return false;
    if (this.modelCache && this.modelCache.expires > Date.now()) return this.modelCache.available;
    let available = false;
    try {
      const signal = AbortSignal.timeout(10_000);
      const res = await this.fetchImpl(`${base}/v1/models`, { headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal });
      if (res.ok) { const json: any = await readBoundedJson(res, 2 * 1024 * 1024, signal); available = Array.isArray(json.data) && json.data.some((model: any) => model.id === DESKTOP_CHAT_MODEL); }
    } catch { /* Never expose credential-bearing network errors. */ }
    this.modelCache = { available, expires: Date.now() + 10_000 };
    return available;
  }
  async models(userId: string, teamId?: unknown) {
    await this.scope(userId, teamId);
    const available = await this.modelAvailable();
    let snapshot: ReturnType<typeof createDeepSeekPricingSnapshot>;
    try { snapshot = createDeepSeekPricingSnapshot(new Date()); }
    catch { throw new ServiceUnavailableException('官方用量报价不可用，请更新节假日日历'); }
    // new-api 2026-09-16 official-v41-flash catalog declares vision/tool_calls.
    return { models: [{ id: DESKTOP_CHAT_MODEL, name: 'DeepSeek V4.1 Flash', available,
      supportsTools: true, supportsVision: true, reasoningEfforts: [], streaming: false,
      ...(!available ? { unavailableReason: 'Tanva模型网关未配置或未提供此模型' } : {}),
      pricing: { unit: 'token', currency: 'credits', priceCurrency: 'CNY', rounding: 'ceil', markup: snapshot.markup,
        ...(this.consumptionOrders?.isEnabled() ? { settlementSource: 'new_api_consumption' } : {}),
        creditsPerYuan: snapshot.creditsPerYuan, period: snapshot.period, pricingVersion: snapshot.version,
        inputCnyPerMillion: snapshot.pricesCnyPerMillion.cacheMiss,
        cachedInputCnyPerMillion: snapshot.pricesCnyPerMillion.cacheHit,
        outputCnyPerMillion: snapshot.pricesCnyPerMillion.output,
        sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/' } }] };
  }
  private async row(userId: string, id: string) {
    const row = await this.prisma.apiUsageRecord.findUnique({ where: { id: usageId(userId, identifier(id, 'requestId')) } });
    if (!row || row.userId !== userId || !(row.requestParams as any)?.desktopChat) throw new NotFoundException('对话计费回执不存在');
    return row;
  }
  async request(userId: string, id: string) { return receipt(await this.recover(await this.row(userId, id)), true); }
  private async recover(row: ApiUsageRecord): Promise<ApiUsageRecord> {
    const meta = (row.requestParams as any).desktopChat as DesktopChatMeta;
    if (row.consumptionStatus) {
      // A missing model body cannot prevent settlement of an accepted gateway
      // consumption. Query only the original order; never POST the model again.
      await this.consumptionOrders?.reconcile(row.id).catch(() => undefined);
      return this.row(row.userId, meta.requestId);
    }
    if (meta.state === 'reconciliation_required' && (validResponse(meta.response) || meta.rejectionConfirmed)) {
      await this.finish(row.userId, row.id, meta, meta.response, !!meta.rejectionConfirmed).catch(() => undefined);
      return this.row(row.userId, meta.requestId);
    }
    return row;
  }
  async listReceipts(userId: string, taskId?: string, conversationId?: string) {
    if (taskId !== undefined) identifier(taskId, 'taskId');
    if (conversationId !== undefined) identifier(conversationId, 'conversationId');
    const rows = await this.prisma.apiUsageRecord.findMany({ where: { userId, id: { startsWith: 'desktop-chat:' }, AND: [
      ...(taskId ? [{ requestParams: { path: ['desktopChat', 'taskId'], equals: taskId } }] : []),
      ...(conversationId ? [{ requestParams: { path: ['desktopChat', 'conversationId'], equals: conversationId } }] : []),
    ] }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { receipts: rows.filter(row => (row.requestParams as any)?.desktopChat).map(row => receipt(row)) };
  }
  private replay(row: ApiUsageRecord) {
    const result = receipt(row, true);
    if (result.status === 'completed') return { ...result.response, tanvaReceipt: receipt(row) };
    this.throwReceiptError(result);
  }
  private throwReceiptError(result: ReturnType<typeof receipt>): never {
    const failed = result.status === 'failed';
    throw new HttpException({ code: failed ? 'TANVA_REQUEST_FAILED' : 'TANVA_REQUEST_PENDING',
      message: result.errorMessage || chatDiagnostic(failed ? 'UPSTREAM_REJECTED' : 'UPSTREAM_OUTCOME_UNKNOWN').errorMessage,
      receipt: result }, failed ? failedChatHttpStatus(result) : 409);
  }
  async complete(userId: string, rawBody: any, headers: Record<string, any>) {
    const body = validateCompletion(rawBody);
    const requestId = identifier(headers['idempotency-key'], 'Idempotency-Key');
    const taskId = identifier(headers['x-tanva-task-id'], 'X-Tanva-Task-Id');
    const conversationId = identifier(headers['x-tanva-conversation-id'], 'X-Tanva-Conversation-Id');
    const scope: DesktopScope = headers['x-tanva-team-id'] ? { kind: 'team', teamId: identifier(headers['x-tanva-team-id'], 'X-Tanva-Team-Id') } : { kind: 'personal' };
    const bodyHash = hash(canonicalJson({ body, scope, taskId, conversationId }));
    const id = usageId(userId, requestId);
    const check = (row: ApiUsageRecord) => {
      if ((row.requestParams as any)?.desktopChat?.bodyHash !== bodyHash) throw new ConflictException({ code: 'TANVA_IDEMPOTENCY_CONFLICT' });
    };
    const existing = await this.prisma.apiUsageRecord.findUnique({ where: { id } });
    if (existing) { check(existing); return this.replay(await this.recover(existing)); }
    if (!await this.modelAvailable()) throw new ServiceUnavailableException('Tanva模型网关未提供此模型');
    let snapshot: ReturnType<typeof createDeepSeekPricingSnapshot>;
    let estimate: ReturnType<typeof estimateDeepSeekReservation>;
    try { snapshot = createDeepSeekPricingSnapshot(new Date()); estimate = estimateDeepSeekReservation(snapshot, body); }
    catch { throw new ServiceUnavailableException('官方用量报价不可用，请检查模型参数与节假日日历'); }
    const reservedCredits = estimate.creditsReserved;
    const meta: DesktopChatMeta = { requestId, taskId, conversationId, bodyHash, scope,
      state: 'pending', credits: reservedCredits, deadline: new Date(Date.now() + REQUEST_TIMEOUT_MS).toISOString(),
      billing: { mode: 'official_token_usage', snapshot, markup: snapshot.markup, creditsPerYuan: snapshot.creditsPerYuan,
        priceCurrency: 'CNY', rounding: 'ceil', period: snapshot.period, pricingVersion: snapshot.version,
        reservation: { inputTokens: estimate.inputTokenBudget, outputTokens: estimate.outputTokenBudget, credits: reservedCredits } } };
    const admission = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
      const row = await tx.apiUsageRecord.findUnique({ where: { id } });
      if (row) { check(row); return { row, duplicate: true }; }
      await this.scope(userId, headers['x-tanva-team-id'], tx);
      await this.credits.deductExact(userId, scope.kind === 'team' ? scope.teamId : null, reservedCredits, {
        apiUsageId: id, serviceType: 'gemini-text', serviceName: 'Tanva桌面对话', provider: 'new-api', model: body.model,
        responseStatus: ApiResponseStatus.PENDING, requestParams: { desktopChat: meta, ...(scope.kind === 'team' ? { teamId: scope.teamId } : {}) },
      }, tx);
      if (scope.kind === 'team') {
        const reserved = await this.ledger.reserve({ teamId: scope.teamId, amount: reservedCredits, taskId: id, taskKind: 'gemini-text', actorUserId: userId }, tx);
        if (!reserved.reserved) throw new ForbiddenException(reserved.reason || '团队积分预留失败');
      }
      await this.consumptionOrders?.register(id, tx);
      return { row: (await tx.apiUsageRecord.findUnique({ where: { id } }))!, duplicate: false };
    }, { timeout: 30_000 });
    if (admission.duplicate) return this.replay(await this.recover(admission.row));
    this.notify(meta, userId, id, 'reserve');
    const { base, key } = this.gateway();
    let result: Record<string, any> | undefined;
    let confirmedRejected = false;
    try {
      // Client disconnect does not abort accepted server work. No provider retry.
      const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const rawBody = JSON.stringify(body);
      const orderHeaders = await this.consumptionOrders?.gatewayHeaders(id, { method: 'POST', path: '/v1/chat/completions', rawBody }) ?? {};
      const response = await this.fetchImpl(`${base}/v1/chat/completions`, { method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': id, ...orderHeaders },
        body: rawBody, signal });
      const upstreamId = response.headers.get('x-oneapi-request-id');
      if (meta.billing && upstreamId && /^[A-Za-z0-9_.:-]{1,128}$/.test(upstreamId)) {
        meta.billing.upstreamRequestId = upstreamId;
        // Retain gateway correlation even if its JSON is invalid or unreadable.
        if (!admission.row.consumptionStatus) await this.prisma.apiUsageRecord.update({ where: { id }, data: { requestParams: {
          desktopChat: meta, ...(scope.kind === 'team' ? { teamId: scope.teamId } : {}) } as any } });
      }
      if (!response.ok) {
        confirmedRejected = [400, 401, 402, 403, 404, 405, 413, 415, 422, 429].includes(response.status);
        let diagnosticBody: unknown;
        try { diagnosticBody = await readBoundedJson(response, 16 * 1024, AbortSignal.timeout(2_000)); } catch { /* Retain safe status even for invalid/oversized error bodies. */ }
        Object.assign(meta, upstreamDiagnostic(response.status, diagnosticBody));
        throw new Error('UPSTREAM_REJECTED');
      }
      if ((response.headers.get('content-type') || '').includes('text/event-stream')) throw new Error('UPSTREAM_TRANSPORT_MISMATCH');
      const json: any = await readBoundedJson(response, 8 * 1024 * 1024, signal);
      if (!validResponse(json)) throw new Error('UPSTREAM_INVALID_RESPONSE');
      result = json;
      await this.finish(userId, id, meta, result, false);
      return { ...result, tanvaReceipt: receipt(await this.row(userId, requestId)) };
    } catch (error) {
      const rejected = confirmedRejected && !result;
      if (!meta.errorCode) {
        const code = result ? 'LOCAL_SETTLEMENT_PENDING'
          : error instanceof Error && ['UPSTREAM_TRANSPORT_MISMATCH', 'UPSTREAM_INVALID_RESPONSE', 'UPSTREAM_EMPTY_RESPONSE'].includes(error.message)
            ? error.message === 'UPSTREAM_EMPTY_RESPONSE' ? 'UPSTREAM_INVALID_RESPONSE' : error.message
            : error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_TRANSPORT_FAILED';
        Object.assign(meta, chatDiagnostic(code));
      }
      await this.finish(userId, id, meta, undefined, rejected, result).catch(async () => {
        if (rejected) await this.finish(userId, id, meta, undefined, false, undefined, true).catch(() => undefined);
      });
      const persisted = receipt(await this.row(userId, requestId));
      this.throwReceiptError(persisted);
    }
  }
  private async finish(userId: string, id: string, original: DesktopChatMeta, response: Record<string, any> | undefined, rejected: boolean, knownResponse?: Record<string, any>, knownRejected = false) {
    const changed = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
      const row = await tx.apiUsageRecord.findUniqueOrThrow({ where: { id } });
      const prior = (row.requestParams as any).desktopChat as DesktopChatMeta;
      if (prior.state === 'completed' || prior.state === 'failed') return false;
      if (row.consumptionStatus) {
        // Model delivery and consumption are independent. Only a verified
        // gateway receipt may charge/refund a registered consumption order.
        const delivered = response ?? knownResponse;
        const meta: DesktopChatMeta = { ...prior,
          state: delivered ? 'completed' : rejected ? 'failed' : 'reconciliation_required',
          ...(delivered ? { response: delivered, completedAt: new Date().toISOString() } : {
            ...chatDiagnostic(original.errorCode || (rejected ? 'UPSTREAM_REJECTED' : 'UPSTREAM_OUTCOME_UNKNOWN'), original.upstreamStatus) }),
          ...(original.billing?.upstreamRequestId && prior.billing ? {
            billing: { ...prior.billing, upstreamRequestId: original.billing.upstreamRequestId } } : {}) };
        if (delivered) { delete meta.errorCode; delete meta.errorMessage; delete meta.upstreamStatus; delete meta.rejectionConfirmed; }
        await tx.apiUsageRecord.update({ where: { id }, data: {
          requestParams: { ...(row.requestParams as any), desktopChat: meta },
          // A consumed order can still have a failed/missing model response.
          responseStatus: delivered ? ApiResponseStatus.SUCCESS : rejected ? ApiResponseStatus.FAILED : ApiResponseStatus.PENDING,
          ...(delivered ? { inputTokens: safeTokens(delivered.usage?.prompt_tokens ?? delivered.usage?.input_tokens),
            outputTokens: safeTokens(delivered.usage?.completion_tokens ?? delivered.usage?.output_tokens) } : {}),
        } });
        return { gatewayOrder: true as const };
      }
      const state = response ? 'completed' : rejected ? 'failed' : 'reconciliation_required';
      const meta: DesktopChatMeta = { ...prior, state, ...(original.billing?.upstreamRequestId && prior.billing ? {
        billing: { ...prior.billing, upstreamRequestId: original.billing.upstreamRequestId } } : {}),
        ...(knownRejected ? { rejectionConfirmed: true } : {}), ...(knownResponse ? { response: knownResponse } : {}), ...(response ? { response, completedAt: new Date().toISOString() } : chatDiagnostic(original.errorCode || (rejected ? 'UPSTREAM_REJECTED' : 'UPSTREAM_OUTCOME_UNKNOWN'), original.upstreamStatus)) };
      if (response) { delete meta.errorCode; delete meta.errorMessage; delete meta.upstreamStatus; delete meta.rejectionConfirmed; }
      if (response && meta.billing) {
        const calculation = calculateDeepSeekUsage(meta.billing.snapshot, response.usage);
        const settled = original.scope.kind === 'team'
          ? await this.ledger.settleDesktopChatUsage({ teamId: original.scope.teamId, taskId: id, actorUserId: userId, exactCreditNanos: calculation.exactCreditNanos }, tx)
          : await this.credits.settleDesktopChatUsage(userId, id, calculation.exactCreditNanos, tx);
        meta.credits = settled.creditsCharged;
        meta.billing = { ...meta.billing, officialCostCny: calculation.officialCostCnyDecimal,
          exactCredits: calculation.exactCreditsDecimal, exactCreditNanos: calculation.exactCreditNanos,
          usage: { inputTokens: calculation.usage.inputTokens, cachedInputTokens: calculation.usage.cacheHitTokens, outputTokens: calculation.usage.outputTokens } };
      } else if (response && original.scope.kind === 'team') {
        const committed = await this.ledger.deduct({ teamId: original.scope.teamId, amount: original.credits, taskId: id, taskKind: 'gemini-text', actorUserId: userId }, tx);
        if (!committed.deducted) throw new Error('TEAM_SETTLEMENT_FAILED');
      }
      await tx.apiUsageRecord.update({ where: { id }, data: {
        responseStatus: response ? ApiResponseStatus.SUCCESS : rejected ? ApiResponseStatus.FAILED : ApiResponseStatus.PENDING,
        requestParams: { ...(row.requestParams as any), desktopChat: meta },
        ...(response && meta.billing ? { creditsUsed: meta.credits } : {}),
        ...(response ? { inputTokens: safeTokens(meta.billing?.usage?.inputTokens ?? response.usage?.prompt_tokens),
          outputTokens: safeTokens(meta.billing?.usage?.outputTokens ?? response.usage?.completion_tokens) } : {}),
      } });
      if (rejected) {
        if (original.scope.kind === 'team') await this.ledger.release({ teamId: original.scope.teamId, amount: original.credits, taskId: id }, tx);
        else await this.credits.refundCredits(userId, id, tx);
      }
      return meta;
    }, { timeout: 30_000 });
    if (changed && 'gatewayOrder' in changed) {
      // Durable polling also runs after a restart; the response path only
      // accelerates it and never makes delivery depend on callback timing.
      void this.consumptionOrders?.reconcile(id).catch(() => undefined);
    } else if (changed && (response || rejected)) this.notify(changed, userId, id, response ? 'deduct' : 'release');
  }
  private notify(meta: DesktopChatMeta, userId: string, id: string, reason: 'reserve' | 'deduct' | 'release') {
    if (meta.scope.kind === 'team') void this.publisher?.publish({ teamId: meta.scope.teamId, reason,
      delta: reason === 'reserve' ? -meta.credits : reason === 'release' ? meta.credits : meta.billing ? meta.billing.reservation.credits - meta.credits : 0, actorUserId: userId, taskId: id }).catch(() => undefined);
  }
}
function safeTokens(value: unknown): number | undefined { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647 ? value : undefined; }

export function validResponse(json: any): json is Record<string, any> {
  return !json?.error && Array.isArray(json?.choices) && json.choices.length > 0 && json.choices.every((choice: any) => {
    const message = choice?.message;
    if (!message || typeof message !== 'object') return false;
    const text = typeof message.content === 'string' && message.content.trim().length > 0;
    const tools = Array.isArray(message.tool_calls) && message.tool_calls.length > 0 && message.tool_calls.every((call: any) =>
      typeof call?.id === 'string' && call.id.length > 0 && call.type === 'function' &&
      typeof call.function?.name === 'string' && call.function.name.length > 0 && typeof call.function?.arguments === 'string');
    return (text || tools) && (!message.tool_calls?.length || tools);
  });
}
export async function readBoundedJson(response: Response, maxBytes: number, signal?: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('UPSTREAM_EMPTY_RESPONSE');
  const chunks: Buffer[] = []; let total = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('UPSTREAM_RESULT_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { signal?.removeEventListener('abort', abort); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
