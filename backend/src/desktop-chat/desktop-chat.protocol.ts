import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DeepSeekPricingSnapshot } from './deepseek-pricing';

export const DESKTOP_CHAT_MODEL = 'deepseek-v4.1-flash';
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 10 * 60_000;
export type DesktopScope = { kind: 'personal' } | { kind: 'team'; teamId: string };
export type ReceiptStatus = 'pending' | 'completed' | 'failed' | 'reconciliation_required';
export interface DesktopChatMeta {
  requestId: string; taskId: string; conversationId: string; bodyHash: string;
  scope: DesktopScope; state: ReceiptStatus; deadline: string;
  credits: number; rejectionConfirmed?: boolean; completedAt?: string; errorCode?: string; response?: Record<string, any>;
  billing?: {
    mode: 'official_token_usage'; snapshot: DeepSeekPricingSnapshot;
    reservation: { inputTokens: number; outputTokens: number; credits: number };
    markup: 1.5; creditsPerYuan: 100; priceCurrency: 'CNY'; rounding: 'ceil'; period: 'peak' | 'off_peak'; pricingVersion: string;
    officialCostCny?: string; exactCredits?: string; exactCreditNanos?: string;
    upstreamRequestId?: string;
    usage?: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
  };
}
export const canonicalJson = (value: any): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const usageId = (userId: string, requestId: string) => `desktop-chat:${hash(`${userId}:${requestId}`)}`;
export const identifier = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) throw new BadRequestException(`无效 ${name}`);
  return value;
};
/** Preserve arbitrary supported Chat Completions options and complete tool history. */
export function validateCompletion(body: any): Record<string, any> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('请求必须为JSON对象');
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_REQUEST_BYTES) throw new PayloadTooLargeException('模型请求超过4 MiB');
  if (body.model !== DESKTOP_CHAT_MODEL) throw new BadRequestException('模型未在Tanva桌面目录启用');
  if (body.stream === true) throw new BadRequestException('Tanva桌面对话使用完整JSON回执');
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.some((item: any) => !item || !['system', 'developer', 'user', 'assistant', 'tool'].includes(item.role))) throw new BadRequestException('无效对话消息');
  if (body.reasoning_effort !== undefined) throw new BadRequestException('此模型未声明推理强度参数');
  return { ...body, stream: false };
}
export function receipt(row: any, includeResponse = false) {
  const meta = row.requestParams?.desktopChat as DesktopChatMeta;
  const state: ReceiptStatus = meta.state === 'pending' && Date.now() > Date.parse(meta.deadline) ? 'reconciliation_required' : meta.state;
  const funded = meta.scope.kind === 'team';
  const amount = state === 'failed' ? 0 : meta.credits;
  const metered = !!meta.billing;
  const pending = state === 'pending' || state === 'reconciliation_required';
  return {
    requestId: meta.requestId, apiUsageId: row.id, taskId: meta.taskId,
    conversationId: meta.conversationId, model: row.model, scope: meta.scope, status: state,
    creditsCharged: metered ? (state === 'completed' ? amount : 0) : funded && state !== 'completed' ? 0 : amount,
    creditsReserved: (funded || metered) && pending ? (meta.billing?.reservation.credits ?? amount) : 0,
    unit: 'credits' as const, createdAt: new Date(row.createdAt).toISOString(),
    ...(meta.billing ? { billing: meta.billing } : {}),
    ...(meta.completedAt ? { completedAt: meta.completedAt } : {}),
    ...(meta.errorCode ? { errorCode: meta.errorCode } : {}),
    ...(includeResponse && state === 'completed' ? { response: meta.response } : {}),
  };
}
