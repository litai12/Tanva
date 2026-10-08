import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DeepSeekPricingSnapshot } from './deepseek-pricing';

export const DESKTOP_CHAT_MODEL = 'deepseek-v4.1-flash';
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 10 * 60_000;
export type DesktopScope = { kind: 'personal' } | { kind: 'team'; teamId: string };
export type ReceiptStatus = 'pending' | 'completed' | 'failed' | 'reconciliation_required';
export interface GatewayDesktopBilling {
  mode: 'gateway_consumption'; markup: 1; creditsPerYuan: 100;
  priceCurrency: 'CNY'; rounding: 'ceil'; reservation: { credits: 0 };
  upstreamRequestId?: string;
}
export interface LegacyDesktopBilling {
  mode: 'official_token_usage'; snapshot: DeepSeekPricingSnapshot;
  reservation: { inputTokens: number; outputTokens: number; credits: number };
  markup: 1.5; creditsPerYuan: 100; priceCurrency: 'CNY'; rounding: 'ceil'; period: 'peak' | 'off_peak'; pricingVersion: string;
  officialCostCny?: string; exactCredits?: string; exactCreditNanos?: string;
  upstreamRequestId?: string;
  usage?: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
}
export interface DesktopChatMeta {
  requestId: string; taskId: string; conversationId: string; bodyHash: string;
  scope: DesktopScope; state: ReceiptStatus; deadline: string;
  credits: number; rejectionConfirmed?: boolean; completedAt?: string; errorCode?: string; errorMessage?: string; upstreamStatus?: number; response?: Record<string, any>;
  billing?: LegacyDesktopBilling | GatewayDesktopBilling;
}
export const canonicalJson = (value: any): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const usageId = (userId: string, requestId: string) => `desktop-chat:${hash(`${userId}:${requestId}`)}`;

