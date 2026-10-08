import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type GatewayConsumptionStatus = 'pending' | 'consumed' | 'rejected' | 'reconciliation_required';
export interface GatewayConsumptionPayload {
  version: 1; eventId: string; revision: number; orderId: string; orderHash: string;
  gatewayInstanceId: string; gatewayRequestId: string; model: string;
  status: GatewayConsumptionStatus; priceCurrency: 'CNY'; costCny?: string;
  quota?: string; quotaPerUnit: string; startedAt: string; settledAt?: string;
  usageEvidence: 'upstream_tokens' | 'gateway_estimated_usage' | 'gateway_fixed_price' | 'unknown';
  usage?: Record<string, unknown>; errorCode?: string;
}
export interface GatewayConsumptionEnvelope { timestamp: string; payload: string; signature: string }
export type ConsumptionOrderStatus = 'pending' | 'settled' | 'rejected' | 'reconciliation_required';
export interface ConsumptionOrderResult {
  enabled: boolean; status?: ConsumptionOrderStatus; creditsCharged?: number;
  exactCredits?: string; exactCreditNanos?: string; costCny?: string;
  receipt?: GatewayConsumptionPayload;
}
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const canonicalConsumptionJson = (value: any): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalConsumptionJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalConsumptionJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
export const signGatewayRequest = (secret: string, timestamp: string, method: string, path: string,
  orderId: string, orderHash: string, rawBody: string) => createHmac('sha256', secret)
  .update([timestamp, method.toUpperCase(), path, orderId, orderHash, sha256(rawBody)].join('\n')).digest('hex');

const id = (value: unknown, name: string, maximum = 256): string => {
  if (typeof value !== 'string' || !value || value.length > maximum || !/^[A-Za-z0-9_.:-]+$/.test(value)) throw new Error(`Invalid consumption ${name}`);
  return value;
};
const date = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid consumption ${name}`);
  return value;
};
const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid consumption object');
  return value as Record<string, any>;
};
export function verifyConsumptionEnvelope(value: unknown, secret: string, now = new Date()): GatewayConsumptionPayload {
  const envelope = object(value);
  if (typeof envelope.timestamp !== 'string' || !/^\d{10}$/.test(envelope.timestamp)
      || Math.abs(Number(envelope.timestamp) * 1000 - now.getTime()) > 300_000
      || typeof envelope.payload !== 'string' || !/^[A-Za-z0-9_-]+$/.test(envelope.payload) || envelope.payload.length > 128 * 1024
      || typeof envelope.signature !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.signature)) throw new Error('Invalid consumption signature envelope');
  const expected = createHmac('sha256', secret).update(`${envelope.timestamp}\n${envelope.payload}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(envelope.signature, 'hex'))) throw new Error('Invalid consumption signature');
  const bytes = Buffer.from(envelope.payload, 'base64url');
  if (bytes.toString('base64url') !== envelope.payload) throw new Error('Invalid consumption payload encoding');
  return validateConsumptionPayload(JSON.parse(bytes.toString('utf8')));
}
export function validateConsumptionPayload(value: unknown): GatewayConsumptionPayload {
  const p = object(value);
  const allowed = new Set(['version', 'eventId', 'revision', 'orderId', 'orderHash', 'gatewayInstanceId', 'gatewayRequestId', 'model', 'status', 'priceCurrency', 'costCny', 'quota', 'quotaPerUnit', 'startedAt', 'settledAt', 'usageEvidence', 'usage', 'errorCode']);
  if (Object.keys(p).some(k => !allowed.has(k)) || p.version !== 1 || !Number.isSafeInteger(p.revision) || p.revision < 0
    || !['pending', 'consumed', 'rejected', 'reconciliation_required'].includes(p.status)
    || p.priceCurrency !== 'CNY' || !['upstream_tokens', 'gateway_estimated_usage', 'gateway_fixed_price', 'unknown'].includes(p.usageEvidence)) throw new Error('Invalid consumption payload');
  id(p.eventId, 'eventId'); id(p.orderId, 'orderId'); id(p.orderHash, 'orderHash'); id(p.gatewayInstanceId, 'instance');
  id(p.gatewayRequestId, 'requestId'); id(p.model, 'model'); date(p.startedAt, 'startedAt');
  if (p.settledAt !== undefined) date(p.settledAt, 'settledAt');
  if (p.errorCode !== undefined) id(p.errorCode, 'errorCode', 128);
  if (p.usage !== undefined && Buffer.byteLength(JSON.stringify(object(p.usage))) > 16 * 1024) throw new Error('Consumption usage too large');
  const unit = decimal(p.quotaPerUnit);
  if (unit.units <= 0n) throw new Error('Invalid consumption quota unit');
  if (p.status === 'consumed' || p.status === 'rejected') {
    if (p.settledAt === undefined || typeof p.quota !== 'string' || !/^\d{1,30}$/.test(p.quota)) throw new Error('Terminal consumption lacks settlement proof');
    const cost = decimal(p.costCny);
    // The displayed cost must be exactly the authoritative integer quota / unit.
    if (cost.units * unit.units !== BigInt(p.quota) * cost.scale * unit.scale) throw new Error('Consumption cost and quota disagree');
    if (p.status === 'rejected' && (cost.units !== 0n || BigInt(p.quota) !== 0n)) throw new Error('Rejected consumption cannot have a charge');
    consumptionCredits(p.costCny);
  } else if (p.costCny !== undefined || p.quota !== undefined) throw new Error('Nonterminal consumption cannot state a final cost');
  return p as GatewayConsumptionPayload;
}
function decimal(value: unknown): { units: bigint; scale: bigint } {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,15})(\.\d{1,9})?$/.test(value)) throw new Error('Invalid consumption decimal amount');
  const [whole, fraction = ''] = value.split('.');
  return { units: BigInt(whole + fraction), scale: 10n ** BigInt(fraction.length) };
}
export function consumptionCredits(costCny: string, markup: 1 | 1.5 = 1.5) {
  if (markup !== 1 && markup !== 1.5) throw new Error('Invalid consumption markup');
  const cost = decimal(costCny);
  const nanos = cost.units * (markup === 1 ? 100n : 150n) * 1_000_000_000n / cost.scale;
  const credits = (nanos + 999_999_999n) / 1_000_000_000n;
  if (credits > 2147483647n) throw new Error('Consumption integer credits overflow');
  const fraction = (nanos % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return { creditsCharged: Number(credits), exactCreditNanos: nanos.toString(), exactCredits: `${nanos / 1_000_000_000n}${fraction ? `.${fraction}` : ''}` };
}
