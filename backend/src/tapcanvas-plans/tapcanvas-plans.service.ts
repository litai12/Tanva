import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, VideoTask } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';
import { ApiResponseStatus } from '../credits/dto/credits.dto';
import { TeamCreditLedgerService } from '../team-credits/team-credit-ledger.service';
import { GatewayConsumptionOrdersService } from '../consumption-orders/gateway-consumption-orders.service';
import {
  CLIP_PREFERENCES, DEFAULT_AUTHOR_MODELS, KNOWLEDGE_TIERS, REASONING_EFFORTS, TAPCANVAS_PLAN_GATEWAY_PATH, TAPCANVAS_PLAN_MODEL,
  TAPCANVAS_PLAN_SERVICE_TYPE, TAPCANVAS_PLAN_TASK_TYPE, TERMINAL_PLAN_STATUSES, buildAssetPlanRequest, compactProgress,
  parsePlanInput, readTapJob, upstreamErrorMessage, type PlanMode,
} from './tapcanvas-plans.protocol';

/** submitting：订单已建、上游受理未确认（含网络不确定，下次查询按原请求重发）。 */
type TaskStatus = 'submitting' | 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
type TaskMeta = {
  version: 1; mode: PlanMode; requestHash: string; apiUsageId: string; teamId: string | null;
  submitPath: string; submitBody: string; reservedCredits: number;
  tapJobId?: string; sourceTaskId?: string; sourceTapJobId?: string;
  progress?: ReturnType<typeof compactProgress>; usage?: unknown; summary?: { modelKey: string; assetCount: number; textLength: number };
};

