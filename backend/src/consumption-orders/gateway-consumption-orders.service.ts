import { ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';
import { TeamCreditLedgerService } from '../team-credits/team-credit-ledger.service';
import { TeamCreditsPublisher } from '../team-collab/team-credits-publisher.service';
import { ConsumptionOrderResult, consumptionCredits, canonicalConsumptionJson, GatewayConsumptionPayload, sha256, signGatewayRequest, verifyConsumptionEnvelope } from './gateway-consumption.protocol';

const TERMINAL = new Set(['settled', 'rejected']);
const FLASH = new Set(['deepseek-v4.1-flash', 'deepseek-flash', 'deepseek-v4-flash']);
type StoredOrder = {
  version: 1; orderHash: string; gatewayInstanceId: string; userId: string; teamId: string | null;
  markup: 1 | 1.5; creditsPerYuan: 100; creditsReserved: number; registeredAt: string;
  receipt?: GatewayConsumptionPayload; payloadHash?: string; lastErrorCode?: string; checkAttempts?: number;
  creditsCharged?: number; exactCredits?: string; exactCreditNanos?: string;
};

/** Durable consumption proof and wallet settlement. Never submits model work. */
@Injectable()
export class GatewayConsumptionOrdersService {
  private readonly logger = new Logger(GatewayConsumptionOrdersService.name);
  private running = false;
  private readonly fetchImpl: typeof fetch = (...args) => fetch(...args);
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService,
    private readonly credits: CreditsService, private readonly ledger: TeamCreditLedgerService,
    private readonly publisher: TeamCreditsPublisher) {}

  isEnabled(): boolean { return !!this.config.get<string>('TANVA_CONSUMPTION_SECRET')?.trim(); }
  private secret(): string {
    const secret = this.config.get<string>('TANVA_CONSUMPTION_SECRET')?.trim();
    if (!secret) throw new ServiceUnavailableException('网关消费签名配置不可用');
    return secret;
  }
  private instance(): string { return this.config.get<string>('TANVA_CONSUMPTION_INSTANCE_ID')?.trim() || 'tanva-new-api'; }
  private lock(tx: Prisma.TransactionClient, id: string) {
    return tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
  }
  async register(apiUsageId: string, tx: Prisma.TransactionClient): Promise<boolean> {
    if (!this.isEnabled()) return false;
    if (!/^[A-Za-z0-9_.:-]{1,256}$/.test(apiUsageId)) throw new ConflictException('无效消费订单编号');
    await this.lock(tx, apiUsageId);
    const row = await tx.apiUsageRecord.findUniqueOrThrow({ where: { id: apiUsageId } });
    if (row.consumptionStatus) return true;
    if (row.responseStatus !== 'pending') throw new ConflictException('历史输出订单不能自动注册消费结算');
    const params = row.requestParams as any;
    const orderHash = params?.desktopChat?.bodyHash ?? params?.deepseekBilling?.bodyHash ?? params?.gatewayConsumption?.orderHash;
    if (typeof orderHash !== 'string' || !/^[A-Za-z0-9_.:-]{1,256}$/.test(orderHash)
      || row.provider !== 'new-api') throw new ConflictException('无效网关消费订单');
    const stored: StoredOrder = { version: 1, orderHash, gatewayInstanceId: this.instance(), userId: row.userId,
      teamId: params?.teamId || null,
      markup: params?.desktopChat?.billing?.mode === 'gateway_consumption' && params.desktopChat.billing.markup === 1 ? 1 : 1.5,
      creditsPerYuan: 100,
      creditsReserved: row.creditsUsed, registeredAt: new Date().toISOString() };
    await tx.apiUsageRecord.update({ where: { id: apiUsageId }, data: { consumptionStatus: 'pending',
      consumptionReceipt: stored as any, consumptionNextCheckAt: new Date(Date.now() + 30_000) } });
    return true;
  }
  async gatewayHeaders(apiUsageId: string, request: { method: string; path: string; rawBody: string }): Promise<Record<string, string>> {
    const row = await this.prisma.apiUsageRecord.findUnique({ where: { id: apiUsageId } });
    if (!row?.consumptionStatus) return {};
    const order = row.consumptionReceipt as unknown as StoredOrder;
    if (!/^(POST|GET)$/.test(request.method.toUpperCase()) || !/^\/v1\/[A-Za-z0-9_/:.%-]+$/.test(request.path)) throw new ConflictException('无效网关消费请求路径');
    const timestamp = String(Math.floor(Date.now() / 1000));
    return { 'X-Tanva-Order-Id': apiUsageId, 'X-Tanva-Order-Hash': order.orderHash, 'X-Tanva-Timestamp': timestamp,
      'X-Tanva-Signature': signGatewayRequest(this.secret(), timestamp, request.method, request.path, apiUsageId, order.orderHash, request.rawBody) };
  }
  async getState(apiUsageId: string): Promise<ConsumptionOrderResult> {
    const row = await this.prisma.apiUsageRecord.findUnique({ where: { id: apiUsageId } });
    if (!row) throw new NotFoundException('消费订单不存在');
    if (!row.consumptionStatus) return { enabled: false };
    const order = row.consumptionReceipt as unknown as StoredOrder;
    return { enabled: true, status: row.consumptionStatus as any, creditsCharged: order.creditsCharged,
      exactCredits: order.exactCredits, exactCreditNanos: order.exactCreditNanos,
      costCny: order.receipt?.costCny, receipt: order.receipt };
  }
  async receiveEnvelope(envelope: unknown): Promise<ConsumptionOrderResult> {
    let payload: GatewayConsumptionPayload;
    try { payload = verifyConsumptionEnvelope(envelope, this.secret()); }
    catch { throw new UnauthorizedException('无效网关消费回执签名或数据'); }
    await this.persistProof(payload);
    await this.settlePersisted(payload.orderId);
    return this.getState(payload.orderId);
  }
  private async persistProof(payload: GatewayConsumptionPayload): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await this.lock(tx, payload.orderId);
      const row = await tx.apiUsageRecord.findUnique({ where: { id: payload.orderId } });
      if (!row?.consumptionStatus) throw new NotFoundException('消费订单未登记');
      const order = row.consumptionReceipt as unknown as StoredOrder;
      const params = row.requestParams as any;
      if (payload.orderHash !== order.orderHash || payload.gatewayInstanceId !== order.gatewayInstanceId
        || order.userId !== row.userId || order.teamId !== (params?.teamId || null)
        || (payload.model !== row.model && !(FLASH.has(payload.model) && FLASH.has(row.model || '')))) throw new ConflictException('网关消费回执与原订单不一致');
      const eventId = `${payload.gatewayInstanceId}:${payload.eventId}`;
      if (row.consumptionEventId && row.consumptionEventId !== eventId) throw new ConflictException('原订单的消费事件不可替换');
      const payloadHash = sha256(canonicalConsumptionJson(payload));
      if (order.receipt) {
        if (payload.revision < order.receipt.revision) return;
        if (payload.revision === order.receipt.revision && payloadHash !== order.payloadHash) throw new ConflictException('同版本消费回执内容冲突');
        if (['consumed', 'rejected'].includes(order.receipt.status) && payloadHash !== order.payloadHash) throw new ConflictException('终态消费证明不可变更');
        if (TERMINAL.has(row.consumptionStatus)) {
          if (payloadHash !== order.payloadHash) throw new ConflictException('已结算消费回执不可变更');
          return;
        }
      }
      // Commit verified proof before wallet work: a failed settlement cannot lose it.
      await tx.apiUsageRecord.update({ where: { id: row.id }, data: { consumptionEventId: eventId,
        consumptionStatus: payload.status === 'reconciliation_required' ? 'reconciliation_required' : 'pending',
        consumptionReceipt: { ...order, receipt: payload, payloadHash } as any,
        consumptionNextCheckAt: new Date(Date.now() + 30_000) } });
    }, { timeout: 30_000 });
  }
  private async settlePersisted(apiUsageId: string): Promise<void> {
    try {
      const changed = await this.prisma.$transaction(async tx => {
        await this.lock(tx, apiUsageId);
        const row = await tx.apiUsageRecord.findUniqueOrThrow({ where: { id: apiUsageId } });
        if (!row.consumptionStatus || TERMINAL.has(row.consumptionStatus)) return null;
        const order = row.consumptionReceipt as unknown as StoredOrder;
        const proof = order.receipt;
        if (!proof || !['consumed', 'rejected'].includes(proof.status)) return null;
        if (order.userId !== row.userId || order.teamId !== ((row.requestParams as any)?.teamId || null)) throw new ConflictException('消费订单原钱包归属已改变');
        const fee = consumptionCredits(proof.costCny!, order.markup);
        if (proof.status === 'consumed') {
          const settled = order.teamId
            ? await this.ledger.settleDesktopChatUsage({ teamId: order.teamId, taskId: row.id, actorUserId: row.userId, exactCreditNanos: fee.exactCreditNanos }, tx)
            : await this.credits.settleDesktopChatUsage(row.userId, row.id, fee.exactCreditNanos, tx);
          if (settled.creditsCharged !== fee.creditsCharged) throw new ConflictException('订单已按不同费用结算');
        } else {
          // Refund validation uses the separate authoritative state, not model output.
          await tx.apiUsageRecord.update({ where: { id: row.id }, data: { consumptionStatus: 'rejected' } });
          if (order.teamId) await this.ledger.release({ teamId: order.teamId, amount: order.creditsReserved, taskId: row.id }, tx);
          else await this.credits.refundCredits(row.userId, row.id, tx);
        }
        await tx.apiUsageRecord.update({ where: { id: row.id }, data: {
          consumptionStatus: proof.status === 'consumed' ? 'settled' : 'rejected', consumptionNextCheckAt: null,
          creditsUsed: proof.status === 'consumed' ? fee.creditsCharged : 0,
          consumptionReceipt: { ...order, ...fee, checkAttempts: 0, lastErrorCode: null } as any } });
        return { teamId: order.teamId, userId: row.userId, reserved: order.creditsReserved, actual: fee.creditsCharged };
      }, { timeout: 30_000 });
      if (changed?.teamId) void this.publisher.publish({ teamId: changed.teamId, actorUserId: changed.userId,
        taskId: apiUsageId, reason: changed.actual ? 'deduct' : 'release', delta: changed.reserved - changed.actual }).catch(() => undefined);
    } catch {
      await this.defer(apiUsageId, 'WALLET_SETTLEMENT_PENDING');
    }
  }
  private async defer(apiUsageId: string, code: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await this.lock(tx, apiUsageId);
      const row = await tx.apiUsageRecord.findUniqueOrThrow({ where: { id: apiUsageId } });
      if (!row.consumptionStatus || TERMINAL.has(row.consumptionStatus)) return;
      const order = row.consumptionReceipt as unknown as StoredOrder;
      const attempts = Math.min(20, (order.checkAttempts || 0) + 1);
      await tx.apiUsageRecord.update({ where: { id: apiUsageId }, data: { consumptionStatus: 'reconciliation_required',
        consumptionReceipt: { ...order, lastErrorCode: code, checkAttempts: attempts } as any,
        consumptionNextCheckAt: new Date(Date.now() + Math.min(3600, 30 * 2 ** Math.min(attempts, 7)) * 1000) } });
    });
  }
  async reconcile(apiUsageId: string): Promise<ConsumptionOrderResult> {
    let state = await this.getState(apiUsageId);
    if (!state.enabled || TERMINAL.has(state.status!)) return state;
    // Retained terminal proof is sufficient even while the gateway is down.
    if (state.receipt && ['consumed', 'rejected'].includes(state.receipt.status)) {
      await this.settlePersisted(apiUsageId);
      return this.getState(apiUsageId);
    }
    try {
      const base = (this.config.get<string>('NEW_API_BASE_URL') || '').replace(/\/+$/, '').replace(/\/v1$/, '');
      const key = this.config.get<string>('NEW_API_KEY') || this.config.get<string>('NEW_API_TOKEN');
      if (!base || !key) throw new Error('gateway unavailable');
      const path = `/v1/tanva/consumptions/${encodeURIComponent(apiUsageId)}`;
      const headers = await this.gatewayHeaders(apiUsageId, { method: 'GET', path, rawBody: '' });
      const response = await this.fetchImpl(`${base}${path}`, { headers: { ...headers, Authorization: `Bearer ${key}`, Accept: 'application/json' },
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new Error('gateway query unavailable'); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('empty receipt');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength;
          if (size > 192 * 1024) throw new Error('receipt too large'); chunks.push(chunk.value); }
      } finally { void reader.cancel().catch(() => undefined); }
      const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const proof = verifyConsumptionEnvelope(envelope, this.secret());
      if (proof.orderId !== apiUsageId) throw new Error('receipt identity mismatch');
      state = await this.receiveEnvelope(envelope);
      return state;
    } catch { await this.defer(apiUsageId, 'GATEWAY_QUERY_PENDING'); return this.getState(apiUsageId); }
  }
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcilePendingOrders(): Promise<void> {
    if (!this.isEnabled() || this.running) return;
    this.running = true;
    try {
      const rows = await this.prisma.apiUsageRecord.findMany({ where: { consumptionStatus: { in: ['pending', 'reconciliation_required'] },
        consumptionNextCheckAt: { lte: new Date() } }, orderBy: [{ consumptionNextCheckAt: 'asc' }, { id: 'asc' }], take: 100, select: { id: true } });
      // Bounded concurrency and persistent next-check backoff prevent starvation.
      for (let i = 0; i < rows.length; i += 5) await Promise.allSettled(rows.slice(i, i + 5).map(row => this.reconcile(row.id)));
    } catch { this.logger.warn('网关消费订单自动对账暂不可用，保留原订单等待下次查询'); }
    finally { this.running = false; }
  }
}
