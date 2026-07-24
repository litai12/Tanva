// 经 Tanva new-api 渠道流式调用小T（xiaot-agent 模型），把标准 chat.completion.chunk
// 翻译成 AgentRunEvent 推给前端；按终帧 usage 扣积分。
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreditsService } from '../credits/credits.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAgentRunDto } from './dto/agent-run.dto';
import { AgentEventType } from './agent.types';

type XiaotEmit = (
  type: AgentEventType,
  payload: { title?: string; message?: string; data?: Record<string, unknown> },
) => void;

type ChatMessage = { role: 'system' | 'user'; content: string };

/** 按 tool_call index 累积的分片缓冲（兼容 arguments 跨帧分片的 OpenAI 协议形态）。 */
type ToolCallAccumulator = { id: string; name: string; args: string };

/** 前端可透传的小T对话模型白名单（前端选择器将来对齐此常量）。 */
export const XIAOT_CHAT_MODELS = [
  'xiaot-agent-gpt-5-4',
  'xiaot-agent-gpt-5-5',
] as const;
const DEFAULT_XIAOT_CHAT_MODEL = XIAOT_CHAT_MODELS[0];

@Injectable()
export class XiaotAgentService {
  private readonly logger = new Logger(XiaotAgentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly creditsService: CreditsService,
    private readonly prisma: PrismaService,
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
    const configured = this.config.get<string>('XIAOT_AGENT_MODEL')?.trim();
    return configured &&
      (XIAOT_CHAT_MODELS as readonly string[]).includes(configured)
      ? configured
      : DEFAULT_XIAOT_CHAT_MODEL;
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
    if (dto.generationContract) {
      messages.push({
        role: 'system',
        content: `<generation_contract>${JSON.stringify(dto.generationContract)}</generation_contract>`,
      });
    }
    // 风格参考图：拼进 prompt 前缀，指示小T把它接入生成节点 img 输入
    const prompt = dto.styleReferenceUrl
      ? `【风格参考图】${dto.styleReferenceUrl}（把它接入生成节点的 img 输入作为风格参考）\n${dto.prompt}`
      : dto.prompt;
    messages.push({ role: 'user', content: prompt });
    return messages;
  }

  /**
   * 判定是否为"真团队"（存在且非个人团队）。对齐 credits 侧口径
   * `teamId = (activeTeam && !activeTeam.isPersonal) ? activeTeam.id : null`；
   * 个人空间(isPersonal)或空 header 一律返 null，走个人隔离分支。
   */
  private async resolveRealTeamId(teamId?: string): Promise<string | null> {
    const id = typeof teamId === 'string' ? teamId.trim() : '';
    if (!id) return null;
    try {
      const team = await this.prisma.team.findUnique({
        where: { id },
        select: { isPersonal: true },
      });
      return team && team.isPersonal === false ? id : null;
    } catch {
      return null;
    }
  }

  async run(
    dto: CreateAgentRunDto,
    userId: string,
    emit: XiaotEmit,
    teamId?: string,
  ): Promise<void> {
    // 模型透传：仅白名单内的 dto.model 生效，其余一律回落默认模型。
    const model =
      dto.model && (XIAOT_CHAT_MODELS as readonly string[]).includes(dto.model)
        ? dto.model
        : this.model;

    // 记忆/skill/画像隔离维度：真团队 → 全团队共享同一空间；个人模式 → 每用户独立。
    // 前缀防 team/user id 命名空间相撞。
    const realTeamId = await this.resolveRealTeamId(teamId);
    const hostScopeId = realTeamId ? `team:${realTeamId}` : `user:${userId}`;
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
          user: dto.sessionId || `tanva:${userId}`, // 会话级隔离（不变）
          // 记忆/skill/画像隔离维度：facade 读此字段拼进传给 agents-cli 的 userId 按此分叉。
          // 与 user(会话)正交。团队模式=team:${teamId}(成员共享)，个人模式=user:${userId}(独立)。
          // **关键**：顶层 host_user_id 会被 new-api 的 GeneralOpenAIRequest 固定结构体丢弃（无该字段、
          // 无兜底 map）→ 到 facade 恒空 → 所有 Tanva 用户塌缩同一 owner 目录、记忆互串。故主通道走
          // metadata.host_user_id（OpenAI 标准字段，new-api 结构体有 Metadata、原样透传）；顶层保留只为
          // 直连 facade(绕过 new-api)的调用方兜底。facade 优先读 metadata、回落顶层。
          metadata: { host_user_id: hostScopeId },
          host_user_id: hostScopeId,
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

            // 累积对所有 name 通用，flush 时按 name 分派。
            if (
              acc.name !== 'flow_patch' &&
              acc.name !== 'host_tool' &&
              acc.name !== 'host_ui'
            )
              continue;
            let parsedArgs: unknown;
            try {
              parsedArgs = JSON.parse(acc.args);
            } catch {
              continue; // 分片未齐，等后续帧补齐后再试
            }
            toolCallBuffers.delete(index);
            if (!parsedArgs || typeof parsedArgs !== 'object') continue;
            if (acc.name === 'flow_patch') {
              patchCount += 1;
              emit('flow_patch', {
                data: { patch: parsedArgs as Record<string, unknown> },
              });
            } else if (acc.name === 'host_tool') {
              const args = parsedArgs as Record<string, unknown>;
              if (typeof args.name !== 'string') continue;
              emit('host_tool', {
                data: {
                  name: args.name,
                  arguments:
                    args.arguments && typeof args.arguments === 'object'
                      ? args.arguments
                      : {},
                },
              });
            } else {
              // host_ui：协议 v1.1 富格式卡片，必须带 string 类型 kind（choices/suggestions/media）。
              const args = parsedArgs as Record<string, unknown>;
              if (typeof args.kind !== 'string') continue;
              emit('host_ui', {
                data: { kind: args.kind, payload: args.payload },
              });
            }
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

      await this.settleCredits(userId, usageUnits, model, {
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
    model: string,
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
        model,
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