const DEFINITIVE_REJECTION = new Set([400, 401, 402, 403, 404, 409, 422]);
const REFRESH_INTERVAL_MS = 3_000;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class TapcanvasPlansService {
  private readonly logger = new Logger(TapcanvasPlansService.name);
  private readonly fetchImpl: typeof fetch = (...args) => fetch(...args);
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService,
    private readonly credits: CreditsService, private readonly ledger: TeamCreditLedgerService,
    private readonly orders: GatewayConsumptionOrdersService) {}

  private reserveCredits(): number {
    const value = Number(this.config.get<string>('TAPCANVAS_PLAN_RESERVE_CREDITS') || 500);
    return Number.isFinite(value) && value >= 1 ? Math.round(value) : 500;
  }
  private authorModels(): string[] {
    const raw = this.config.get<string>('TAPCANVAS_PLAN_AUTHOR_MODELS')?.split(',').map(s => s.trim()).filter(Boolean);
    return raw?.length ? raw : DEFAULT_AUTHOR_MODELS;
  }
  private gateway() {
    const base = (this.config.get<string>('NEW_API_BASE_URL') || '').replace(/\/+$/, '').replace(/\/v1$/, '');
    const key = this.config.get<string>('NEW_API_KEY') || this.config.get<string>('NEW_API_TOKEN');
    if (!base || !key) throw new ServiceUnavailableException('规划网关未配置');
    return { base, key };
  }

  options() {
    return { enabled: this.orders.isEnabled(), authorModels: this.authorModels(), defaultModel: this.authorModels()[0],
      reasoningEfforts: REASONING_EFFORTS, clipPreferences: CLIP_PREFERENCES, knowledgeTiers: KNOWLEDGE_TIERS,
      reserveCredits: this.reserveCredits(), pricing: { basis: 'tapcanvas_receipt', creditsPerYuan: 100, markup: 1.5 } };
  }

  private async scope(userId: string, rawTeamId: unknown, tx: Prisma.TransactionClient): Promise<string | null> {
    if (rawTeamId === undefined || rawTeamId === null || rawTeamId === '') return null;
    if (typeof rawTeamId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(rawTeamId)) throw new BadRequestException('团队标识无效');
    const team = await tx.team.findUnique({ where: { id: rawTeamId }, select: { isPersonal: true, status: true } });
    const member = await tx.teamMembership.findUnique({ where: { teamId_userId: { teamId: rawTeamId, userId } }, select: { userId: true } });
    if (!team || team.status !== 'active' || !member) throw new ForbiddenException('当前账号无权使用此团队积分');
    return team.isPersonal ? null : rawTeamId;
  }

  async create(userId: string, raw: any, rawTeamId: unknown) {
    if (!this.orders.isEnabled()) throw new ServiceUnavailableException('网关签名消费结算未开启，暂不能提交规划');
    const input = parsePlanInput(raw);
    const request = buildAssetPlanRequest(input, this.config.get<string>('TAPCANVAS_PLAN_EXACT_DURATION') === 'true');
    const identity = sha(`${userId}\n${input.clientRequestId}`);
    return this.admit(userId, rawTeamId, identity, {
      mode: input.mode, nodeId: input.nodeId, projectId: input.projectId,
      requestHash: sha(JSON.stringify({ request, team: rawTeamId || null, projectId: input.projectId || null, nodeId: input.nodeId || null })),
      path: TAPCANVAS_PLAN_GATEWAY_PATH, upstream: { request }, prompt: String(request.prompt).slice(0, 2000),
      summary: { modelKey: input.modelKey, assetCount: input.assets.length, textLength: input.text.length },
    });
  }

  /** 对失败任务创建 TapCanvas 子任务：新 jobId、新订单；已成功阶段不重复计费。 */
  async retry(userId: string, taskId: string, raw: any, rawTeamId: unknown) {
    const source = await this.owned(taskId, userId);
    const meta = source.metadata as TaskMeta;
    const clientRequestId = typeof raw?.clientRequestId === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(raw.clientRequestId) ? raw.clientRequestId : null;
    if (!clientRequestId) throw new BadRequestException('缺少 clientRequestId');
    if (source.status !== 'failed' || !meta.tapJobId || !meta.progress?.retryable) {
      throw new ConflictException('只有可续跑的失败任务才能重试；已取消或超时的任务请重新提交');
    }
    return this.admit(userId, rawTeamId ?? meta.teamId, sha(`${userId}\nretry\n${taskId}\n${clientRequestId}`), {
      mode: meta.mode, nodeId: source.nodeId ?? undefined, projectId: (meta as any).projectId,
      requestHash: sha(JSON.stringify({ retry: taskId, team: rawTeamId ?? meta.teamId ?? null })),
      path: `${TAPCANVAS_PLAN_GATEWAY_PATH}/${encodeURIComponent(meta.tapJobId)}/retry`, upstream: {}, prompt: source.prompt ?? undefined,
      summary: meta.summary, sourceTaskId: source.id, sourceTapJobId: meta.tapJobId,
    });
  }

  private async admit(userId: string, rawTeamId: unknown, identity: string, spec: {
    mode: PlanMode; nodeId?: string; projectId?: string; requestHash: string; path: string; upstream: Record<string, unknown>;
    prompt?: string; summary?: TaskMeta['summary']; sourceTaskId?: string; sourceTapJobId?: string;
  }) {
    const taskId = `tcp-${identity.slice(0, 48)}`;
    const apiUsageId = `tapcanvas-plan:${identity}`;
    const existing = await this.prisma.videoTask.findUnique({ where: { id: taskId } });
    if (existing) {
      if (existing.userId !== userId || (existing.metadata as TaskMeta)?.requestHash !== spec.requestHash) throw new ConflictException('重复请求的参数不一致');
      return this.get(taskId, userId);
    }
    const submitBody = JSON.stringify({ model: TAPCANVAS_PLAN_MODEL, idempotencyKey: `tanva-${identity.slice(0, 56)}`, ...spec.upstream });
    const reserve = this.reserveCredits();
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${apiUsageId}, 0))`;
      if (await tx.videoTask.findUnique({ where: { id: taskId } })) return;
      const teamId = await this.scope(userId, rawTeamId, tx);
      if (teamId) {
        // 团队按签名回执一次性结算（与桌面网关订单一致），受理时只校验可用余额，不受 20 分钟预留时限影响。
        const account = await tx.teamCreditAccount.findUnique({ where: { teamId }, select: { balance: true, frozenBalance: true } });
        if (!account || account.balance - account.frozenBalance < reserve) throw new BadRequestException(`团队可用积分不足 ${reserve}，无法提交规划`);
      }
      const reservedCredits = teamId ? 0 : reserve;
      await this.credits.deductExact(userId, teamId, reservedCredits, {
        apiUsageId, serviceType: TAPCANVAS_PLAN_SERVICE_TYPE, serviceName: spec.mode === 'remake' ? '爆款复刻规划' : '一键成片规划',
        provider: 'new-api', model: TAPCANVAS_PLAN_MODEL, responseStatus: ApiResponseStatus.PENDING,
        requestParams: { gatewayConsumption: { orderHash: sha(submitBody), kind: 'tapcanvas_asset_plan', taskId }, ...(teamId ? { teamId } : {}) },
      }, tx);
      if (teamId) {
        const reserved = await this.ledger.reserve({ teamId, amount: 0, taskId: apiUsageId, taskKind: TAPCANVAS_PLAN_SERVICE_TYPE,
          actorUserId: userId, deferredSettlement: true }, tx);
        if (!reserved.reserved) throw new ForbiddenException(reserved.reason || '团队积分预留失败');
      }
      if (!(await this.orders.register(apiUsageId, tx))) throw new ServiceUnavailableException('网关签名消费结算不可用');
      const meta: TaskMeta = { version: 1, mode: spec.mode, requestHash: spec.requestHash, apiUsageId, teamId,
        submitPath: spec.path, submitBody, reservedCredits, summary: spec.summary,
        ...(spec.sourceTaskId ? { sourceTaskId: spec.sourceTaskId, sourceTapJobId: spec.sourceTapJobId } : {}),
        ...(spec.projectId ? { projectId: spec.projectId } as any : {}) };
      await tx.videoTask.create({ data: { id: taskId, userId, nodeId: spec.nodeId, taskType: TAPCANVAS_PLAN_TASK_TYPE,
        status: 'submitting', prompt: spec.prompt, metadata: meta as any } });
    }, { timeout: 30_000 });
    await this.submit(taskId);
    return this.get(taskId, userId, true);
  }

  /** 发送（或按原请求重发）签名订单。同一订单 + 同一 Idempotency-Key 在 new-api 与 TapCanvas 都幂等。 */
  private async submit(taskId: string): Promise<void> {
    const row = await this.prisma.videoTask.findUniqueOrThrow({ where: { id: taskId } });
    if (row.status !== 'submitting') return;
    const meta = row.metadata as TaskMeta;
    let status = 0; let body: any;
    try {
      const { base, key } = this.gateway();
      const headers = await this.orders.gatewayHeaders(meta.apiUsageId, { method: 'POST', path: meta.submitPath, rawBody: meta.submitBody });
      if (!headers['X-Tanva-Order-Id']) throw new Error('consumption order missing');
      const response = await this.fetchImpl(`${base}${meta.submitPath}`, { method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
        body: meta.submitBody, signal: AbortSignal.timeout(60_000) });
      status = response.status;
      body = await response.json().catch(() => undefined);
    } catch (error) {
      this.logger.warn(`tapcanvas plan submit uncertain ${taskId}: ${error instanceof Error ? error.message : String(error)}`);
      await this.patch(taskId, { error: '规划服务响应不确定，正在按原请求核对' });
      return;
    }
    const job = status >= 200 && status < 300 ? readTapJob(body) : null;
    if (job) {
      await this.patch(taskId, { status: job.status, error: null, meta: { tapJobId: job.jobId, progress: compactProgress(job.data) } });
      return;
    }
    // new-api：同一订单首个请求仍在转发中时以 409 tanva_order_in_progress 拒绝重放，结果未定，下次查询再核对。
    if (DEFINITIVE_REJECTION.has(status) && body?.error !== 'tanva_order_in_progress') {
      await this.patch(taskId, { status: 'failed', error: upstreamErrorMessage(status, body), completedAt: new Date() });
      void this.orders.reconcile(meta.apiUsageId).catch(() => undefined);
      return;
    }
    await this.patch(taskId, { error: upstreamErrorMessage(status, body) });
  }

  private async patch(taskId: string, change: { status?: TaskStatus; error?: string | null; completedAt?: Date; result?: unknown; meta?: Partial<TaskMeta> }) {
    const row = await this.prisma.videoTask.findUniqueOrThrow({ where: { id: taskId } });
    // 终态不可回退：成功结果与已确认失败不被迟到的查询覆盖。
    if (TERMINAL_PLAN_STATUSES.has(row.status) && change.status && change.status !== row.status) return;
    await this.prisma.videoTask.update({ where: { id: taskId }, data: {
      ...(change.status ? { status: change.status } : {}),
      ...(change.error !== undefined ? { error: change.error } : {}),
      ...(change.completedAt ? { completedAt: change.completedAt } : {}),
      ...(change.result !== undefined ? { result: change.result as any } : {}),
      ...(change.meta ? { metadata: { ...(row.metadata as any), ...change.meta } } : {}),
    } });
  }

  private async owned(taskId: string, userId: string): Promise<VideoTask> {
    const row = await this.prisma.videoTask.findUnique({ where: { id: taskId } });
    if (!row || row.userId !== userId || row.taskType !== TAPCANVAS_PLAN_TASK_TYPE) throw new NotFoundException('规划任务不存在');
    return row;
  }

  private async passthrough(method: 'GET' | 'POST', path: string): Promise<{ status: number; body: any }> {
    const { base, key } = this.gateway();
    const response = await this.fetchImpl(`${base}${path}`, { method, redirect: 'error',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    return { status: response.status, body: await response.json().catch(() => undefined) };
  }

  private async refresh(row: VideoTask): Promise<void> {
    const meta = row.metadata as TaskMeta;
    if (row.status === 'submitting') { await this.submit(row.id); return; }
    if (!meta.tapJobId) return;
    const needsResult = row.status === 'succeeded' && row.result == null;
    if (TERMINAL_PLAN_STATUSES.has(row.status) && !needsResult) return;
    const job = encodeURIComponent(meta.tapJobId);
    if (!needsResult) {
      const { status, body } = await this.passthrough('GET', `${TAPCANVAS_PLAN_GATEWAY_PATH}/${job}`);
      const parsed = status === 200 ? readTapJob(body) : null;
      if (!parsed) return;
      const terminal = TERMINAL_PLAN_STATUSES.has(parsed.status);
      const error = parsed.data?.error?.message ? String(parsed.data.error.message).slice(0, 500) : parsed.status === 'canceled' ? '已停止' : null;
      if (parsed.status !== 'succeeded') {
        await this.patch(row.id, { status: parsed.status, error, meta: { progress: compactProgress(parsed.data) }, ...(terminal ? { completedAt: new Date() } : {}) });
        if (terminal) void this.orders.reconcile(meta.apiUsageId).catch(() => undefined);
        return;
      }
      await this.patch(row.id, { meta: { progress: compactProgress(parsed.data) } });
    }
    // 成功：读取节点数组（不含 1–2MB 的阶段产物）后才对外标记成功。
    const { status, body } = await this.passthrough('GET', `${TAPCANVAS_PLAN_GATEWAY_PATH}/${job}/result`);
    if (status !== 200 || body?.ret !== 0 || !Array.isArray(body?.data) || !body.data.length) return;
    await this.patch(row.id, { status: 'succeeded', error: null, completedAt: row.completedAt ?? new Date(), result: body.data,
      meta: { usage: body.usage ?? null } });
    void this.orders.reconcile(meta.apiUsageId).catch(() => undefined);
  }

  async get(taskId: string, userId: string, fresh = false) {
    let row = await this.owned(taskId, userId);
    if (!fresh && (!TERMINAL_PLAN_STATUSES.has(row.status) || (row.status === 'succeeded' && row.result == null))
      && Date.now() - row.updatedAt.getTime() >= REFRESH_INTERVAL_MS) {
      try { await this.refresh(row); } catch (error) {
        this.logger.warn(`tapcanvas plan refresh failed ${taskId}: ${error instanceof Error ? error.message : String(error)}`);
      }
      row = await this.owned(taskId, userId);
    }
    return this.view(row);
  }

  async result(taskId: string, userId: string) {
    const row = await this.owned(taskId, userId);
    if (row.status !== 'succeeded' || !Array.isArray(row.result)) throw new ConflictException('规划尚未成功，暂无节点结果');
    return { id: row.id, nodes: row.result };
  }

  async cancel(taskId: string, userId: string) {
    const row = await this.owned(taskId, userId);
    const meta = row.metadata as TaskMeta;
    if (TERMINAL_PLAN_STATUSES.has(row.status)) return this.view(row);
    if (!meta.tapJobId) throw new ConflictException('规划仍在提交确认中，请稍后再停止');
    const { status, body } = await this.passthrough('POST', `${TAPCANVAS_PLAN_GATEWAY_PATH}/${encodeURIComponent(meta.tapJobId)}/cancel`);
    const parsed = status === 200 || status === 202 ? readTapJob(body) : null;
    if (!parsed) throw new ServiceUnavailableException(upstreamErrorMessage(status, body));
    if (parsed.status === 'canceled') {
      await this.patch(taskId, { status: 'canceled', error: '已停止', completedAt: new Date(), meta: { progress: compactProgress(parsed.data) } });
      void this.orders.reconcile(meta.apiUsageId).catch(() => undefined);
    } else {
      await this.patch(taskId, { meta: { progress: compactProgress(parsed.data) } });
    }
    return this.view(await this.owned(taskId, userId));
  }

  private async view(row: VideoTask) {
    const meta = row.metadata as TaskMeta;
    let billing: Record<string, unknown> = { reservedCredits: meta.reservedCredits };
    try {
      const state = await this.orders.getState(meta.apiUsageId);
      billing = { ...billing, status: state.status, creditsCharged: state.creditsCharged ?? null, costCny: state.costCny ?? null };
    } catch { billing = { ...billing, status: 'unknown' }; }
    const progress = meta.progress;
    return {
      id: row.id, status: row.status as TaskStatus, mode: meta.mode, nodeId: row.nodeId, tapJobId: meta.tapJobId ?? null,
      sourceTaskId: meta.sourceTaskId ?? null, error: row.error, progress: progress ?? null,
      canCancel: (row.status === 'queued' || row.status === 'running') && !!meta.tapJobId,
      canRetry: row.status === 'failed' && !!meta.tapJobId && !!progress?.retryable,
      hasResult: row.status === 'succeeded' && Array.isArray(row.result),
      nodeCount: Array.isArray(row.result) ? row.result.length : null,
      usage: meta.usage ?? null, billing, summary: meta.summary ?? null,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
}
