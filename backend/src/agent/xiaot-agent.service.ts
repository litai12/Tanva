// 经 Tanva new-api 渠道流式调用小T（xiaot-agent 模型），把标准 chat.completion.chunk
// 翻译成 AgentRunEvent 推给前端；按终帧 usage 扣积分。
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreditsService } from '../credits/credits.service';
import { CreateAgentRunDto } from './dto/agent-run.dto';
import { AgentEventType } from './agent.types';

type XiaotEmit = (
  type: AgentEventType,
  payload: { title?: string; message?: string; data?: Record<string, unknown> },
) => void;

type ChatMessage = { role: 'system' | 'user'; content: string };

/** 按 tool_call index 累积的分片缓冲（兼容 arguments 跨帧分片的 OpenAI 协议形态）。 */
type ToolCallAccumulator = { id: string; name: string; args: string };

@Injectable()
export class XiaotAgentService {
  private readonly logger = new Logger(XiaotAgentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly creditsService: CreditsService,
  ) {}

  private get baseUrl(): string {
    const raw =
      this.config.get<string>('NEW_API_BASE_URL') || 'http://localhost:4458';
    return raw.trim().replace(/\/+$/, '');
  }

  private get apiKey(): string {
    return (
      this.config.get<string>('NEW_API_KEY') ||
      this.config.get<string>('NEW_API_TOKEN') ||
      ''
    );
  }

  private get model(): string {
    return this.config.get<string>('XIAOT_AGENT_MODEL') || 'xiaot-agent';
  }

  /**
   * 每 1000 usage 单位折多少 Tanva 积分。
   * 注意：xiaot-agent 的 usage.total_tokens 不是 token 数，而是**小T侧实扣的 TapCanvas 积分**
   * （单回合封顶其预扣额，默认 20）。默认 1000 即两边积分 1:1；上线前按实际汇率调
   * XIAOT_AGENT_CREDITS_PER_1K（例如 Tanva 积分是 TapCanvas 的 2 倍价值则设 500）。
   */
  private get creditsPerKUnit(): number {
    const parsed = Number(
      this.config.get<string>('XIAOT_AGENT_CREDITS_PER_1K') || '1000',
    );
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1000;
  }

  /** 上游没给 usage 时的兜底整次计费。 */
  private get fallbackPerRun(): number {
    const parsed = Number(
      this.config.get<string>('XIAOT_AGENT_CREDITS_PER_RUN') || '5',
    );
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5;
  }

