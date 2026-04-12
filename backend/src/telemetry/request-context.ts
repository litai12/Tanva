import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestContextPayload = {
  traceId?: string | null;
  requestId?: string | null;
  userId?: string | null;
  origin?: string | null;
  originHost?: string | null;
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
