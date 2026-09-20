import { AsyncLocalStorage } from 'node:async_hooks';

/** A transport failure cannot prove that a paid generation was rejected. */
export interface ImageExecutionState {
  started: boolean;
  rejected: boolean;
  onRemoteImages?: (urls: string[]) => Promise<void>;
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
