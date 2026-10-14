import { AsyncLocalStorage } from 'node:async_hooks';

/** A transport failure cannot prove that a paid generation was rejected. */
export interface ImageExecutionState {
  started: boolean;
  rejected: boolean;
  upstreamImageTask?: UpstreamImageTaskReceipt;
  onRemoteImages?: (urls: string[]) => Promise<void>;
}

/** Evidence returned by our gateway for the single submitted upstream attempt. */
export interface UpstreamImageTaskReceipt {
  provider: 'toapis' | 'apimart';
  task_id: string;
  request_id?: string;
  status: string;
  accepted: boolean;
  terminal: boolean;
  billing_status?: string;
  error_code?: string;
  reason?: string;
  upstream_code?: string;
}
export const imageExecutionContext = new AsyncLocalStorage<ImageExecutionState>();
export const IMAGE_GENERATION_SERVICES = [
  'gemini-3-pro-image', 'gemini-3.1-image', 'gemini-2.5-image', 'gpt-image-2',
  'gemini-image-edit', 'gemini-3.1-image-edit', 'gemini-2.5-image-edit',
  'gemini-image-blend', 'gemini-3.1-image-blend', 'gemini-2.5-image-blend',
  'gemini-3-pro-image-ultra', 'gemini-3.1-image-ultra',
  'gemini-image-blend-ultra', 'gemini-3.1-image-blend-ultra',
  'midjourney-imagine', 'midjourney-variation', 'midjourney-upscale', 'expand-image',
  'doubao-seedream-5-0-260128', 'doubao-seedream-5-0-pro-260628',
] as const;
export const isImageGenerationService = (service: string): boolean =>
  (IMAGE_GENERATION_SERVICES as readonly string[]).includes(service);

export function recordImageRejection(status: number): void {
  const state = imageExecutionContext.getStore();
  // Gateways may lose the response after dispatch (408/429/5xx): keep pending.
  if (state && [400, 401, 403, 404, 413, 422].includes(status)) state.rejected = true;
}

export function recordImageGatewayFailure(status: number, body: unknown): void {
  const state = imageExecutionContext.getStore();
  const error = body && typeof body === 'object' ? (body as any).error : undefined;
  if (!error || typeof error !== 'object' || !Object.prototype.hasOwnProperty.call(error, 'upstream_image_task')) {
    recordImageRejection(status);
    return;
  }
  if (!state) return;
  // A structured receipt overrides HTTP status. Incomplete/contradictory
  // receipts must never turn an accepted task into a presumed rejection.
  state.rejected = false;
  const receipt = error.upstream_image_task;
  const safeIdentifier = (value: unknown): value is string =>
    typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,256}$/.test(value);
  if (!receipt || typeof receipt !== 'object' ||
      !['toapis', 'apimart'].includes(receipt.provider) ||
      !safeIdentifier(receipt.task_id) ||
      typeof receipt.accepted !== 'boolean' || typeof receipt.terminal !== 'boolean' ||
      !safeIdentifier(receipt.status)) return;
  const normalized: UpstreamImageTaskReceipt = {
    provider: receipt.provider, task_id: receipt.task_id, status: receipt.status,
    accepted: receipt.accepted, terminal: receipt.terminal,
    ...(safeIdentifier(receipt.request_id) ? { request_id: receipt.request_id } : {}),
    ...(safeIdentifier(receipt.billing_status) ? { billing_status: receipt.billing_status } : {}),
    ...(safeIdentifier(receipt.error_code) ? { error_code: receipt.error_code } : {}),
    ...(safeIdentifier(receipt.reason) ? { reason: receipt.reason } : {}),
    ...(safeIdentifier(receipt.upstream_code) ? { upstream_code: receipt.upstream_code } : {}),
  };
  state.upstreamImageTask = normalized;
  state.rejected = normalized.accepted && normalized.terminal &&
    ['failed', 'cancelled'].includes(normalized.status) && normalized.billing_status === 'refunded';
}
export const needsImageReconciliation = (state: ImageExecutionState): boolean =>
  state.started && !state.rejected;

/** Save remote references before watermarking/uploading can fail; never persist base64. */
export async function recordRemoteImages(urls: string[]): Promise<void> {
  const remote = urls.filter((url) => /^https?:\/\//i.test(url));
  if (remote.length) await imageExecutionContext.getStore()?.onRemoteImages?.(remote);
}

/** The synchronous gateway validates locally before it can create paid work. */
export function setImageSubmissionStarted(started: boolean): void {
  const state = imageExecutionContext.getStore();
  if (state) state.started = started;
}
