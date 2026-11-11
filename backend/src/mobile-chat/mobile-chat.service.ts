import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MobileMessage } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { XiaotAgentService } from '../agent/xiaot-agent.service';
import type { CreateAgentRunDto } from '../agent/dto/agent-run.dto';
import { VideoProductionService, VIDEO_PRODUCTION_TASK_TYPE } from '../video-production/video-production.service';
import {
  buildMobileManifest, collectUserUrls, composeUpstreamPrompt, MAX_MESSAGE_CHARS, MAX_RUNNING_JOBS,
  detailSectionPrompt, MOBILE_TOOL_DETAIL, MOBILE_TOOL_FILM, MOBILE_TOOL_IMAGE, MOBILE_TOOL_REMAKE, parseAttachments, titleFrom, toDetailRequest, toImageRequest, toProductionRequest,
  type JobBrief, type MobileAttachment,
} from './mobile-chat.protocol';
import { TextPump, TurnGate } from './mobile-chat.stream';
import { fetchImage, stitchVertical } from './mobile-chat.stitch';
import { OssService } from '../oss/oss.service';

export type TurnSink = (event: string, data: Record<string, unknown>) => void;
export interface PreparedTurn {
  userId: string; conversationId: string; text: string; attachments: MobileAttachment[];
  userMessage: MobileMessage; assistantMessage: MobileMessage; release: () => void;
}

export type ImageSetMeta = {
  title: string; aspectRatio: string;
  sections: Array<{ title: string; taskId: string | null; error?: string }>;
  longImageUrl?: string | null;
};

const insufficient = (message: string) => new HttpException({ statusCode: 402, code: 'INSUFFICIENT_CREDITS', message }, HttpStatus.PAYMENT_REQUIRED);

const errText = (error: unknown) => {
  const response = (error as { getResponse?: () => unknown })?.getResponse?.();
  const msg = response && typeof response === 'object' ? (response as { message?: unknown }).message : undefined;
  if (Array.isArray(msg)) return msg.join('；');
  if (typeof msg === 'string') return msg;
  return error instanceof Error ? error.message : String(error);
};

/** 上游报错里的内部称呼/实现细节不直接给手机用户看。 */
const friendlyError = (error: unknown) => {
  const raw = errText(error);
  if (/余额|积分|credits|402/i.test(raw)) return '积分余额不足，请充值后再试';
  if (/超时|timeout|aborted/i.test(raw)) return '回复超时，请稍后重试';
  if (/model_not_found|No available channel/i.test(raw)) return '对话模型渠道暂不可用，请联系客服处理';
  if (/inflight|进行中|turn_in_progress|409|429/i.test(raw)) return '当前排队较多，请稍后再试';
  return '对话服务暂时不可用，请稍后重试';
};

export const messageView = (m: MobileMessage) => ({
  id: m.id, role: m.role, kind: m.kind, content: m.content,
  attachments: Array.isArray(m.attachments) ? (m.attachments as unknown as MobileAttachment[]) : [],
  ...(m.kind === 'image' ? { aspectRatio: (m.attachments as any)?.aspectRatio ?? '1:1' } : {}),
  ...(m.kind === 'image_set' ? { imageSet: m.attachments as unknown as ImageSetMeta } : {}),
  jobId: m.jobId, status: m.status, createdAt: m.createdAt.toISOString(),
});

