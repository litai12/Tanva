// 经 Tanva new-api 渠道流式调用小T（xiaot-agent 模型），把标准 chat.completion.chunk
// 翻译成 AgentRunEvent 推给前端；完整成功的对话固定扣费，生成/分析宿主任务由各自链路另行计费。
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreditsService } from '../credits/credits.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAgentRunDto } from './dto/agent-run.dto';
import { AgentEventType } from './agent.types';
import {
  assertXiaotUpstreamDelivery,
  buildXiaotUpstreamSessionUser,
} from './xiaot-agent-delivery';

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
  'xiaot-agent-gpt-5-6-luna',
  'xiaot-agent-deepseek-v4-flash',
] as const;
const DEFAULT_XIAOT_CHAT_MODEL = XIAOT_CHAT_MODELS[0];

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 小T 自身每个成功对话回合的 Tanva 固定积分。 */
export const XIAOT_CHAT_CREDITS_PER_RUN = 2;

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
      const requestBody = {
        model,
        stream: true,
        // OpenAI 流式 usage 惯例：请求终帧 usage 供运营审计，不参与固定对话计费。
        stream_options: { include_usage: true },
        // v2 hard cutover: v1 upstream histories may contain repeated tool-schema
        // failures. Keep those records intact but never feed them into a v2 turn.
        user: buildXiaotUpstreamSessionUser(dto.sessionId, userId),
        metadata: { host_user_id: hostScopeId },
        host_user_id: hostScopeId,
        messages: this.buildMessages(dto),
      };
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
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
      let hostToolCount = 0;
      let hostUiCount = 0;
      let usageUnits = 0;
      let finishReason: string | null = null;
      let doneReceived = false;
      // 小T facade 通常"每帧完整下发一个 tool_call"（arguments 一次给全），走单帧直解路径；
      // 但标准 OpenAI 协议允许 arguments 按同 index 跨帧分片，所以 parse 失败时按 index 累积、
      // 后续帧补齐后再试，成功即 emit 并清该 index——两种形态都覆盖。
      const toolCallBuffers = new Map<number, ToolCallAccumulator>();

      const handleLine = (rawLine: string) => {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload) return;
        if (payload === '[DONE]') {
          doneReceived = true;
          return;
        }
        if (doneReceived) {
          throw new Error('xiaot-agent protocol error: received data after [DONE]');
        }

        let parsedValue: unknown;
        try {
          parsedValue = JSON.parse(payload) as unknown;
        } catch {
          throw new Error('xiaot-agent protocol error: invalid JSON data frame');
        }
        const parsed = readRecord(parsedValue);
        if (!parsed) {
          throw new Error('xiaot-agent protocol error: data frame must be an object');
        }
        if (parsed.error) {
          throw new Error(
            `xiaot-agent stream error: ${JSON.stringify(parsed.error).slice(0, 300)}`,
          );
        }

        const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
        const choice = readRecord(choices[0]);
        const delta = readRecord(choice?.delta);
        if (typeof delta?.content === 'string' && delta.content) {
          fullText += delta.content;
          emit('assistant_delta', { data: { delta: delta.content } });
        }

        if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const toolCall = readRecord(tc);
            const toolFunction = readRecord(toolCall?.function);
            const index = typeof toolCall?.index === 'number' ? toolCall.index : 0;
            let acc = toolCallBuffers.get(index);
            // 同 index 出现新 id 时视为新的一次 tool_call，重置累积器。
            if (
              acc &&
              typeof toolCall?.id === 'string' &&
              toolCall.id &&
              acc.id &&
              toolCall.id !== acc.id
            ) {
              acc = undefined;
            }
            if (!acc) {
              acc = { id: '', name: '', args: '' };
              toolCallBuffers.set(index, acc);
            }
            if (typeof toolCall?.id === 'string' && toolCall.id) acc.id = toolCall.id;
            if (typeof toolFunction?.name === 'string') acc.name += toolFunction.name;
            if (typeof toolFunction?.arguments === 'string') {
              acc.args += toolFunction.arguments;
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
              if (typeof args.name !== 'string' || !args.name.trim()) continue;
              hostToolCount += 1;
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
              if (typeof args.kind !== 'string' || !args.kind.trim()) continue;
              hostUiCount += 1;
              emit('host_ui', {
                data: { kind: args.kind, payload: args.payload },
              });
            }
          }
        }

        const totalTokens = readRecord(parsed.usage)?.total_tokens;
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

      assertXiaotUpstreamDelivery({
        text: fullText,
        patchCount,
        hostToolCount,
        hostUiCount,
        incompleteToolCallCount: toolCallBuffers.size,
        finishReason,
        doneReceived,
      });

      await this.settleCredits(userId, usageUnits, model, {
        textChars: fullText.length,
        patchCount,
        hostToolCount,
        hostUiCount,
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
    try {
      await this.creditsService.deductExact(
        userId,
        null,
        XIAOT_CHAT_CREDITS_PER_RUN,
        {
          serviceType: 'agent-chat',
          serviceName: 'xiaot-agent',
          provider: 'new-api',
          model,
          requestParams: {
            billingMode: 'fixed_per_completed_run',
            chatCredits: XIAOT_CHAT_CREDITS_PER_RUN,
            // 仅保留上游 usage 作运营审计，不再参与 Tanva 对话计费。
            usageUnits,
            ...meta,
          },
        },
      );
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
