import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaService } from '../../prisma/prisma.service';
import { OssService } from '../../oss/oss.service';
import { ReferenceVideoDurationService } from './reference-video-duration.service';
import type { AnalyzeVideoDto } from '../dto/video-analysis.dto';
import type { IAIProvider, VideoAnalysisRequest, AIProviderResponse, VideoAnalysisResult } from '../providers/ai-provider.interface';

const QUEUE = 'video-analysis-tasks';
const TYPE = 'video-analysis';
export interface VideoAnalysisSegment {
  index: number; startSec: number; endSec: number;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  videoUrl?: string; text?: string; usage?: any; error?: string;
}
export function planVideoAnalysisSegments(duration: number): VideoAnalysisSegment[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new BadRequestException('视频时长必须为正数');
  return Array.from({ length: Math.ceil(duration / 30) }, (_, index) => ({
    index, startSec: index * 30, endSec: Math.min(duration, (index + 1) * 30), status: 'pending',
  }));
}
export function videoSegmentPrompt(prompt: string, segment: VideoAnalysisSegment, duration: number): string {
  return `${prompt}\n\n【视频分段上下文】原视频总时长 ${duration} 秒。本次素材仅为原视频 ${segment.startSec}–${segment.endSec} 秒，第 ${segment.index + 1} 段。完整执行以上用户要求，仅报告本段实际可见/可听内容；所有时间码使用原视频绝对时间（本段局部时间加 ${segment.startSec} 秒）。不要推测其他片段，不要将缺失上下文当作原视频缺失。`;
}
export function mergeVideoAnalysisSegments(segments: VideoAnalysisSegment[]): string {
  const completed = [...segments].sort((a, b) => a.index - b.index).filter(s => s.status === 'succeeded');
  if (completed.length && completed.every(segment => /={3,}\s*单镜头开始\s*={3,}/.test(segment.text || '') && /={3,}\s*单镜头结束\s*={3,}/.test(segment.text || ''))) {
    let count = 0;
    const bodies = completed.map(segment => (segment.text || '')
      .replace(/^\s*【镜头总览】\s*$/gm, '')
      .replace(/^\s*(?:总镜数|素材总时长)\s*[：:].*$/gm, '')
      .replace(/^(\s*镜号\s*[：:]\s*)\S+/gm, (_, prefix) => `${prefix}M${String(++count).padStart(3, '0')}`).trim());
    return `【镜头总览】\n总镜数：${count}\n素材总时长：${Math.max(...completed.map(segment => segment.endSec))}s\n\n${bodies.join('\n\n')}`;
  }
  const tables = completed.map(segment => (segment.text || '').trim().split('\n').map(line => line.trim()).filter(Boolean));
  const isSeparator = (line: string) => /^\|?[\s:|-]+\|?$/.test(line) && line.includes('---');
  if (tables.length && tables.every(lines => lines.length >= 2 && lines[0] === tables[0][0] && isSeparator(lines[1]) && lines.every(line => line.startsWith('|') && line.endsWith('|')))) {
    let number = 0;
    const renumber = /序号|镜头|编号/.test(tables[0][0].split('|')[1] || '');
    return [tables[0][0], tables[0][1], ...tables.flatMap(lines => lines.slice(2).filter(line => line !== tables[0][0] && !isSeparator(line)).map(line =>
      renumber ? line.replace(/^(\|\s*)\d+(\s*\|)/, (_, prefix, suffix) => `${prefix}${++number}${suffix}`) : line))].join('\n');
  }
  return completed
    .map(s => `### 原视频 ${s.startSec}–${s.endSec} 秒\n${s.text || ''}`).join('\n\n');
}

