import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import type { VideoTask } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import { CreditsService } from '../credits/credits.service';
import { TapcanvasPlansService } from '../tapcanvas-plans/tapcanvas-plans.service';
import { REMAKE_DEFAULT_REQUIREMENT, remoteUrl } from '../tapcanvas-plans/tapcanvas-plans.protocol';
import { buildProductionGraph, clampSeedanceDuration, imageWaves, type AssetPlanNode, type GraphClip, type GraphImage, type ProductionGraph } from './plan-graph';
import { applyImageModel, buildImageCall, buildVideoCall, findImageModel, findVideoModel, IMAGE_MODEL_OPTIONS, nearestVideoRatio, VIDEO_MODEL_OPTIONS, VIDEO_RATIOS, VIDEO_RESOLUTIONS } from './requests';

export const VIDEO_PRODUCTION_TASK_TYPE = 'video-production';
const QUEUE = 'video-productions';
const TICK_MS = 5_000;
const LOCK_MS = 15 * 60_000;
const IMAGE_TIMEOUT_MS = 30 * 60_000;
const CLIP_TIMEOUT_MS = 60 * 60_000;
const MAX_ATTEMPTS = 2;
const MAX_VIDEO_BYTES = Number(process.env.VIDEO_DOWNLOAD_MAX_BYTES || 512 * 1024 * 1024);
const DEFAULT_FILM_RATIO = '9:16';
const DEFAULT_RESOLUTION = '720P';

/** AiController 注册：以用户身份直接调用画布节点所用的同一批接口方法（报价、预扣、结算、退款都在其中闭环）。 */
export interface VideoProductionExecutor {
  submitImage(kind: 'generate' | 'edit' | 'blend', dto: Record<string, any>, req: any): Promise<{ taskId?: string; status?: string }>;
  getImageTask(taskId: string, req: any): Promise<{ status: string; imageUrl?: string | null; error?: string | null }>;
  submitVideo(dto: Record<string, any>, req: any): Promise<{ taskId?: string; videoUrl?: string; status?: string; apiUsageId?: string | null }>;
  getVideoTask(provider: string, taskId: string, req: any): Promise<{ status: string; videoUrl?: string | null; error?: string | null }>;
  seedanceAccess(req: any): Promise<{ allowed: boolean }>;
  quoteImage(userId: string, kind: 'generate' | 'edit' | 'blend', dto: Record<string, any>): Promise<number | null>;
  quoteVideo(userId: string, dto: Record<string, any>): Promise<number | null>;
  probeDuration(url: string): Promise<number>;
}

type Kind = 'film' | 'remake' | 'single';
type Stage = 'planning' | 'waiting_credits' | 'producing' | 'composing' | 'succeeded' | 'failed' | 'cancelled';
type StepStatus = 'pending' | 'submitted' | 'succeeded' | 'failed';
interface Step { status: StepStatus; taskId?: string; url?: string; error?: string; attempts: number; submittedAt?: number }
interface JobInput {
  kind: Kind; story?: string; prompt?: string; referenceVideoUrl?: string; referenceImageUrls: string[]; firstFrameUrl?: string;
  planModel?: string; imageModel?: string; videoModel?: string; aspectRatio?: string; resolution?: string;
  targetSeconds?: number; durationSeconds?: number; requirements?: string; teamId?: string;
}
interface JobMeta {
  input: JobInput; stage: Stage; planTaskId?: string; planAttempts?: number; sourceSeconds?: number;
  graph?: ProductionGraph; images: Record<string, Step>; clips: Record<string, Step>;
  estimate?: { credits: number | null; balance?: number | null; partial?: boolean };
  finalVideoUrl?: string; warnings: string[]; startedAt: number;
}
type Row = VideoTask;

