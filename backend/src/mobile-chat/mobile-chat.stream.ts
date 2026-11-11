// 移动端回合的并发闸门与实时文本泵（纯逻辑，便于单测）。
// 部署为单实例 fork（ecosystem.config.js instances=1），计数放进程内即可；改多实例时需换 Redis。
import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { XIAOT_DURABLE_CONTINUATION_PLACEHOLDER } from '../agent/xiaot-agent-recovery';

export interface TurnLimits {
  /** 全站同时进行的对话回合（每个回合占一条上游流）。 */
  maxConcurrent: number;
  /** 单用户同时进行的回合（跨会话）。 */
  perUserConcurrent: number;
  /** 单用户每分钟可发送的消息数。 */
  perUserPerMinute: number;
}

const tooMany = (message: string) => new HttpException({ statusCode: 429, message }, HttpStatus.TOO_MANY_REQUESTS);

export class TurnGate {
  private readonly conversations = new Set<string>();
  private readonly users = new Map<string, number>();
  private readonly sent = new Map<string, number[]>();
  private active = 0;

  constructor(private readonly limits: TurnLimits, private readonly now: () => number = Date.now) {}

  get activeTurns() { return this.active; }

  /** 通过则占位并返回释放函数（只生效一次）；不通过直接抛错，不占位。 */
  acquire(userId: string, conversationId: string): () => void {
    if (this.conversations.has(conversationId)) throw new ConflictException('上一条消息还在处理中，请稍候');
    const now = this.now();
    const recent = (this.sent.get(userId) ?? []).filter(t => now - t < 60_000);
    if (recent.length >= this.limits.perUserPerMinute) throw tooMany('发送太频繁了，请稍等一会儿再试');
    if ((this.users.get(userId) ?? 0) >= this.limits.perUserConcurrent) throw tooMany(`你已有 ${this.limits.perUserConcurrent} 条消息在处理中，请等回复完成后再发`);
    if (this.active >= this.limits.maxConcurrent) throw tooMany('当前使用人数较多，请稍后再试');
    recent.push(now);
    this.sent.set(userId, recent);
    this.conversations.add(conversationId);
    this.users.set(userId, (this.users.get(userId) ?? 0) + 1);
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.conversations.delete(conversationId);
      const left = (this.users.get(userId) ?? 1) - 1;
      if (left > 0) this.users.set(userId, left); else this.users.delete(userId);
      this.active -= 1;
    };
  }

  /** 清理一分钟前的发送记录，避免长期运行时 Map 只增不减。 */
  sweep() {
    const now = this.now();
    for (const [user, times] of this.sent) {
      const recent = times.filter(t => now - t < 60_000);
      if (recent.length) this.sent.set(user, recent); else this.sent.delete(user);
    }
  }
}

/** 续接占位语（“任务仍在处理中…”）不给用户看：它随后会被回放结果替换。 */
export function visibleText(raw: string): string {
  const p = XIAOT_DURABLE_CONTINUATION_PLACEHOLDER;
  const i = raw.indexOf(p);
  if (i >= 0) return raw.slice(0, i).trimEnd();
  // 占位语正在逐字到达时先压住尾巴，避免闪现半句。
  for (let k = Math.min(raw.length, p.length - 1); k >= 4; k -= 1) {
    if (raw.endsWith(p.slice(0, k))) return raw.slice(0, raw.length - k).trimEnd();
  }
  return raw;
}

export type PumpSink = (event: 'delta' | 'text', data: { text?: string; content?: string }) => void;

/**
 * 实时文本泵：上游增量先进缓冲，按 flushMs 合并下发，减少 SSE 帧数；
 * 能接上已发送内容时发增量（delta），否则（回放重置 / 占位剔除）发整段快照（text）。
 * 每 persistMs 回调一次 persist，把阶段性正文落库，断线重进也能看到进度。
 */
export class TextPump {
  private raw = '';
  private sentText = '';
  private persisted = '';
  private flushTimer?: ReturnType<typeof setTimeout>;
  private persistTimer?: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(private readonly sink: PumpSink, private readonly persist: (text: string) => Promise<unknown>,
    private readonly flushMs = 60, persistMs = 2000) {
    this.persistTimer = setInterval(() => { void this.persistNow(); }, persistMs);
  }

  get text() { return visibleText(this.raw); }

  delta(text: string) { if (this.closed) return; this.raw += text; this.schedule(); }
  reset() { if (this.closed) return; this.raw = ''; this.schedule(); }

  private schedule() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = undefined; this.flush(); }, this.flushMs);
  }

  flush() {
    const display = this.text;
    if (display === this.sentText) return;
    if (display.startsWith(this.sentText)) this.sink('delta', { text: display.slice(this.sentText.length) });
    else this.sink('text', { content: display });
    this.sentText = display;
  }

  private async persistNow() {
    const display = this.text;
    if (display === this.persisted) return;
    this.persisted = display;
    await this.persist(display).catch(() => undefined);
  }

  close() {
    this.closed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.persistTimer) clearInterval(this.persistTimer);
    this.flushTimer = undefined;
    this.persistTimer = undefined;
  }
}