  /** 流式总时长上限（毫秒），默认 15 分钟；超时 abort 整个请求。 */
  private get timeoutMs(): number {
    const parsed = Number(
      this.config.get<string>('XIAOT_AGENT_TIMEOUT_MS') || '900000',
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 900000;
  }

  private buildMessages(dto: CreateAgentRunDto): ChatMessage[] {
    const messages: ChatMessage[] = [];
    if (dto.capabilityManifest) {
      messages.push({
        role: 'system',
        content: `<capability_manifest>${JSON.stringify(dto.capabilityManifest)}</capability_manifest>`,
      });
    }
    if (dto.canvasContext) {
      messages.push({
        role: 'system',
        content: `<canvas_context>${JSON.stringify(dto.canvasContext)}</canvas_context>`,
      });
    }
    messages.push({ role: 'user', content: dto.prompt });
    return messages;
  }

  async run(dto: CreateAgentRunDto, userId: string, emit: XiaotEmit): Promise<void> {
    const model = this.model;
    emit('run_started', {
      title: '小T已接入',
      data: { model },
    });

    // 流式总时长上限：超时 abort fetch/reader，异常沿现有 catch 路径转成 error+done 事件。
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          stream: true,
          // OpenAI 流式 usage 惯例：不带这个经 new-api 转发时 usage 终帧可能不回，计费恒走 fallback。
          stream_options: { include_usage: true },
          user: dto.sessionId || `tanva:${userId}`,
          messages: this.buildMessages(dto),
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        let detail = '';
        try {
          detail = (await response.text()).slice(0, 300);
        } catch {}
        throw new Error(
          `xiaot-agent upstream error: status=${response.status} body=${detail}`,
        );
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      // 跨 read 的行缓冲：一次 read 可能截断在行中间。
      let buffer = '';
      let fullText = '';
      let patchCount = 0;
      let usageUnits = 0;
      // 小T facade 通常"每帧完整下发一个 tool_call"（arguments 一次给全），走单帧直解路径；
      // 但标准 OpenAI 协议允许 arguments 按同 index 跨帧分片，所以 parse 失败时按 index 累积、
      // 后续帧补齐后再试，成功即 emit 并清该 index——两种形态都覆盖。
      const toolCallBuffers = new Map<number, ToolCallAccumulator>();

      const handleLine = (rawLine: string) => {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;

        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          return;
        }
        if (parsed?.error) {
          throw new Error(
            `xiaot-agent stream error: ${JSON.stringify(parsed.error).slice(0, 300)}`,
          );
        }

        const delta = parsed?.choices?.[0]?.delta;
        if (delta?.content && typeof delta.content === 'string') {
          fullText += delta.content;
          emit('assistant_delta', { data: { delta: delta.content } });
        }

        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const index = typeof tc?.index === 'number' ? tc.index : 0;
            let acc = toolCallBuffers.get(index);
            // 同 index 出现新 id 时视为新的一次 tool_call，重置累积器。
            if (acc && tc?.id && acc.id && tc.id !== acc.id) {
              acc = undefined;
            }
            if (!acc) {
              acc = { id: '', name: '', args: '' };
              toolCallBuffers.set(index, acc);
            }
            if (tc?.id) acc.id = tc.id;
            if (tc?.function?.name) acc.name += tc.function.name;
            if (typeof tc?.function?.arguments === 'string') {
              acc.args += tc.function.arguments;
            }

            if (acc.name !== 'flow_patch') continue;
            let patch: unknown;
            try {
              patch = JSON.parse(acc.args);
            } catch {
              continue; // 分片未齐，等后续帧补齐后再试
            }
            toolCallBuffers.delete(index);
            if (!patch || typeof patch !== 'object') continue;
            patchCount += 1;
            emit('flow_patch', {
              data: { patch: patch as Record<string, unknown> },
            });
          }
        }

        const totalTokens = parsed?.usage?.total_tokens;
        if (typeof totalTokens === 'number' && Number.isFinite(totalTokens)) {
          usageUnits = Math.max(usageUnits, totalTokens);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          handleLine(line);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        handleLine(buffer);
      }

      await this.settleCredits(userId, usageUnits, {
        textChars: fullText.length,
        patchCount,
      });

      emit('final', {
        message: fullText,
        data: { text: fullText, patchCount, usageUnits },
      });
      emit('done', {});
    } finally {
      clearTimeout(timeout);
      // 兜底释放上游 socket（正常读完 cancel 是幂等 no-op）。
      void reader?.cancel().catch(() => {});
    }
  }

  private async settleCredits(
    userId: string,
    usageUnits: number,
    meta: Record<string, unknown>,
  ): Promise<void> {
    const amount =
      usageUnits > 0
        ? Math.max(1, Math.ceil((usageUnits / 1000) * this.creditsPerKUnit))
        : this.fallbackPerRun;
    if (amount <= 0) return;
    try {
      await this.creditsService.deductExact(userId, null, amount, {
        serviceType: 'agent-chat',
        serviceName: 'xiaot-agent',
        provider: 'new-api',
        model: this.model,
        requestParams: { usageUnits, ...meta },
      });
    } catch (error) {
      // v1 取舍：回复已经完整送达前端，扣费失败只记日志不回滚/不中断，
      // 避免用户看到"内容成功但报错"的割裂体验；后续可加异步补扣。
      this.logger.error(
        `xiaot-agent settleCredits failed for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