const fail = (message: string) => { throw new BadRequestException(message); };
const text = (value: unknown, name: string, max: number) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') fail(`${name} 必须是字符串`);
  const out = (value as string).trim();
  if (out.length > max) fail(`${name} 过长（最多 ${max} 字符）`);
  return out || undefined;
};
const sleepReq = (userId: string, teamId?: string, idempotencyKey?: string) => ({
  user: { id: userId, sub: userId }, cookies: {}, ip: '127.0.0.1',
  headers: { 'user-agent': 'tanva-video-production', ...(teamId ? { 'x-team-id': teamId } : {}), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
});
const errMessage = (error: unknown) => {
  const response = (error as { getResponse?: () => unknown })?.getResponse?.();
  const msg = response && typeof response === 'object' ? (response as { message?: unknown }).message : undefined;
  if (Array.isArray(msg)) return msg.join('；');
  if (typeof msg === 'string') return msg;
  return error instanceof Error ? error.message : String(error);
};

@Injectable()
export class VideoProductionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoProductionService.name);
  private executor?: VideoProductionExecutor;
  private queue?: Queue;
  private worker?: Worker;
  private redis?: Redis;
  private readonly memoryLocks = new Set<string>();
  private composing = Promise.resolve();

  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService, private readonly oss: OssService,
    private readonly credits: CreditsService, private readonly plans: TapcanvasPlansService) {}

  registerExecutor(executor: VideoProductionExecutor) { this.executor = executor; }

  onModuleInit() {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) { this.logger.warn('REDIS_URL 未配置，成片任务队列未启用'); return; }
    const connection = { url };
    this.redis = new Redis(url, { maxRetriesPerRequest: 2 });
    this.redis.on('error', () => undefined);
    this.queue = new Queue(QUEUE, { connection, defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: 200 } });
    this.worker = new Worker(QUEUE, job => this.tick(job.data.id), { connection, concurrency: 4 });
    this.worker.on('error', error => this.logger.warn(`video production queue error: ${error.message}`));
    // 重启后接着跑：所有未结束任务各补一次推进。
    void this.prisma.videoTask.findMany({ where: { taskType: VIDEO_PRODUCTION_TASK_TYPE, status: { in: ['queued', 'processing'] } }, select: { id: true } })
      .then(rows => Promise.all(rows.map(r => this.schedule(r.id, 1_000))))
      .catch(error => this.logger.warn(`video production recovery failed: ${errMessage(error)}`));
  }
  async onModuleDestroy() { await this.worker?.close(); await this.queue?.close(); this.redis?.disconnect(); }

  private exec(): VideoProductionExecutor {
    if (!this.executor) throw new ServiceUnavailableException('成片执行器未就绪');
    return this.executor;
  }

  // ------------------------------------------------------------- public API

  async create(userId: string, raw: any, rawTeamId: unknown) {
    if (!this.queue) throw new ServiceUnavailableException('成片任务队列未启用');
    const input = await this.parseInput(raw, rawTeamId);
    const exec = this.exec();
    const access = await exec.seedanceAccess(sleepReq(userId, input.teamId)).catch(() => ({ allowed: false }));
    if (!access.allowed) throw new ForbiddenException('Seedance 2.x 仅支持 VIP 或已配置对应权益的白名单用户使用');
    const id = `vprod_${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
    const meta: JobMeta = { input, stage: input.kind === 'single' ? 'producing' : 'planning', images: {}, clips: {}, warnings: [], startedAt: Date.now() };
    if (input.kind === 'single') {
      const model = (input.videoModel || 'seedance-2.0') as GraphClip['seedanceModel'];
      const option = findVideoModel(model)!;
      const clip: GraphClip = {
        key: 'clip:1', title: 'Clip 1', prompt: input.prompt!, seedanceModel: model,
        mode: input.firstFrameUrl ? 'first_frame' : 'reference_images',
        durationSeconds: Math.min(option.durations.max, Math.max(option.durations.min, Math.round(input.durationSeconds ?? 5))),
        resolution: input.resolution || DEFAULT_RESOLUTION, aspectRatio: input.aspectRatio || '16:9',
        ...(input.firstFrameUrl ? { firstFrame: 'input:first' } : {}),
        references: input.firstFrameUrl ? [] : input.referenceImageUrls.map((_, i) => `input:${i + 1}`), mentions: [],
      };
      meta.graph = { images: [], clips: [clip], warnings: [] };
      meta.clips[clip.key] = { status: 'pending', attempts: 0 };
    }
    await this.prisma.videoTask.create({ data: { id, userId, taskType: VIDEO_PRODUCTION_TASK_TYPE, status: 'processing',
      prompt: (input.story || input.prompt || input.requirements || input.referenceVideoUrl || '').slice(0, 2000), metadata: meta as any } });
    await this.schedule(id, 0);
    return this.view(await this.owned(id, userId));
  }

  async get(id: string, userId: string) {
    const row = await this.owned(id, userId);
    // 自愈：推进链条意外断掉（进程被杀、队列丢任务）时补一次。
    if ((row.status === 'processing' || row.status === 'queued') && Date.now() - row.updatedAt.getTime() > 90_000) await this.schedule(id, 0);
    const view = this.view(row);
    // 规划阶段附上 TapCanvas 规划节点进度（只读本地已落库的进度，不额外请求上游）。
    const meta = row.metadata as unknown as JobMeta;
    if (meta.stage === 'planning' && meta.planTaskId) {
      const plan = await this.prisma.videoTask.findFirst({ where: { id: meta.planTaskId, userId }, select: { metadata: true, status: true } }).catch(() => null);
      const progress = (plan?.metadata as any)?.progress;
      if (progress) return { ...view, planProgress: { status: plan!.status, nodes: progress.nodes ?? [], nodeSummary: progress.nodeSummary ?? null, elapsedMs: progress.elapsedMs ?? null } };
    }
    return view;
  }

  async list(userId: string, limit = 20) {
    const rows = await this.prisma.videoTask.findMany({ where: { userId, taskType: VIDEO_PRODUCTION_TASK_TYPE }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 50) });
    return rows.map(row => {
      const meta = row.metadata as unknown as JobMeta;
      return { jobId: row.id, kind: meta.input.kind, status: row.status, stage: meta.stage, finalVideoUrl: meta.finalVideoUrl ?? null,
        prompt: (row.prompt || '').slice(0, 120), createdAt: row.createdAt.toISOString() };
    });
  }

  /** 余额不足停在 waiting_credits 时继续；可同时修改尚未提交的 Clip。 */
  async produce(id: string, userId: string, raw: any) {
    return this.mutate(id, userId, (row, meta) => {
      if (meta.stage !== 'waiting_credits') throw new ConflictException('只有因余额不足暂停的任务需要继续');
      this.applyClipEdits(meta, raw?.clipEdits);
      meta.stage = 'producing';
      return { status: 'processing', meta };
    });
  }

  async retry(id: string, userId: string, raw: any) {
    return this.mutate(id, userId, (row, meta) => {
      if (row.status !== 'failed') throw new ConflictException('只有失败的任务可以重试');
      const only: string[] | undefined = Array.isArray(raw?.clipKeys) ? raw.clipKeys.map(String) : undefined;
      if (!meta.graph) { meta.stage = 'planning'; meta.planTaskId = undefined; meta.planAttempts = (meta.planAttempts ?? 0) + 1; }
      else {
        for (const [key, step] of Object.entries(meta.images)) if (step.status === 'failed') Object.assign(step, { status: 'pending', attempts: 0, error: undefined, taskId: undefined });
        for (const [key, step] of Object.entries(meta.clips)) {
          if (step.status === 'failed' && (!only || only.includes(key))) Object.assign(step, { status: 'pending', attempts: 0, error: undefined, taskId: undefined });
        }
        meta.stage = 'producing';
      }
      return { status: 'processing', meta };
    });
  }

  async cancel(id: string, userId: string) {
    return this.mutate(id, userId, (row, meta) => {
      if (['succeeded', 'failed', 'canceled'].includes(row.status)) return { status: row.status, meta };
      meta.stage = 'cancelled';
      return { status: 'canceled', meta, error: '已取消（已提交的生成照常按实际结果结算）' };
    });
  }

  /**
   * 单张生图（移动端「生成图片」）：与画布 GPT Image 节点同一套报价、预扣、结算与失败退款（image-tasks worker 闭环）。
   * 返回上游图片任务 ID，前端经 GET /api/ai/image-task/:id 轮询。
   */
  async submitUserImage(userId: string, input: { prompt: string; referenceImageUrls: string[]; aspectRatio?: string; idempotencyKey: string }) {
    const call = buildImageCall({ nodeType: 'gptImage2', model: 'gpt-image-2.6-sunburst', prompt: input.prompt, resolution: '2K',
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}) }, input.referenceImageUrls.slice(0, 10), `mimg-${input.idempotencyKey}`);
    const res = await this.exec().submitImage(call.kind, call.dto, sleepReq(userId, undefined, input.idempotencyKey));
    if (!res?.taskId) throw new ServiceUnavailableException('生图任务未受理，请稍后重试');
    return { taskId: res.taskId };
  }

  async models(userId: string, rawTeamId: unknown) {
    const exec = this.exec();
    const teamId = typeof rawTeamId === 'string' && rawTeamId ? rawTeamId : undefined;
    const access = await exec.seedanceAccess(sleepReq(userId, teamId)).catch(() => ({ allowed: false }));
    const planOptions = this.plans.options();
    const images = await Promise.all(IMAGE_MODEL_OPTIONS.map(async option => {
      const call = buildImageCall({ nodeType: option.nodeType, model: option.model, prompt: 'x', resolution: '1K', aspectRatio: '1:1' }, [], 'quote');
      const credits = await exec.quoteImage(userId, call.kind, call.dto).catch(() => null);
      return { modelKey: option.id, label: option.label, description: option.description, scenes: ['film', 'remake'],
        available: true, resolutions: ['1K', '2K', '4K'], creditsPerImage1K: credits };
    }));
    const videos = await Promise.all(VIDEO_MODEL_OPTIONS.map(async option => {
      const dto = buildVideoCall({ prompt: 'x', seedanceModel: option.id, mode: 'reference_images', durationSeconds: 5, resolution: '720P', aspectRatio: '16:9', references: [], mentions: [] },
        () => undefined, { idempotencyKey: 'quote', clientNodeId: 'quote' });
      const credits = await exec.quoteVideo(userId, dto).catch(() => null);
      return { modelKey: option.id, label: option.label, description: option.description, scenes: ['film', 'remake', 'single'],
        available: access.allowed, reason: access.allowed ? null : 'Seedance 2.x 仅支持 VIP 或已配置对应权益的白名单用户',
        durationSeconds: option.durations, resolutions: VIDEO_RESOLUTIONS, aspectRatios: VIDEO_RATIOS, maxReferenceImages: option.maxReferenceImages,
        creditsPer5s720P: credits };
    }));
    return {
      plan: { enabled: planOptions.enabled, models: planOptions.authorModels, defaultModel: planOptions.defaultModel,
        note: '规划（分镜与提示词）按 TapCanvas 实际用量结算，1 元 = 150 积分（含加价）' },
      image: images, video: videos,
      notSupportedYet: '可灵、Vidu、海螺、万相、Veo 等视频模型暂未接入一键成片 / 单段生视频',
      defaults: { videoModel: 'seedance-2.0', resolution: DEFAULT_RESOLUTION, filmAspectRatio: DEFAULT_FILM_RATIO, remakeAspectRatio: '按规划（跟随原片）', imageModel: '按规划' },
    };
  }

  // ------------------------------------------------------------- input

  private async parseInput(raw: any, rawTeamId: unknown): Promise<JobInput> {
    if (!raw || typeof raw !== 'object') fail('请求体无效');
    const kind: Kind = raw.mode === 'remake' ? 'remake' : raw.mode === 'single' ? 'single' : raw.mode === 'film' || raw.mode === 'story' || raw.mode === undefined ? 'film' : fail('mode 只能是 film / remake / single') as never;
    const teamId = typeof rawTeamId === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(rawTeamId) ? rawTeamId : undefined;
    const urls = (value: unknown, name: string, max: number) => {
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value) || value.length > max) fail(`${name} 最多 ${max} 个`);
      return (value as unknown[]).map((v, i) => remoteUrl(v, `${name}[${i}]`));
    };
    const input: JobInput = {
      kind, teamId,
      story: text(raw.story ?? raw.text, 'story', 200_000),
      prompt: text(raw.prompt, 'prompt', 20_000),
      requirements: text(raw.requirements ?? raw.requirement, 'requirements', 20_000),
      referenceVideoUrl: raw.referenceVideoUrl ? remoteUrl(raw.referenceVideoUrl, 'referenceVideoUrl') : undefined,
      referenceImageUrls: urls(raw.referenceImageUrls, 'referenceImageUrls', kind === 'single' ? 30 : 12),
      firstFrameUrl: raw.firstFrameUrl ? remoteUrl(raw.firstFrameUrl, 'firstFrameUrl') : undefined,
    };
    if (raw.planModel !== undefined && raw.planModel !== '') {
      const models = this.plans.options().authorModels;
      if (!models.includes(raw.planModel)) fail(`planModel 无效，可选：${models.join(' / ')}`);
      input.planModel = raw.planModel;
    }
    if (raw.imageModel !== undefined && raw.imageModel !== '') {
      const option = findImageModel(String(raw.imageModel));
      if (!option) fail(`imageModel 无效，可选：${IMAGE_MODEL_OPTIONS.map(m => m.id).join(' / ')}`);
      input.imageModel = option!.id;
    }
    if (raw.videoModel !== undefined && raw.videoModel !== '') {
      const option = findVideoModel(String(raw.videoModel).toLowerCase());
      if (!option) fail(`videoModel 无效，可选：${VIDEO_MODEL_OPTIONS.map(m => m.id).join(' / ')}（其它视频模型暂未接入）`);
      input.videoModel = option!.id;
    }
    if (raw.aspectRatio !== undefined && raw.aspectRatio !== '') {
      if (!VIDEO_RATIOS.includes(raw.aspectRatio)) fail(`aspectRatio 可选：${VIDEO_RATIOS.join(' / ')}`);
      input.aspectRatio = raw.aspectRatio;
    }
    if (raw.resolution !== undefined && raw.resolution !== '') {
      const r = String(raw.resolution).toUpperCase();
      if (!VIDEO_RESOLUTIONS.includes(r)) fail(`resolution 可选：${VIDEO_RESOLUTIONS.join(' / ')}`);
      input.resolution = r;
    }
    if (raw.targetSeconds !== undefined && raw.targetSeconds !== null && raw.targetSeconds !== '') {
      const n = Number(raw.targetSeconds);
      if (!Number.isFinite(n) || n < 4 || n > 600) fail('targetSeconds 需在 4–600 秒之间');
      input.targetSeconds = Math.round(n);
    }
    if (raw.durationSeconds !== undefined && raw.durationSeconds !== null && raw.durationSeconds !== '') {
      const n = Number(raw.durationSeconds);
      if (!Number.isFinite(n)) fail('durationSeconds 无效');
      input.durationSeconds = n;
    }
    if (kind === 'film' && !input.story) fail('一键成片需要提供 story（故事或章节原文）');
    if (kind === 'remake' && !input.referenceVideoUrl) fail('爆款复刻需要提供 referenceVideoUrl（参考视频的公网地址）');
    if (kind === 'single' && !input.prompt) fail('单段生视频需要提供 prompt');
    if (kind === 'single' && input.firstFrameUrl && input.referenceImageUrls.length) fail('firstFrameUrl 与 referenceImageUrls 只能二选一');
    if (kind === 'single') {
      const max = findVideoModel(input.videoModel || 'seedance-2.0')!.maxReferenceImages;
      if (input.referenceImageUrls.length > max) fail(`该模型最多 ${max} 张参考图`);
    }
    return input;
  }

  private applyClipEdits(meta: JobMeta, edits: unknown) {
    if (edits === undefined || edits === null) return;
    if (!Array.isArray(edits) || !meta.graph) fail('clipEdits 无效');
    for (const raw of edits as any[]) {
      const index = Number(raw?.index);
      const clip = typeof raw?.clipKey === 'string' ? meta.graph!.clips.find(c => c.key === raw.clipKey)
        : Number.isInteger(index) ? meta.graph!.clips[index - 1] : undefined;
      if (!clip) fail('clipEdits 中有找不到的 Clip（用 index，从 1 开始，或 clipKey）');
      if (meta.clips[clip!.key]?.status !== 'pending') fail(`${clip!.title} 已开始生成，不能再修改`);
      if (raw.remove === true) { meta.graph!.clips = meta.graph!.clips.filter(c => c !== clip); delete meta.clips[clip!.key]; continue; }
      if (typeof raw.prompt === 'string' && raw.prompt.trim()) clip!.prompt = raw.prompt.trim();
      if (raw.durationSeconds !== undefined) clip!.durationSeconds = clampSeedanceDuration(raw.durationSeconds);
    }
    if (!meta.graph!.clips.length) fail('至少保留 1 个 Clip');
  }

  // ------------------------------------------------------------- engine

  private async schedule(id: string, delay: number) {
    if (!this.queue) return;
    const jobId = `${id}-${Math.floor((Date.now() + delay) / 2000)}`;
    await this.queue.add('tick', { id }, { delay, jobId }).catch(error => this.logger.warn(`schedule ${id} failed: ${errMessage(error)}`));
  }

  private async lock(id: string, ttl = LOCK_MS): Promise<(() => Promise<void>) | null> {
    const key = `tanva:vprod:lock:${id}`;
    const token = randomBytes(8).toString('hex');
    if (this.redis) {
      const ok = await this.redis.set(key, token, 'PX', ttl, 'NX');
      if (ok !== 'OK') return null;
      return async () => { await this.redis!.eval(`if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`, 1, key, token).catch(() => undefined); };
    }
    if (this.memoryLocks.has(key)) return null;
    this.memoryLocks.add(key);
    return async () => { this.memoryLocks.delete(key); };
  }

  private async mutate(id: string, userId: string, change: (row: Row, meta: JobMeta) => { status: string; meta: JobMeta; error?: string }) {
    await this.owned(id, userId);
    let release: (() => Promise<void>) | null = null;
    for (let i = 0; i < 40 && !release; i += 1) {
      release = await this.lock(id, 60_000);
      if (!release) await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!release) throw new ConflictException('任务正在处理（可能在合成中），请稍后再试');
    try {
      const row = await this.owned(id, userId);
      const meta = row.metadata as unknown as JobMeta;
      const next = change(row, meta);
      await this.prisma.videoTask.update({ where: { id }, data: { status: next.status, metadata: next.meta as any, error: next.error ?? null,
        ...(next.status === 'processing' ? { completedAt: null } : {}) } });
    } finally { await release(); }
    if ((await this.owned(id, userId)).status === 'processing') await this.schedule(id, 0);
    return this.view(await this.owned(id, userId));
  }

  /** 一次推进：查询在途步骤 → 提交就绪步骤 → 判断终态。每步状态先落库，重启后从断点继续，不重复提交。 */
  private async tick(id: string) {
    const release = await this.lock(id);
    if (!release) return;
    let again = false;
    try {
      const row = await this.prisma.videoTask.findUnique({ where: { id } });
      if (!row || row.taskType !== VIDEO_PRODUCTION_TASK_TYPE || row.status !== 'processing') return;
      const meta = row.metadata as unknown as JobMeta;
      const save = (data: Partial<{ status: string; error: string | null; result: any; completedAt: Date | null }> = {}) =>
        this.prisma.videoTask.update({ where: { id }, data: { metadata: meta as any, ...data } });
      try {
        if (meta.stage === 'planning') await this.advancePlanning(row, meta);
        if (meta.stage === 'producing') await this.advanceProduction(row, meta);
        if (meta.stage === 'composing') await this.compose(row, meta);
      } catch (error) {
        meta.stage = 'failed';
        await save({ status: 'failed', error: errMessage(error), completedAt: new Date() });
        return;
      }
      if (meta.stage === 'succeeded') {
        await save({ status: 'succeeded', error: null, completedAt: new Date(), result: { finalVideoUrl: meta.finalVideoUrl, clips: this.clipResults(meta) } });
      } else if (meta.stage === 'failed') {
        await save({ status: 'failed', error: this.failureSummary(meta), completedAt: new Date() });
      } else if (meta.stage === 'waiting_credits') {
        await save({ status: 'paused', error: `余额不足：预估需要 ${meta.estimate?.credits} 积分，当前余额 ${meta.estimate?.balance}。充值后调用继续生成。` });
      } else {
        await save();
        again = true;
      }
    } finally {
      await release();
      if (again) await this.schedule(id, TICK_MS);
    }
  }

  private async advancePlanning(row: Row, meta: JobMeta) {
    const { input } = meta;
    if (!meta.planTaskId) {
      if (input.kind === 'remake' && meta.sourceSeconds === undefined) {
        meta.sourceSeconds = await this.exec().probeDuration(input.referenceVideoUrl!).catch(() => 0);
      }
      // 复刻未指定画幅时跟随原片：规划缺省会给 16:9，竖屏原片被重新构图是穿帮的主要来源之一。
      if (input.kind === 'remake' && !input.aspectRatio) {
        const ratio = await this.sourceAspectRatio(input.referenceVideoUrl!);
        if (ratio) { input.aspectRatio = ratio; meta.warnings.push(`画幅跟随原片：${ratio}`); }
      }
      const requirement = [input.kind === 'remake' ? (input.requirements || REMAKE_DEFAULT_REQUIREMENT) : input.requirements,
        input.kind === 'film' && input.targetSeconds ? `成片总时长约 ${input.targetSeconds} 秒。` : undefined,
        input.aspectRatio ? `画幅 ${input.aspectRatio}。` : undefined].filter(Boolean).join('\n') || undefined;
      const options = this.plans.options();
      const created: any = await this.plans.create(row.userId, {
        mode: input.kind === 'remake' ? 'remake' : 'film',
        text: input.kind === 'film' ? input.story : (input.story || ''),
        requirement,
        assets: [...input.referenceImageUrls.map(url => ({ type: 'image', imageType: 'normal', url })),
          ...(input.referenceVideoUrl ? [{ type: 'video', url: input.referenceVideoUrl }] : [])],
        modelKey: input.planModel || options.defaultModel,
        reasoningEffort: 'none',
        ...(meta.sourceSeconds ? { sourceDurationSeconds: meta.sourceSeconds } : {}),
        clientRequestId: `${row.id}-plan-${meta.planAttempts ?? 0}`,
      }, input.teamId);
      meta.planTaskId = created.id;
      return;
    }
    const plan: any = await this.plans.get(meta.planTaskId, row.userId);
    if (plan.status === 'failed' || plan.status === 'canceled') throw new Error(`规划失败：${plan.error || plan.status}`);
    if (plan.status !== 'succeeded' || !plan.hasResult) return;
    const { nodes } = await this.plans.result(meta.planTaskId, row.userId);
    const inputs: Record<string, string> = {};
    input.referenceImageUrls.forEach((url, i) => { inputs[`input:${i + 1}`] = url; });
    const graph = buildProductionGraph(nodes as unknown as AssetPlanNode[], {
      inputs, videoModel: input.videoModel, imageModel: undefined,
      aspectRatio: input.aspectRatio || (input.kind === 'film' ? DEFAULT_FILM_RATIO : undefined), resolution: input.resolution,
    });
    const imageOption = input.imageModel ? findImageModel(input.imageModel) : undefined;
    graph.images = graph.images.map(image => applyImageModel(image, imageOption));
    if (!graph.clips.length) throw new Error('规划没有产出任何视频 Clip');
    meta.graph = graph;
    meta.warnings.push(...graph.warnings);
    graph.images.forEach(image => { meta.images[image.key] = { status: 'pending', attempts: 0 }; });
    graph.clips.forEach(clip => { meta.clips[clip.key] = { status: 'pending', attempts: 0 }; });
    meta.stage = 'producing';
    await this.checkCredits(row, meta);
  }

  /** 按分镜预估总积分（与实扣同一报价函数）；个人钱包余额不足时在生成前暂停。 */
  private async checkCredits(row: Row, meta: JobMeta) {
    const exec = this.exec();
    let total = 0; let partial = false;
    for (const image of meta.graph!.images) {
      const refs = image.refs.map(() => 'https://example.invalid/ref.png');
      const call = buildImageCall(image, refs, 'quote');
      const credits = await exec.quoteImage(row.userId, call.kind, call.dto).catch(() => null);
      if (typeof credits === 'number') total += credits; else partial = true;
    }
    for (const clip of meta.graph!.clips) {
      let dto: Record<string, any>;
      try { dto = buildVideoCall(clip, () => 'https://example.invalid/ref.png', { idempotencyKey: 'quote', clientNodeId: 'quote' }); }
      catch (error) { throw new Error(`${clip.title}：${errMessage(error)}`); }
      const credits = await exec.quoteVideo(row.userId, dto).catch(() => null);
      if (typeof credits === 'number') total += credits; else partial = true;
    }
    let balance: number | null = null;
    if (!meta.input.teamId) balance = (await this.credits.getOrCreateAccount(row.userId).catch(() => null))?.balance ?? null;
    meta.estimate = { credits: total, balance, partial };
    if (balance !== null && total > balance) meta.stage = 'waiting_credits';
  }

  private urlOf(meta: JobMeta, key: string): string | undefined {
    if (key === 'input:first') return meta.input.firstFrameUrl;
    const m = /^input:(\d+)$/.exec(key);
    if (m) return meta.input.referenceImageUrls[Number(m[1]) - 1];
    return meta.images[key]?.status === 'succeeded' ? meta.images[key].url : undefined;
  }

  private async advanceProduction(row: Row, meta: JobMeta) {
    const exec = this.exec();
    const graph = meta.graph!;
    const now = Date.now();
    const req = (key?: string) => sleepReq(row.userId, meta.input.teamId, key);

    // 1) 在途图片
    for (const image of graph.images) {
      const step = meta.images[image.key];
      if (step.status !== 'submitted' || !step.taskId) continue;
      const task = await exec.getImageTask(step.taskId, req()).catch(error => ({ status: 'unknown', error: errMessage(error) } as any));
      if (task.status === 'succeeded' && task.imageUrl) Object.assign(step, { status: 'succeeded', url: task.imageUrl, error: undefined });
      else if (task.status === 'failed' || task.status === 'cancelled') this.stepFailed(step, task.error || '生图失败');
      else if (now - (step.submittedAt ?? now) > IMAGE_TIMEOUT_MS) this.stepFailed(step, '生图超时', true);
    }
    // 2) 就绪图片：依赖的图片都已出图
    for (const wave of imageWaves(graph.images)) {
      for (const key of wave) {
        const image = graph.images.find(i => i.key === key)!;
        const step = meta.images[key];
        if (step.status !== 'pending') continue;
        const deps = image.refs.filter(ref => !ref.startsWith('input:'));
        if (deps.some(dep => meta.images[dep]?.status === 'failed')) { this.stepFailed(step, '依赖的参考图生成失败', true); continue; }
        if (deps.some(dep => meta.images[dep]?.status !== 'succeeded')) continue;
        const refUrls = image.refs.map(ref => this.urlOf(meta, ref)).filter((u): u is string => !!u);
        const call = buildImageCall(image, refUrls, `${row.id}-img-${graph.images.indexOf(image)}`);
        step.attempts += 1; step.submittedAt = Date.now();
        try {
          const created = await exec.submitImage(call.kind, call.dto, req());
          if (!created?.taskId) throw new Error('生图接口未返回 taskId');
          Object.assign(step, { status: 'submitted', taskId: created.taskId });
        } catch (error) { this.stepFailed(step, errMessage(error)); }
      }
    }
    // 3) 在途视频（查询接口本身负责结算 / 退款）
    for (const clip of graph.clips) {
      const step = meta.clips[clip.key];
      if (step.status !== 'submitted' || !step.taskId) continue;
      const task = await exec.getVideoTask('doubao', step.taskId, req()).catch(error => ({ status: 'unknown', error: errMessage(error) } as any));
      if (task.status === 'succeeded' && task.videoUrl) {
        step.url = await this.persistVideo(task.videoUrl, `video-productions/${row.userId}/${row.id}/clip-${graph.clips.indexOf(clip) + 1}.mp4`);
        Object.assign(step, { status: 'succeeded', error: undefined });
      } else if (task.status === 'failed') this.stepFailed(step, task.error || '视频生成失败');
      else if (now - (step.submittedAt ?? now) > CLIP_TIMEOUT_MS) this.stepFailed(step, '视频生成超时', true);
    }
    // 4) 就绪视频：首帧 / 参考图都已就绪
    for (const [index, clip] of graph.clips.entries()) {
      const step = meta.clips[clip.key];
      if (step.status !== 'pending') continue;
      const keys = clip.mode === 'first_frame' ? [clip.firstFrame!] : [...new Set([...clip.mentions.map(m => m.key), ...clip.references])];
      const imageKeys = keys.filter(k => !k.startsWith('input:'));
      if (imageKeys.some(k => meta.images[k]?.status === 'failed')) { this.stepFailed(step, '参考图生成失败', true); continue; }
      if (imageKeys.some(k => meta.images[k]?.status !== 'succeeded')) continue;
      step.attempts += 1; step.submittedAt = Date.now();
      // 幂等键：同一 Clip 同一次尝试重复提交时，后端返回原任务而不是再扣一次。
      const idempotencyKey = `vprod-${row.id}-c${index + 1}-a${step.attempts}`;
      try {
        const dto = buildVideoCall(clip, key => this.urlOf(meta, key), { idempotencyKey, clientNodeId: `${row.id}-clip-${index + 1}` });
        const created = await exec.submitVideo(dto, req(idempotencyKey));
        if (created?.videoUrl && !created.taskId) {
          step.url = await this.persistVideo(created.videoUrl, `video-productions/${row.userId}/${row.id}/clip-${index + 1}.mp4`);
          step.status = 'succeeded';
        } else if (created?.taskId) Object.assign(step, { status: 'submitted', taskId: created.taskId });
        else throw new Error('视频接口未返回 taskId');
      } catch (error) { this.stepFailed(step, errMessage(error), (error as Error)?.message?.includes('5000')); }
    }
    // 5) 终态判断
    const clipSteps = graph.clips.map(c => meta.clips[c.key]);
    if (clipSteps.some(s => s.status === 'pending' || s.status === 'submitted')) return;
    if (graph.images.some(i => meta.images[i.key].status === 'submitted')) return;
    meta.stage = clipSteps.every(s => s.status === 'succeeded') ? (clipSteps.length > 1 ? 'composing' : 'succeeded') : 'failed';
    if (meta.stage === 'succeeded') meta.finalVideoUrl = clipSteps[0].url;
  }

  private stepFailed(step: Step, error: string, final = false) {
    step.error = error.slice(0, 500);
    step.taskId = undefined;
    step.status = !final && step.attempts < MAX_ATTEMPTS ? 'pending' : 'failed';
  }

  // ------------------------------------------------------------- media

  private async download(url: string, file: string) {
    const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!response.ok || !response.body) throw new Error(`下载视频失败（HTTP ${response.status}）`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_VIDEO_BYTES) throw new Error('视频过大');
    let size = 0;
    const body = Readable.fromWeb(response.body as any);
    body.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_VIDEO_BYTES) body.destroy(new Error('视频过大')); });
    await pipeline(body, createWriteStream(file));
  }

  /** 生成结果转存 OSS，得到稳定地址；OSS 不可用时保留原地址。 */
  private async persistVideo(url: string, key: string): Promise<string> {
    if (!this.oss.isEnabled()) return url;
    const dir = await mkdtemp(join(tmpdir(), 'vprod-'));
    try {
      const file = join(dir, 'clip.mp4');
      await this.download(url, file);
      const { url: ossUrl } = await this.oss.putStream(key, createReadStream(file), { headers: { 'Content-Type': 'video/mp4' } });
      return ossUrl || url;
    } catch (error) {
      this.logger.warn(`persist video failed ${key}: ${errMessage(error)}`);
      return url;
    } finally { await rm(dir, { recursive: true, force: true }); }
  }

  private ffmpeg(args: string[], timeoutMs = 15 * 60_000) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
      let stderr = '';
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`ffmpeg 失败：${stderr.trim().slice(-300)}`)); });
    });
  }

  private probe(file: string, args: string[]) {
    return new Promise<string>(resolve => {
      const child = spawn('ffprobe', ['-v', 'error', ...args, '-of', 'csv=p=0', file]);
      let out = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.on('error', () => resolve(''));
      child.on('close', () => resolve(out.trim()));
    });
  }
  /** 原片显示画幅：读首个视频流宽高与旋转（iPhone .mov 常以横向编码 + 旋转 90° 存竖屏）。 */
  private sourceAspectRatio(url: string): Promise<string | undefined> {
    return new Promise(resolve => {
      const child = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_tags=rotate:stream_side_data=rotation', '-of', 'json', url]);
      let out = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
      child.stdout.on('data', chunk => { out += chunk; });
      child.on('error', () => { clearTimeout(timer); resolve(undefined); });
      child.on('close', () => {
        clearTimeout(timer);
        try {
          const stream = JSON.parse(out).streams?.[0] ?? {};
          const rotation = Number(stream.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ?? stream.tags?.rotate ?? 0);
          const swap = Math.abs(rotation) % 180 === 90;
          resolve(nearestVideoRatio(swap ? stream.height : stream.width, swap ? stream.width : stream.height));
        } catch { resolve(undefined); }
      });
    });
  }

  private async hasAudio(file: string) { return (await this.probe(file, ['-select_streams', 'a', '-show_entries', 'stream=index'])).length > 0; }
  /** 直接拼接（-c copy）要求各段编码参数完全一致，否则静默产出坏文件。 */
  private streamSignature(file: string) {
    return this.probe(file, ['-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,sample_rate,channels']);
  }

  /** 多段拼成一条：参数一致时直接拼接（不重编码），否则统一编码；全局同时只合成一个。 */
  private async compose(row: Row, meta: JobMeta) {
    const run = this.composing.then(async () => {
      const clips = meta.graph!.clips;
      const dir = await mkdtemp(join(tmpdir(), 'vprod-compose-'));
      try {
        const files: string[] = [];
        for (const [i, clip] of clips.entries()) {
          const file = join(dir, `c${i}.mp4`);
          await this.download(meta.clips[clip.key].url!, file);
          files.push(file);
        }
        const out = join(dir, 'final.mp4');
        const list = join(dir, 'list.txt');
        await writeFile(list, files.map(f => `file '${f}'`).join('\n'));
        const signatures = await Promise.all(files.map(f => this.streamSignature(f)));
        const copyable = signatures[0] !== '' && signatures.every(sig => sig === signatures[0]);
        try {
          if (!copyable) throw new Error('streams differ');
          await this.ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
        } catch {
          const [w, h] = this.frameSize(clips[0]);
          const audio = (await Promise.all(files.map(f => this.hasAudio(f)))).every(Boolean);
          const filters = files.map((_, i) => `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24[v${i}]`);
          const inputs = files.map((_, i) => `[v${i}]${audio ? `[${i}:a]` : ''}`).join('');
          filters.push(`${inputs}concat=n=${files.length}:v=1:a=${audio ? 1 : 0}[v]${audio ? '[a]' : ''}`);
          await this.ffmpeg([...files.flatMap(f => ['-i', f]), '-filter_complex', filters.join(';'), '-map', '[v]', ...(audio ? ['-map', '[a]', '-c:a', 'aac'] : []),
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '2', '-movflags', '+faststart', out]);
        }
        if ((await stat(out)).size === 0) throw new Error('合成结果为空');
        if (!this.oss.isEnabled()) throw new Error('OSS 未启用，无法保存成片');
        const { url } = await this.oss.putStream(`video-productions/${row.userId}/${row.id}/final.mp4`, createReadStream(out), { headers: { 'Content-Type': 'video/mp4' } });
        meta.finalVideoUrl = url;
        meta.stage = 'succeeded';
      } finally { await rm(dir, { recursive: true, force: true }); }
    });
    this.composing = run.catch(() => undefined);
    await run;
  }

  private frameSize(clip: GraphClip): [number, number] {
    const base = { '480P': 480, '720P': 720, '1080P': 1080, '4K': 2160 }[clip.resolution] ?? 720;
    const [a, b] = clip.aspectRatio.split(':').map(Number);
    const even = (n: number) => Math.round(n / 2) * 2;
    return a >= b ? [even((base * a) / b), base] : [base, even((base * b) / a)];
  }

  // ------------------------------------------------------------- views

  private async owned(id: string, userId: string): Promise<Row> {
    const row = typeof id === 'string' && id.length <= 64 ? await this.prisma.videoTask.findUnique({ where: { id } }) : null;
    if (!row || row.userId !== userId || row.taskType !== VIDEO_PRODUCTION_TASK_TYPE) throw new NotFoundException('成片任务不存在');
    return row;
  }

  private clipResults(meta: JobMeta) {
    return (meta.graph?.clips ?? []).map((clip, i) => ({ index: i + 1, title: clip.title, videoUrl: meta.clips[clip.key]?.url ?? null }));
  }

  private failureSummary(meta: JobMeta) {
    const failed = [...(meta.graph?.images ?? []).filter(i => meta.images[i.key]?.status === 'failed').map(i => `${i.title}：${meta.images[i.key].error}`),
      ...(meta.graph?.clips ?? []).filter(c => meta.clips[c.key]?.status === 'failed').map(c => `${c.title}：${meta.clips[c.key].error}`)];
    return failed.length ? `部分步骤失败（可重试失败部分）：${failed.slice(0, 5).join('；')}` : '生成失败';
  }

  private view(row: Row) {
    const meta = row.metadata as unknown as JobMeta;
    const graph = meta.graph;
    const count = (steps: Record<string, Step>) => {
      const all = Object.values(steps);
      return { total: all.length, succeeded: all.filter(s => s.status === 'succeeded').length, running: all.filter(s => s.status === 'submitted').length, failed: all.filter(s => s.status === 'failed').length };
    };
    const titleOf = (key: string) => key.startsWith('input:') ? (key === 'input:first' ? '首帧（用户提供）' : `参考图 ${key.slice(6)}（用户提供）`) : graph?.images.find(i => i.key === key)?.title ?? key;
    return {
      jobId: row.id, mode: meta.input.kind, status: row.status, stage: meta.stage, error: row.error ?? null,
      finalVideoUrl: meta.finalVideoUrl ?? null,
      progress: { images: count(meta.images), clips: count(meta.clips) },
      estimate: meta.estimate ?? null,
      storyboard: graph ? graph.clips.map((clip, i) => ({
        index: i + 1, key: clip.key, title: clip.title, durationSeconds: clip.durationSeconds, model: clip.seedanceModel, resolution: clip.resolution, aspectRatio: clip.aspectRatio,
        prompt: clip.prompt.length > 600 ? `${clip.prompt.slice(0, 600)}…` : clip.prompt,
        references: clip.mode === 'first_frame' ? [`首帧：${titleOf(clip.firstFrame!)}`] : clip.references.map(titleOf),
        status: meta.clips[clip.key]?.status, startedAt: meta.clips[clip.key]?.submittedAt ? new Date(meta.clips[clip.key]!.submittedAt!).toISOString() : null, videoUrl: meta.clips[clip.key]?.url ?? null, error: meta.clips[clip.key]?.error ?? null,
      })) : null,
      totalSeconds: graph ? graph.clips.reduce((sum, c) => sum + c.durationSeconds, 0) : null,
      images: graph ? graph.images.map(image => ({ key: image.key, title: image.title, model: image.model || image.nodeType, status: meta.images[image.key]?.status,
        imageUrl: meta.images[image.key]?.url ?? null, error: meta.images[image.key]?.error ?? null })) : [],
      warnings: meta.warnings,
      planTaskId: meta.planTaskId ?? null,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
}
