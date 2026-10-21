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
  /** Detected hard cuts inside this segment (absolute seconds). */
  cuts?: number[];
  /** The segment starts mid-shot: no cut was found near the target boundary. */
  continuesPrevious?: boolean;
}
const TARGET_SEGMENT_SEC = 30;
const MIN_SEGMENT_SEC = 20;
const MAX_SEGMENT_SEC = 36;
/** Ark samples input_video at 1fps by default; 2fps resolves sub-second cuts without large token growth. */
export const VIDEO_ANALYSIS_FPS = 2;
const round1 = (value: number) => Math.round(value * 10) / 10;
/** Splits near 30s but snaps each boundary to a detected hard cut so one shot is never analysed twice. */
export function planVideoAnalysisSegments(duration: number, cuts: number[] = []): VideoAnalysisSegment[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new BadRequestException('视频时长必须为正数');
  const sorted = [...new Set(cuts.filter(cut => cut > 0 && cut < duration))].sort((a, b) => a - b);
  const segments: VideoAnalysisSegment[] = [];
  let start = 0; let continuesPrevious = false;
  while (start < duration) {
    let end = duration; let nextContinues = false;
    if (duration - start > MAX_SEGMENT_SEC) {
      const candidates = sorted.filter(cut => cut >= start + MIN_SEGMENT_SEC && cut <= start + MAX_SEGMENT_SEC);
      if (candidates.length) end = candidates.reduce((best, cut) => Math.abs(cut - start - TARGET_SEGMENT_SEC) < Math.abs(best - start - TARGET_SEGMENT_SEC) ? cut : best);
      else { end = start + TARGET_SEGMENT_SEC; nextContinues = true; }
    }
    segments.push({ index: segments.length, startSec: start, endSec: end, status: 'pending',
      cuts: sorted.filter(cut => cut > start + 0.2 && cut < end - 0.2), ...(continuesPrevious ? { continuesPrevious: true } : {}) });
    start = end; continuesPrevious = nextContinues;
  }
  return segments;
}
export function videoSegmentPrompt(prompt: string, segment: VideoAnalysisSegment, duration: number, segments: VideoAnalysisSegment[] = []): string {
  const hints: string[] = [];
  if (segment.cuts) {
    hints.push(segment.cuts.length
      ? `程序场景检测到本段硬切点（原视频绝对时间）：${segment.cuts.map(cut => `${round1(cut)}s`).join('、')}。镜头边界优先对齐这些时间点；相邻切点之间若画面主体、景别、机位未变化则属同一镜头，不要按时间平均拆分，也不要把跨越切点的不同画面合并为一个镜头。叠化/淡入淡出等软切换可能未被检测，以画面实际为准。`
      : '程序场景检测未在本段发现硬切点：除非画面明确切换（叠化/淡入淡出等软切换），本段应视为同一镜头，不要按时间平均拆分镜头。');
  }
  if (segment.continuesPrevious) hints.push(`本段开头 ${segment.startSec}s 不是剪辑点，第一个镜头是上一段镜头的延续，程序会自动合并：照常输出该镜头，时间区间从 ${segment.startSec}s 开始。`);
  if (segments[segment.index + 1]?.continuesPrevious) hints.push(`本段结尾 ${round1(segment.endSec)}s 不是剪辑点，最后一个镜头在下一段继续：时间区间写到 ${round1(segment.endSec)}s 即可。`);
  return `${prompt}

【视频分段上下文】原视频总时长 ${duration} 秒。本次素材仅为原视频 ${round1(segment.startSec)}–${round1(segment.endSec)} 秒，第 ${segment.index + 1} 段。完整执行以上用户要求，仅报告本段实际可见/可听内容；所有时间码使用原视频绝对时间（本段局部时间加 ${round1(segment.startSec)} 秒），统一写作“12.3s”格式。不要推测其他片段，不要将缺失上下文当作原视频缺失。${hints.length ? `\n${hints.join('\n')}` : ''}`;
}
const SHOT_BLOCK = /={3,}\s*单镜头开始\s*={3,}([\s\S]*?)(?:={3,}\s*单镜头结束\s*={3,}|(?==+\s*单镜头开始)|$)/g;
const SHOT_RANGE = /^(\s*时间区间[^：:\n]*[：:]\s*)(.*?)\s*$/m;
const TIMELINE_START = /^\s*(?:---\s*镜头内时序细分[^\n]*|时间段\s*[：:])/m;
/** Appends a continued shot's timeline and dialogue onto the shot it continues, extending its range. */
function joinContinuedShot(previous: string, next: string): string {
  const endOf = (block: string) => /([\d.]+)\s*s?\s*$/.exec(SHOT_RANGE.exec(block)?.[2] || '')?.[1];
  const nextEnd = endOf(next);
  let joined = nextEnd ? previous.replace(SHOT_RANGE, (_, prefix, range) => `${prefix}${range.replace(/[\d.]+\s*s?\s*$/, `${nextEnd}s`)}`) : previous;
  const dialogue = (block: string) => /^\s*台词文本\s*[：:]\s*(.*)$/m.exec(block)?.[1]?.trim() || '';
  const nextDialogue = dialogue(next);
  if (nextDialogue && !/^【?无台词】?$/.test(nextDialogue) && !dialogue(joined).includes(nextDialogue)) {
    joined = joined.replace(/^(\s*台词文本\s*[：:]\s*)(.*)$/m, (_, prefix, text) => /^【?无台词】?$/.test(text.trim()) ? `${prefix}${nextDialogue}` : `${prefix}${text.trim()} ${nextDialogue}`);
  }
  const marker = next.search(TIMELINE_START);
  if (marker < 0) return joined;
  const timeline = next.slice(marker).replace(/^\s*---[^\n]*\n?/, '').trim();
  return `${joined.trimEnd()}\n\n${timeline}`;
}
export function mergeVideoAnalysisSegments(segments: VideoAnalysisSegment[]): string {
  const completed = [...segments].sort((a, b) => a.index - b.index).filter(s => s.status === 'succeeded');
  const blocksOf = (text: string) => Array.from(text.matchAll(SHOT_BLOCK), match => match[1].trim()).filter(Boolean);
  if (completed.length && completed.every(segment => blocksOf(segment.text || '').length)) {
    const shots: string[] = [];
    completed.forEach((segment, position) => {
      const blocks = blocksOf(segment.text || '').map(block => block.replace(/(\d+(?:\.\d+)?)\s+s\b/g, '$1s'));
      const contiguous = completed[position - 1]?.index === segment.index - 1;
      if (segment.continuesPrevious && contiguous && shots.length) shots.push(joinContinuedShot(shots.pop()!, blocks.shift()!));
      shots.push(...blocks);
    });
    const bodies = shots.map((block, index) => `=========单镜头开始=========\n${block
      .replace(/^(\s*镜号\s*[：:]\s*)\S+/m, (_, prefix) => `${prefix}M${String(index + 1).padStart(3, '0')}`)}\n=========单镜头结束=========`);
    return `【镜头总览】\n总镜数：${shots.length}\n素材总时长：${Math.max(...completed.map(segment => segment.endSec))}s\n\n${bodies.join('\n\n')}`;
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
      // Analysis proxy: Ark caps frames near 0.67MP, so 4K/60fps only costs transcode and upload time.
      const proxy = join(directory, 'proxy.mp4');
      const cuts = await this.transcodeProxy(source, proxy, durationSec);
      const segments: VideoAnalysisSegment[] = meta.segments?.length ? meta.segments : planVideoAnalysisSegments(durationSec, cuts);
      await this.save(taskId, { durationSec, sourceHash, sceneCuts: cuts, segments });
      for (const segment of segments) {
        if (segment.videoUrl || segment.status === 'succeeded') continue;
        let output = proxy;
        if (segments.length > 1) {
          output = join(directory, `${segment.index}.mp4`);
          await this.cut(proxy, output, segment.startSec, segment.endSec - segment.startSec);
        }
        const key = `ai/video-analysis/${taskId}/segment-${segment.index}.mp4`;
        const upload = await this.oss.putStream(key, createReadStream(output), { headers: { 'Content-Type': 'video/mp4' } });
        segment.videoUrl = upload.url;
        if (output !== proxy) await fs.rm(output, { force: true });
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
            videoFps: VIDEO_ANALYSIS_FPS, prompt: videoSegmentPrompt(request.prompt || '分析视频内容', segment, meta.durationSec, segments) });
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

  private run(args: string[], timeoutMs: number, onStderr?: (chunk: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', ['-nostdin', '-y', ...args]);
      let stderr = ''; child.stderr.on('data', value => { onStderr?.(String(value)); stderr = (stderr + value).slice(-1000); });
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('视频分段处理超时')); }, timeoutMs);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`视频分段失败：${stderr}`)); });
    });
  }
  /** Decodes the source once: writes a ≤960px/10fps proxy and returns detected hard-cut times. */
  private async transcodeProxy(source: string, output: string, durationSec: number): Promise<number[]> {
    const cuts: number[] = []; let pending = ''; let frameTime = NaN;
    const scale = "scale='if(gte(iw,ih),min(960,trunc(iw/2)*2),-2)':'if(gte(iw,ih),-2,min(960,trunc(ih/2)*2))'";
    // select=gte(scene,0) keeps every frame but attaches lavfi.scene_score for metadata=print.
    await this.run(['-i', source, '-vf', `${scale},fps=10,select='gte(scene,0)',metadata=print:key=lavfi.scene_score`,
      '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-g', '10', '-c:a', 'aac', '-b:a', '96k', '-ac', '1', '-movflags', '+faststart', output],
      Math.max(120_000, durationSec * 4_000), chunk => {
        const lines = (pending + chunk).split('\n'); pending = lines.pop() || '';
        for (const line of lines) {
          const time = /Parsed_metadata.*pts_time:\s*([\d.]+)/.exec(line)?.[1];
          if (time) { frameTime = Number(time); continue; }
          const score = /lavfi\.scene_score=([\d.]+)/.exec(line)?.[1];
          if (score && Number(score) >= 0.3 && Number.isFinite(frameTime)) cuts.push(frameTime);
        }
      });
    return cuts.filter((cut, index) => Number.isFinite(cut) && (index === 0 || cut - cuts[index - 1] >= 0.3));
  }
  private cut(source: string, output: string, start: number, duration: number): Promise<void> {
    return this.run(['-ss', String(start), '-i', source, '-t', String(duration), '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', output], 120_000);
  }
}
