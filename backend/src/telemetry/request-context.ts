import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestContextPayload = {
  traceId?: string | null;
  requestId?: string | null;
  userId?: string | null;
  origin?: string | null;
  originHost?: string | null;
  latestUpstreamRequest?: UpstreamRequestContextPayload | null;
};

export type UpstreamRequestContextPayload = {
  method: string;
  url: string;
  host: string | null;
  pathname: string | null;
  statusCode: number | null;
  durationMs: number | null;
  requestHeaders?: Record<string, unknown> | null;
  requestBody?: unknown;
  responseHeaders?: Record<string, unknown> | null;
  responseBody?: unknown;
  error?: string | null;
  type?: 'text' | 'video' | 'picture' | 'audio' | 'file' | 'binary' | 'other';
  model?: string | null;
  receivedAt: string;
};

const requestContextStorage = new AsyncLocalStorage<RequestContextPayload>();

export const runWithRequestContext = <T>(
  payload: RequestContextPayload,
  callback: () => T,
): T => requestContextStorage.run(payload, callback);

export const enterRequestContext = (payload: RequestContextPayload): void => {
  requestContextStorage.enterWith(payload);
};

export const getRequestContext = (): RequestContextPayload | null =>
  requestContextStorage.getStore() || null;

export const recordLatestUpstreamRequest = (
  payload: UpstreamRequestContextPayload,
): void => {
  const store = requestContextStorage.getStore();
  if (!store) return;
  store.latestUpstreamRequest = payload;
};