@Injectable()
export class VideoAnalysisTaskService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoAnalysisTaskService.name);
  private queue!: Queue;
  private worker!: Worker;
  private execution = new AsyncLocalStorage<{ taskId: string; token: string }>();
  private executor?: (dto: AnalyzeVideoDto, req: any, taskId: string) => Promise<any>;
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService,
    private readonly oss: OssService, private readonly media: ReferenceVideoDurationService) {}

  registerExecutor(executor: NonNullable<VideoAnalysisTaskService['executor']>) { this.executor = executor; }
  onModuleInit() {
    const connection = { url: this.config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379' };
    this.queue = new Queue(QUEUE, { connection, defaultJobOptions: { attempts: 1, removeOnComplete: 200, removeOnFail: 500 } });
    this.worker = new Worker(QUEUE, job => this.execute(job.data.taskId), { connection, concurrency: 2, maxStalledCount: 0 });
    this.worker.on('error', error => this.logger.warn(`Video analysis queue error: ${error.message}`));
    this.worker.on('failed', (job, error) => {
      if (job) void job.getState().then(state => state === 'failed' ? this.fail(job.data.taskId, error.message) : undefined).catch(() => undefined);
    });
  }
  async onModuleDestroy() { await this.worker?.close(); await this.queue?.close(); }

  private async owned(taskId: string, userId: string) {
    const row = await this.prisma.videoTask.findUnique({ where: { id: taskId } });
    if (!row || row.userId !== userId || row.taskType !== TYPE) throw new NotFoundException('视频分析任务不存在');
    return row;
  }
  private view(row: any) {
    const meta = row.metadata || {};
    const segments: VideoAnalysisSegment[] = meta.segments || [];
    return { taskId: row.id, status: row.status, stage: meta.stage || 'queued', durationSec: meta.durationSec,
      progress: { completed: segments.filter(s => s.status === 'succeeded').length, total: segments.length },
      segments: segments.map(({ index, startSec, endSec, status, error }) => ({ index, startSec, endSec, status, error })),
      result: row.status === 'succeeded' ? row.result : undefined, error: row.error || undefined,
      partialAnalysis: mergeVideoAnalysisSegments(segments), attempt: meta.attempt || 1 };
  }
  async get(taskId: string, userId: string) {
    let row = await this.owned(taskId, userId);
    if (['queued', 'processing'].includes(row.status) && this.queue) {
      try {
        const job = await this.queue.getJob(taskId);
        const state = job ? await job.getState() : 'missing';
        if (state === 'failed' || state === 'completed' || (state === 'missing' && Date.now() - row.updatedAt.getTime() > 30_000)) {
          await this.fail(taskId, job?.failedReason || '后台任务已中断，已完成片段已保存，请点击重试恢复');
          row = await this.owned(taskId, userId);
        }
      } catch { return { ...this.view(row), pollingWarning: '任务队列暂时不可访问，请稍后继续查询' }; }
    }
    return this.view(row);
  }

  async submit(dto: AnalyzeVideoDto, req: any, userId: string) {
    if (!this.queue) throw new ServiceUnavailableException('视频分析队列尚未就绪');
    const teamId = req.headers?.['x-team-id'];
    if (teamId && !req.apiClient) {
      const membership = await this.prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId } } });
      if (!membership) throw new BadRequestException('当前账号不属于该出资团队');
    }
    const request = { videoUrl: dto.videoUrl, prompt: dto.prompt, model: dto.model, providerOptions: dto.providerOptions,
      bananaImageRoute: dto.bananaImageRoute, channelHint: dto.channelHint };
    const hash = createHash('sha256').update(JSON.stringify({ request, teamId: req.headers?.['x-team-id'] || null, projectId: dto.projectId || null })).digest('hex');
    if (dto.resumeTaskId) {
      const row = await this.owned(dto.resumeTaskId, userId);
      const meta = row.metadata as any;
      if (meta.requestHash !== hash) throw new ConflictException('恢复任务的素材、模型和提示词必须保持一致');
      if (row.status !== 'failed') return this.view(row);
      const oldJob = await this.queue.getJob(row.id);
      if (oldJob && ['active', 'waiting', 'delayed'].includes(await oldJob.getState())) return this.view(row);
      // Preserve every completed segment and the previous attempt receipt.
      const accepted = await this.prisma.videoTask.updateMany({ where: { id: row.id, status: 'failed', updatedAt: row.updatedAt }, data: { status: 'queued', error: null, completedAt: null,
        metadata: { ...meta, stage: 'queued', attempt: (meta.attempt || 1) + 1,
          attempts: [...(meta.attempts || []), { attempt: meta.attempt || 1, stage: meta.stage, segments: meta.segments || [], error: row.error, completedAt: row.completedAt?.toISOString() }] } } });
      if (!accepted.count) return this.get(row.id, userId);
      try {
        if (oldJob && await oldJob.getState() === 'failed') await oldJob.retry('failed');
        else if (oldJob) { await oldJob.remove(); await this.queue.add('analyze', { taskId: row.id }, { jobId: row.id }); }
        else await this.queue.add('analyze', { taskId: row.id }, { jobId: row.id });
      } catch { await this.fail(row.id, '恢复任务入队失败，片段结果已保留，请再次点击重试'); }
      return this.get(row.id, userId);
    }
    const identity = dto.clientRequestId ? createHash('sha256').update(`${userId}\n${dto.clientRequestId}`).digest('hex') : randomUUID();
    const taskId = `va-${identity}`;
    const previous = await this.prisma.videoTask.findUnique({ where: { id: taskId } });
    if (previous) {
      if (previous.userId !== userId || (previous.metadata as any)?.requestHash !== hash) throw new ConflictException('重复请求的参数不一致');
      return this.view(previous);
    }
    const billingRequest = { user: req.user ? { id: req.user.id || req.user.sub } : undefined, apiClient: req.apiClient ? { id: userId } : undefined,
      ip: req.ip, headers: { 'x-team-id': req.headers?.['x-team-id'], 'user-agent': req.headers?.['user-agent'] } };
    try {
      await this.prisma.videoTask.create({ data: { id: taskId, userId, nodeId: dto.nodeId, taskType: TYPE,
        prompt: dto.prompt, status: 'queued', metadata: { request, requestHash: hash, billingRequest, projectId: dto.projectId, stage: 'queued', segments: [], attempt: 1 } as any } });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const raced = await this.owned(taskId, userId);
        if ((raced.metadata as any)?.requestHash !== hash) throw new ConflictException('重复请求的参数不一致');
        return this.view(raced);
      }
      throw error;
    }
    try { await this.queue.add('analyze', { taskId }, { jobId: taskId }); }
    catch { await this.fail(taskId, '视频分析任务入队失败，请点击重试恢复'); }
    return this.get(taskId, userId);
  }

  private async save(taskId: string, patch: Record<string, any>) {
    const row = await this.prisma.videoTask.findUniqueOrThrow({ where: { id: taskId } });
    const claim = this.execution.getStore();
    const where: any = { id: taskId };
    if (claim) { where.status = 'processing'; where.metadata = { path: ['executionToken'], equals: claim.token }; }
    const changed = await this.prisma.videoTask.updateMany({ where, data: { metadata: { ...(row.metadata as any), ...patch } } });
    if (!changed.count) throw new ConflictException('该执行尝试已结束，请查询当前任务');
  }
  private async fail(taskId: string, message: string) {
    await this.prisma.videoTask.updateMany({ where: { id: taskId, status: { not: 'succeeded' } },
      data: { status: 'failed', error: message, completedAt: new Date() } });
  }
  private async execute(taskId: string) {
    const row = await this.prisma.videoTask.findUniqueOrThrow({ where: { id: taskId } });
    if (row.status !== 'queued') return;
    const meta = row.metadata as any;
    const token = randomUUID();
    const claimed = await this.prisma.videoTask.updateMany({ where: { id: taskId, status: 'queued', updatedAt: row.updatedAt },
      data: { status: 'processing', error: null, metadata: { ...meta, executionToken: token } } });
    if (!claimed.count) return;
    return this.execution.run({ taskId, token }, async () => { try {
      if (!this.executor) throw new ServiceUnavailableException('视频分析执行器尚未就绪');
      const result = await this.executor(meta.request, meta.billingRequest, taskId);
      await this.prisma.videoTask.updateMany({ where: { id: taskId, status: 'processing', metadata: { path: ['executionToken'], equals: token } }, data: { status: 'succeeded', result, completedAt: new Date() } });
    } catch (error: any) {
      await this.prisma.videoTask.updateMany({ where: { id: taskId, status: 'processing', metadata: { path: ['executionToken'], equals: token } }, data: { status: 'failed', error: error?.message || '视频分析失败', completedAt: new Date() } });
      throw error;
    } });
  }

  async prepare(taskId: string, videoUrl: string): Promise<number> {
    const row = await this.prisma.videoTask.findUniqueOrThrow({ where: { id: taskId } });
    const meta = row.metadata as any;
    if (meta.durationSec && meta.segments?.every((s: VideoAnalysisSegment) => s.videoUrl || s.status === 'succeeded')) return meta.durationSec;
    await this.save(taskId, { stage: 'splitting' });
    const directory = await fs.mkdtemp(join(tmpdir(), 'tanva-video-analysis-'));
    try {
      const source = join(directory, 'source');
      await this.media.downloadToFile(videoUrl, source, 500 * 1024 * 1024);
      const sourceDigest = createHash('sha256');
      for await (const chunk of createReadStream(source)) sourceDigest.update(chunk);
      const sourceHash = sourceDigest.digest('hex');
      if (meta.sourceHash && meta.sourceHash !== sourceHash) throw new ConflictException('原视频内容已发生变化，请发起新的分析任务');
      const durationSec = await this.media.probeLocalFile(source);
      const segments: VideoAnalysisSegment[] = meta.segments?.length ? meta.segments : planVideoAnalysisSegments(durationSec);
      await this.save(taskId, { durationSec, sourceHash, segments });
      for (const segment of segments) {
        if (segment.videoUrl || segment.status === 'succeeded') continue;
        if (segments.length === 1) { segment.videoUrl = videoUrl; }
        else {
          const output = join(directory, `${segment.index}.mp4`);
          await this.cut(source, output, segment.startSec, segment.endSec - segment.startSec);
          const key = `ai/video-analysis/${taskId}/segment-${segment.index}.mp4`;
          const upload = await this.oss.putStream(key, createReadStream(output), { headers: { 'Content-Type': 'video/mp4' } });
          segment.videoUrl = upload.url;
          await fs.rm(output, { force: true });
        }
        await this.save(taskId, { segments });
      }
      return durationSec;
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }

  async analyze(taskId: string, provider: IAIProvider, request: VideoAnalysisRequest): Promise<AIProviderResponse<VideoAnalysisResult>> {
    const row = await this.prisma.videoTask.findUniqueOrThrow({ where: { id: taskId } });
    const meta = row.metadata as any;
    const segments: VideoAnalysisSegment[] = meta.segments;
    let checkpoint = Promise.resolve();
    const save = () => { const snapshot = JSON.parse(JSON.stringify(segments)); checkpoint = checkpoint.then(() => this.save(taskId, { segments: snapshot, stage: 'analyzing' })); return checkpoint; };
    let cursor = 0;
    const failures: string[] = [];
    const run = async () => {
      while (cursor < segments.length) {
        const segment = segments[cursor++];
        if (segment.status === 'succeeded') continue;
        segment.status = 'processing'; delete segment.error; await save();
        try {
          const result = await provider.analyzeVideo!({ ...request, videoUrl: segment.videoUrl,
            prompt: videoSegmentPrompt(request.prompt || '分析视频内容', segment, meta.durationSec) });
          if (!result.success || !result.data?.text?.trim()) throw new Error(result.error?.message || '该片段未返回分析文本');
          segment.text = result.data.text; segment.usage = result.data.metadata?.raw?.usage || result.data.metadata?.usage;
          segment.status = 'succeeded';
        } catch (error: any) { segment.status = 'failed'; segment.error = error?.message || '片段分析失败'; failures.push(segment.error!); }
        await save();
      }
    };
    await Promise.all([run(), run()]);
    if (failures.length) throw new ServiceUnavailableException(`有 ${failures.length} 个片段分析失败；已完成片段已保存，点击重试仅继续未完成片段。${failures[0]}`);
    const text = mergeVideoAnalysisSegments(segments);
    const usage = segments.reduce((sum, s) => ({ prompt_tokens: sum.prompt_tokens + Number(s.usage?.prompt_tokens || s.usage?.input_tokens || 0),
      completion_tokens: sum.completion_tokens + Number(s.usage?.completion_tokens || s.usage?.output_tokens || 0) }), { prompt_tokens: 0, completion_tokens: 0 });
    await this.save(taskId, { stage: 'settling', analysisCheckpoint: { text, usage } });
    return { success: true as const, data: { text, metadata: { raw: { usage }, analysisMode: 'segmented_remote_input_video', segments: segments.length } } };
  }

  private cut(source: string, output: string, start: number, duration: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', ['-nostdin', '-y', '-ss', String(start), '-i', source, '-t', String(duration), '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', output]);
      let stderr = ''; child.stderr.on('data', value => { stderr = (stderr + value).slice(-1000); });
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('视频分段处理超时')); }, 120_000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`视频分段失败：${stderr}`)); });
    });
  }
}