@Injectable()
export class MobileChatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MobileChatService.name);
  private readonly gate: TurnGate;
  private readonly minCredits: number;
  private readonly maxActiveProductions: number;
  private sweepTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly prisma: PrismaService, private readonly xiaot: XiaotAgentService,
    private readonly productions: VideoProductionService, @Optional() config?: ConfigService, @Optional() private readonly oss?: OssService) {
    const num = (key: string, fallback: number) => {
      const n = Number(config?.get<string>(key) ?? process.env[key]);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    this.gate = new TurnGate({
      maxConcurrent: num('MOBILE_CHAT_MAX_CONCURRENT', 40),
      perUserConcurrent: num('MOBILE_CHAT_USER_CONCURRENCY', 2),
      perUserPerMinute: num('MOBILE_CHAT_RATE_PER_MIN', 20),
    });
    this.minCredits = num('MOBILE_CHAT_MIN_CREDITS', 10);
    this.maxActiveProductions = num('MOBILE_MAX_ACTIVE_PRODUCTIONS', 30);
  }

  onModuleDestroy() { if (this.sweepTimer) clearInterval(this.sweepTimer); }

  async onModuleInit() {
    this.sweepTimer = setInterval(() => this.gate.sweep(), 5 * 60_000);
    this.sweepTimer.unref?.();
    // 单实例 fork 部署：启动时不可能有在飞回合，上次进程留下的 streaming 一律标为中断。
    await this.prisma.mobileMessage.updateMany({ where: { status: 'streaming' },
      data: { status: 'error', content: '服务重启，本条回复中断，请重新发送' } })
      .catch(error => this.logger.warn(`mobile chat recovery failed: ${errText(error)}`));
  }

  // ------------------------------------------------------------- conversations

  async list(userId: string, limit = 30) {
    const rows = await this.prisma.mobileConversation.findMany({ where: { userId, deletedAt: null },
      orderBy: { lastMessageAt: 'desc' }, take: Math.min(Math.max(limit, 1), 100) });
    return rows.map(r => ({ id: r.id, title: r.title, lastMessageAt: r.lastMessageAt.toISOString() }));
  }

  async create(userId: string) {
    const row = await this.prisma.mobileConversation.create({ data: { userId } });
    return { id: row.id, title: row.title, lastMessageAt: row.lastMessageAt.toISOString() };
  }

  private async owned(id: string, userId: string) {
    const row = await this.prisma.mobileConversation.findFirst({ where: { id, userId, deletedAt: null } });
    if (!row) throw new NotFoundException('会话不存在');
    return row;
  }

  async get(id: string, userId: string) {
    const row = await this.owned(id, userId);
    const messages = await this.prisma.mobileMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'asc' }, take: 500 });
    return { id: row.id, title: row.title, lastMessageAt: row.lastMessageAt.toISOString(), messages: messages.map(messageView) };
  }

  async rename(id: string, userId: string, title: unknown) {
    await this.owned(id, userId);
    if (typeof title !== 'string' || !title.trim()) throw new BadRequestException('标题不能为空');
    await this.prisma.mobileConversation.update({ where: { id }, data: { title: title.trim().slice(0, 60) } });
    return { ok: true };
  }

  async remove(id: string, userId: string) {
    await this.owned(id, userId);
    await this.prisma.mobileConversation.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  // ------------------------------------------------------------- turns

  /** 校验并落库用户消息与助手占位；校验失败以普通 HTTP 错误返回（尚未进入 SSE）。 */
  async prepareTurn(userId: string, conversationId: string, body: any): Promise<PreparedTurn> {
    const conversation = await this.owned(conversationId, userId);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (text.length > MAX_MESSAGE_CHARS) throw new BadRequestException(`消息过长（最多 ${MAX_MESSAGE_CHARS} 字）`);
    const attachments = parseAttachments(body?.attachments);
    if (!text && !attachments.length) throw new BadRequestException('请输入内容或添加附件');
    // 余额前置校验：对话每轮按网关订单或固定费结算，余额不足时不进上游，避免“回复成功但扣费失败”。
    const account = await this.prisma.creditAccount.findUnique({ where: { userId }, select: { balance: true } });
    if ((account?.balance ?? 0) < this.minCredits) throw insufficient(`积分余额不足（至少需要 ${this.minCredits} 积分），请充值后再试`);
    const release = this.gate.acquire(userId, conversationId);
    try {
      const now = new Date();
      const userMessage = await this.prisma.mobileMessage.create({ data: { conversationId, userId, role: 'user', kind: 'text',
        content: text, attachments: attachments.length ? (attachments as any) : undefined, createdAt: now } });
      const assistantMessage = await this.prisma.mobileMessage.create({ data: { conversationId, userId, role: 'assistant',
        kind: 'text', content: '', status: 'streaming', createdAt: new Date(now.getTime() + 1) } });
      await this.prisma.mobileConversation.update({ where: { id: conversationId }, data: { lastMessageAt: now,
        ...(conversation.title === '新会话' ? { title: titleFrom(text, attachments) } : {}) } });
      return { userId, conversationId, text, attachments, userMessage, assistantMessage, release };
    } catch (error) {
      release();
      throw error;
    }
  }

  /** 跑完一轮。sink 可在客户端断开后变成空操作，服务端照常跑完并落库。 */
  async runTurn(turn: PreparedTurn, sink: TurnSink): Promise<void> {
    const { userId, conversationId, assistantMessage } = turn;
    const toolRuns: Promise<void>[] = [];
    let finalText = '';
    let jobCount = 0;
    const pump = new TextPump((event, data) => sink(event, data as Record<string, unknown>),
      text => this.prisma.mobileMessage.updateMany({ where: { id: assistantMessage.id, status: 'streaming' }, data: { content: text } }));
    try {
      const history = await this.prisma.mobileMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' },
        select: { role: true, kind: true, content: true, attachments: true, jobId: true } });
      const userUrls = collectUserUrls(history.filter(m => m.role === 'user'));
      const jobs = await this.jobBriefs(userId, history.map(m => m.jobId).filter((id): id is string => !!id));
      const dto = {
        prompt: composeUpstreamPrompt(turn.text, turn.attachments, jobs),
        sessionId: `mobile:${conversationId}`,
        mode: 'canvasAgent',
        capabilityManifest: buildMobileManifest(),
      } as CreateAgentRunDto;

      const emit = (type: string, payload: { message?: string; data?: Record<string, unknown> }) => {
        if (type === 'host_tool') {
          const name = String(payload.data?.name || '');
          const args = (payload.data?.arguments as Record<string, unknown>) || {};
          if (name !== MOBILE_TOOL_FILM && name !== MOBILE_TOOL_REMAKE && name !== MOBILE_TOOL_IMAGE && name !== MOBILE_TOOL_DETAIL) return;
          jobCount += 1;
          sink('status', { text: name === MOBILE_TOOL_REMAKE ? '正在提交一键复刻…' : name === MOBILE_TOOL_IMAGE ? '正在提交生图…' : name === MOBILE_TOOL_DETAIL ? '正在提交详情页…' : '正在提交一键成片…' });
          toolRuns.push(name === MOBILE_TOOL_DETAIL
            ? this.executeDetailTool(userId, conversationId, args, userUrls, turn, `${assistantMessage.id}-${jobCount}`, sink)
            : name === MOBILE_TOOL_IMAGE
            ? this.executeImageTool(userId, conversationId, args, userUrls, turn, `${assistantMessage.id}-${jobCount}`, sink)
            : this.executeTool(userId, conversationId, name, args, userUrls, turn.attachments, sink));
        } else if (type === 'final') {
          finalText = typeof payload.message === 'string' ? payload.message : '';
        } else if (type === 'step_started' || type === 'run_started') {
          sink('status', { text: '思考中…' });
        }
        // flow_patch / host_ui / 其它画布事件：移动端没有画布，忽略。
      };
      await this.xiaot.run(dto, userId, emit as any, undefined, undefined, undefined, assistantMessage.id, pump);
      pump.flush();
      pump.close();
      await Promise.all(toolRuns);
      const content = finalText.trim() || pump.text.trim() || (jobCount ? '任务已提交，进度会在下方卡片实时更新。' : '（没有生成回复，请换个说法再试）');
      const saved = await this.prisma.mobileMessage.update({ where: { id: assistantMessage.id }, data: { content, status: 'done' } });
      sink('final', { message: messageView(saved) });
    } catch (error) {
      pump.close();
      await Promise.allSettled(toolRuns);
      this.logger.warn(`mobile chat turn failed ${conversationId}: ${errText(error)}`);
      const saved = await this.prisma.mobileMessage.update({ where: { id: assistantMessage.id },
        data: { content: friendlyError(error), status: 'error' } }).catch(() => null);
      sink('final', { message: saved ? messageView(saved) : { ...messageView(assistantMessage), status: 'error', content: friendlyError(error) } });
    } finally {
      pump.close();
      turn.release();
      await this.prisma.mobileConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } }).catch(() => undefined);
      sink('done', {});
    }
  }

  /** 生图：每张一个图片任务、一张卡片；计费在 image-tasks 内闭环（预扣、失败退款）。 */
  private async executeImageTool(userId: string, conversationId: string, args: Record<string, unknown>, userUrls: Set<string>,
    turn: PreparedTurn, idempotencyBase: string, sink: TurnSink): Promise<void> {
    let request: ReturnType<typeof toImageRequest>;
    try { request = toImageRequest(args, userUrls, turn.attachments); }
    catch (error) {
      const m = await this.prisma.mobileMessage.create({ data: { conversationId, userId, role: 'assistant', kind: 'error', content: `生成图片未提交：${errText(error)}` } });
      sink('message', { message: messageView(m) });
      return;
    }
    for (let i = 0; i < request.count; i += 1) {
      let message: MobileMessage;
      try {
        const { taskId } = await this.productions.submitUserImage(userId, { prompt: request.prompt, referenceImageUrls: request.referenceImageUrls,
          aspectRatio: request.aspectRatio, idempotencyKey: `${idempotencyBase}-${i + 1}` });
        message = await this.prisma.mobileMessage.create({ data: { conversationId, userId, role: 'assistant', kind: 'image',
          content: request.prompt.slice(0, 500), jobId: taskId, attachments: { aspectRatio: request.aspectRatio } as any } });
      } catch (error) {
        message = await this.prisma.mobileMessage.create({ data: { conversationId, userId, role: 'assistant', kind: 'error',
          content: `生成图片未提交：${errText(error)}` } });
      }
      sink('message', { message: messageView(message) });
    }
  }

  /** 详情页：每屏一个生图任务，合为一张 image_set 卡片；计费同单张生图。 */
  private async executeDetailTool(userId: string, conversationId: string, args: Record<string, unknown>, userUrls: Set<string>,
    turn: PreparedTurn, idempotencyBase: string, sink: TurnSink): Promise<void> {
    let message: MobileMessage;
    try {
      let req: ReturnType<typeof toDetailRequest>;
      try { req = toDetailRequest(args, userUrls, turn.attachments); }
      catch (error) { this.logger.warn(`detail page args rejected: ${JSON.stringify(args).slice(0, 1500)}`); throw error; }
      const sections = await Promise.all(req.sections.map(async (section, i) => {
        try {
          const { taskId } = await this.productions.submitUserImage(userId, { prompt: detailSectionPrompt(req, i),
            referenceImageUrls: req.referenceImageUrls, aspectRatio: req.aspectRatio, idempotencyKey: `${idempotencyBase}-s${i + 1}` });
          return { title: section.title, taskId };
        } catch (error) { return { title: section.title, taskId: null, error: errText(error) }; }
      }));
      if (sections.every(s => !s.taskId)) throw new Error(sections[0]?.error || '详情页任务未受理');
      const meta: ImageSetMeta = { title: req.title, aspectRatio: req.aspectRatio, sections, longImageUrl: null };
      message = await this.prisma.mobileMessage.create({ data: { conversationId, userId, role: 'assistant', kind: 'image_set',
        content: req.title, attachments: meta as any } });
    } catch (error) {
      message = await this.prisma.mobileMessage.create({ data: { conversationId, userId, role: 'assistant', kind: 'error',
        content: `详情页未提交：${errText(error)}` } });
    }
    sink('message', { message: messageView(message) });
  }

  /** 把详情页各屏按顺序拼成一张长图并转存；已拼过直接返回。 */
  async stitch(userId: string, messageId: string) {
    const message = await this.prisma.mobileMessage.findFirst({ where: { id: messageId, userId, kind: 'image_set' } });
    if (!message) throw new NotFoundException('详情页不存在');
    const meta = message.attachments as unknown as ImageSetMeta;
    if (meta.longImageUrl) return messageView(message);
    if (!this.oss?.isEnabled()) throw new ConflictException('存储未启用，无法保存长图');
    const urls: string[] = [];
    for (const section of meta.sections) {
      if (!section.taskId) throw new ConflictException(`「${section.title}」未生成，无法拼接`);
      const task = await this.productions.imageTaskStatus(userId, section.taskId);
      if (task.status !== 'succeeded' || !task.imageUrl) throw new ConflictException(`「${section.title}」还没生成完`);
      urls.push(task.imageUrl);
    }
    const buffers = await Promise.all(urls.map(fetchImage));
    const { buffer } = await stitchVertical(buffers);
    const { url } = await this.oss.putBuffer(`mobile-chat/${userId}/${messageId}/detail-long.jpg`, buffer, 'image/jpeg');
    if (!url) throw new ConflictException('长图保存失败');
    const saved = await this.prisma.mobileMessage.update({ where: { id: messageId }, data: { attachments: { ...meta, longImageUrl: url } as any } });
    return messageView(saved);
  }

  private async executeTool(userId: string, conversationId: string, name: string, args: Record<string, unknown>,
    userUrls: Set<string>, turnAttachments: MobileAttachment[], sink: TurnSink): Promise<void> {
    let message: MobileMessage;
    try {
      const request = toProductionRequest(name, args, userUrls, turnAttachments);
      const running = await this.prisma.videoTask.count({ where: { userId, taskType: VIDEO_PRODUCTION_TASK_TYPE, status: { in: ['queued', 'processing'] } } });
      if (running >= MAX_RUNNING_JOBS) throw new ConflictException(`同时最多进行 ${MAX_RUNNING_JOBS} 个成片任务，请等当前任务完成后再提交`);
      // 全站在跑的成片任务上限：保护合成（ffmpeg）、下载与上游并发。
      const busy = await this.prisma.videoTask.count({ where: { taskType: VIDEO_PRODUCTION_TASK_TYPE, status: { in: ['queued', 'processing'] } } });
      if (busy >= this.maxActiveProductions) throw new ConflictException('当前生成排队的人较多，请过几分钟再试');
      // 个人钱包（第一期不接团队钱包）；报价、预扣、结算、退款都在 video-productions 内闭环。
      const job = await this.productions.create(userId, request, undefined);
      message = await this.prisma.mobileMessage.create({ data: { conversationId, userId, role: 'assistant', kind: 'job',
        content: name === MOBILE_TOOL_REMAKE ? '一键复刻' : '一键成片', jobId: job.jobId } });
    } catch (error) {
      message = await this.prisma.mobileMessage.create({ data: { conversationId, userId, role: 'assistant', kind: 'error',
        content: `${name === MOBILE_TOOL_REMAKE ? '一键复刻' : '一键成片'}未提交：${errText(error)}` } });
    }
    sink('message', { message: messageView(message) });
  }

  private async jobBriefs(userId: string, ids: string[]): Promise<JobBrief[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.videoTask.findMany({ where: { id: { in: ids }, userId, taskType: VIDEO_PRODUCTION_TASK_TYPE }, orderBy: { createdAt: 'asc' } });
    return rows.map(row => {
      const meta = (row.metadata || {}) as any;
      return { jobId: row.id, mode: meta.input?.kind || 'film', stage: meta.stage || row.status, finalVideoUrl: meta.finalVideoUrl ?? null, error: row.error };
    });
  }
}