export interface DesktopChatDiagnostic { errorCode: string; errorMessage: string; upstreamStatus?: number }
const DIAGNOSTICS: Record<string, string> = {
  UPSTREAM_INVALID_REQUEST: '模型网关拒绝请求参数，请检查输入与模型能力',
  UPSTREAM_AUTH_FAILED: '模型网关鉴权失败，请联系管理员检查网关凭据与权限',
  UPSTREAM_QUOTA_EXHAUSTED: '模型网关可用额度不足，请联系管理员检查上游账户',
  UPSTREAM_MODEL_UNAVAILABLE: '模型网关未提供请求的模型或可用渠道',
  UPSTREAM_PROTOCOL_UNSUPPORTED: '模型网关不支持当前请求协议',
  UPSTREAM_REQUEST_TOO_LARGE: '模型网关拒绝过大的请求，请减少输入内容',
  UPSTREAM_RATE_LIMITED: '模型网关请求频率受限，请稍后自行重试',
  UPSTREAM_CONTEXT_TOO_LONG: '输入超过模型上下文上限，请减少输入内容',
  GATEWAY_ORDER_SIGNATURE_INVALID: '模型网关消费订单签名校验失败，请联系管理员检查签名配置',
  GATEWAY_QUOTA_UNIT_INVALID: '模型网关积分单位配置不一致，请联系管理员检查消费订单配置',
  UPSTREAM_PRICING_NOT_CONFIGURED: '服务端模型价格配置未完成，请联系管理员同步模型计价配置',
  UPSTREAM_REJECTED: '模型网关已拒绝原请求，请检查模型服务配置',
  UPSTREAM_OUTCOME_UNKNOWN: '原请求已受理，模型结果与费用待核实；仅查询原订单，未重新提交',
  UPSTREAM_INVALID_RESPONSE: '模型网关未返回完整有效的模型结果；原订单保留待核实',
  UPSTREAM_TRANSPORT_MISMATCH: '模型网关返回了不支持的流式协议；原订单保留待核实',
  UPSTREAM_TIMEOUT: '等待模型网关响应超时；原订单保留待核实',
  UPSTREAM_TRANSPORT_FAILED: '模型网关连接中断或响应读取失败；原订单保留待核实',
  LOCAL_SETTLEMENT_PENDING: '模型结果已留存，账务结算暂不可用；仅核对原订单',
};
export function chatDiagnostic(errorCode: string, upstreamStatus?: number): DesktopChatDiagnostic {
  const known = Object.prototype.hasOwnProperty.call(DIAGNOSTICS, errorCode) ? errorCode : 'UPSTREAM_OUTCOME_UNKNOWN';
  return { errorCode: known, errorMessage: DIAGNOSTICS[known],
    ...(Number.isInteger(upstreamStatus) && upstreamStatus! >= 100 && upstreamStatus! <= 599 ? { upstreamStatus } : {}) };
}
/** Never forward arbitrary upstream code/message/body: recognize exact safe identifiers only. */
export function upstreamDiagnostic(status: number, body?: any): DesktopChatDiagnostic {
  if (typeof body?.error?.message === 'string'
    && /^DeepSeek Flash CNY token pricing requires peak ModelRatio=1; apply the model pricing configuration patch(?: \(request id: [A-Za-z0-9_.:-]{1,128}\))?$/.test(body.error.message)) {
    return chatDiagnostic('UPSTREAM_PRICING_NOT_CONFIGURED', status);
  }
  const rawCode = typeof body?.error === 'string' ? body.error : body?.error?.code;
  const knownCodes: Record<string, string> = {
    invalid_api_key: 'UPSTREAM_AUTH_FAILED', insufficient_quota: 'UPSTREAM_QUOTA_EXHAUSTED',
    model_not_found: 'UPSTREAM_MODEL_UNAVAILABLE', no_available_channel: 'UPSTREAM_MODEL_UNAVAILABLE',
    rate_limit_exceeded: 'UPSTREAM_RATE_LIMITED', context_length_exceeded: 'UPSTREAM_CONTEXT_TOO_LONG',
    tanva_invalid_order_signature: 'GATEWAY_ORDER_SIGNATURE_INVALID',
    tanva_quota_unit_must_be_500000: 'GATEWAY_QUOTA_UNIT_INVALID',
    tanva_invalid_model: 'UPSTREAM_MODEL_UNAVAILABLE', tanva_order_endpoint_not_supported: 'UPSTREAM_PROTOCOL_UNSUPPORTED',
  };
  const statuses: Record<number, string> = { 400: 'UPSTREAM_INVALID_REQUEST', 401: 'UPSTREAM_AUTH_FAILED',
    402: 'UPSTREAM_QUOTA_EXHAUSTED', 403: 'UPSTREAM_AUTH_FAILED', 404: 'UPSTREAM_MODEL_UNAVAILABLE',
    405: 'UPSTREAM_PROTOCOL_UNSUPPORTED', 413: 'UPSTREAM_REQUEST_TOO_LARGE', 415: 'UPSTREAM_PROTOCOL_UNSUPPORTED',
    422: 'UPSTREAM_INVALID_REQUEST', 429: 'UPSTREAM_RATE_LIMITED' };
  return chatDiagnostic(typeof rawCode === 'string' && Object.prototype.hasOwnProperty.call(knownCodes, rawCode)
    ? knownCodes[rawCode] : statuses[status] || 'UPSTREAM_OUTCOME_UNKNOWN', status);
}
export function failedChatHttpStatus(result: { upstreamStatus?: number; errorCode?: string }): number {
  if (result.errorCode === 'UPSTREAM_PRICING_NOT_CONFIGURED') return 502;
  if (result.upstreamStatus === 400 || result.upstreamStatus === 422) return 422;
  if (result.upstreamStatus === 413 || result.upstreamStatus === 429) return result.upstreamStatus;
  return 502;
}
export const identifier = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) throw new BadRequestException(`无效 ${name}`);
  return value;
};
/** Preserve arbitrary supported Chat Completions options and complete tool history. */
export function validateCompletion(body: any): Record<string, any> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('请求必须为JSON对象');
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_REQUEST_BYTES) throw new PayloadTooLargeException('模型请求超过4 MiB');
  identifier(body.model, 'model');
  if (body.stream === true) throw new BadRequestException('Tanva桌面对话使用完整JSON回执');
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.some((item: any) => !item || !['system', 'developer', 'user', 'assistant', 'tool'].includes(item.role))) throw new BadRequestException('无效对话消息');
  return { ...body, stream: false };
}
export function receipt(row: any, includeResponse = false) {
  const meta = row.requestParams?.desktopChat as DesktopChatMeta;
  const state: ReceiptStatus = meta.state === 'pending' && Date.now() > Date.parse(meta.deadline) ? 'reconciliation_required' : meta.state;
  const funded = meta.scope.kind === 'team';
  const amount = state === 'failed' ? 0 : meta.credits;
  const metered = !!meta.billing;
  const pending = state === 'pending' || state === 'reconciliation_required';
  const gatewayOrder = !!row.consumptionStatus;
  const consumption = row.consumptionReceipt;
  const consumed = gatewayOrder && row.consumptionStatus === 'settled';
  const closed = consumed || row.consumptionStatus === 'rejected';
  const billing = meta.billing && gatewayOrder ? { ...meta.billing,
    mode: 'gateway_consumption' as const, settlementStatus: row.consumptionStatus,
    ...(consumption?.receipt?.costCny !== undefined ? { gatewayCostCny: consumption.receipt.costCny } : {}),
    ...(consumption?.receipt?.eventId ? { gatewayEventId: consumption.receipt.eventId } : {}),
    ...(consumption?.receipt?.gatewayRequestId ? { upstreamRequestId: consumption.receipt.gatewayRequestId } : {}),
    ...(consumed ? { exactCredits: consumption.exactCredits, exactCreditNanos: consumption.exactCreditNanos } : {}),
  } : meta.billing;
  return {
    requestId: meta.requestId, apiUsageId: row.id, taskId: meta.taskId,
    conversationId: meta.conversationId, model: row.model, scope: meta.scope, status: state,
    creditsCharged: gatewayOrder ? (consumed ? consumption.creditsCharged : 0)
      : metered ? (state === 'completed' ? amount : 0) : funded && state !== 'completed' ? 0 : amount,
    creditsReserved: gatewayOrder ? (closed ? 0 : consumption.creditsReserved)
      : (funded || metered) && pending ? (meta.billing?.reservation.credits ?? amount) : 0,
    unit: 'credits' as const, createdAt: new Date(row.createdAt).toISOString(),
    ...(billing ? { billing } : {}),
    ...(meta.completedAt ? { completedAt: meta.completedAt } : {}),
    ...(meta.errorCode ? { errorCode: meta.errorCode } : {}),
    ...(meta.errorCode ? { errorMessage: chatDiagnostic(meta.errorCode).errorMessage } : {}),
    ...(meta.upstreamStatus !== undefined ? { upstreamStatus: meta.upstreamStatus } : {}),
    ...(includeResponse && state === 'completed' ? { response: meta.response } : {}),
  };
}
