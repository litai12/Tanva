import { context, trace } from '@opentelemetry/api';
import { getRequestContext } from './request-context';

type PatchedFetch = typeof fetch & {
  __tanvaUpstreamLoggingPatched?: boolean;
};

const MAX_BODY_TEXT_LENGTH = 200_000;
const MAX_FIELD_STRING_LENGTH = 20_000;
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'proxy-authorization',
]);

const isEnabled = (value: unknown, defaultValue: boolean): boolean => {
  if (value == null || value === '') return defaultValue;
  return ['1', 'true', 'on', 'yes'].includes(String(value).toLowerCase());
};

const shouldLogUpstreamRequests = (): boolean => {
  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
  const defaultEnabled = nodeEnv !== 'production';
  return isEnabled(process.env.OPENOBSERVE_UPSTREAM_REQUEST_LOGGING_ENABLED, defaultEnabled);
};

const getOpenObserveEndpointPrefix = (): string | null => {
  const baseUrl = process.env.OPENOBSERVE_BASE_URL?.trim();
  const org = process.env.OPENOBSERVE_ORG?.trim() || 'default';
  if (!baseUrl) return null;
  return `${baseUrl.replace(/\/+$/, '')}/api/${encodeURIComponent(org)}/`;
};

const isLikelyImageBase64 = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) return true;
  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 512) return true;
  return false;
};

const toBase64Meta = (value: string) => {
  const trimmed = value.trim();
  const dataUrlMatch = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(trimmed);
  const base64Payload = dataUrlMatch ? dataUrlMatch[2] : trimmed.replace(/\s+/g, '');
  const mimeType = dataUrlMatch?.[1] || 'image/base64';
  const approxBytes = Math.floor((base64Payload.length * 3) / 4);

  return {
    kind: 'binary_image_payload',
    mimeType,
    encoding: 'base64',
    approximateBytes: approxBytes,
    base64Length: base64Payload.length,
  };
};

const sanitizeString = (value: string): unknown => {
  if (isLikelyImageBase64(value)) {
    return toBase64Meta(value);
  }

  if (value.length <= MAX_FIELD_STRING_LENGTH) {
    return value;
  }

  return {
    kind: 'truncated_string',
    length: value.length,
    preview: value.slice(0, MAX_FIELD_STRING_LENGTH),
  };
};

const sanitizeValue = (value: unknown): unknown => {
  if (value == null) return value;

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (value instanceof URLSearchParams) {
    return sanitizeValue(Object.fromEntries(value.entries()));
  }

  if (typeof FormData !== 'undefined' && value instanceof FormData) {
    const entries: Record<string, unknown[]> = {};
    for (const [key, entryValue] of value.entries()) {
      if (!entries[key]) entries[key] = [];
      if (typeof entryValue === 'string') {
        entries[key].push(sanitizeString(entryValue));
      } else {
        entries[key].push({
          kind: 'binary_form_entry',
          name: 'name' in entryValue ? String(entryValue.name || '') : '',
          type: 'type' in entryValue ? String(entryValue.type || '') : '',
          size: 'size' in entryValue ? Number(entryValue.size || 0) : null,
        });
      }
    }
    return entries;
  }

  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const byteLength =
      value instanceof Uint8Array ? value.byteLength : value.byteLength;
    return {
      kind: 'binary_payload',
      byteLength,
    };
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        sanitizeValue(nestedValue),
      ]),
    );
  }

  return value;
};

const sanitizeHeaders = (headers: Headers): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {};
  headers.forEach((value, key) => {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      normalized[key] = {
        kind: 'redacted',
        length: value.length,
      };
      return;
    }
    normalized[key] = value;
  });
  return normalized;
};

const tryParseBody = (bodyText: string, contentType: string | null): unknown => {
  if (!bodyText) return null;

  const trimmed = bodyText.slice(0, MAX_BODY_TEXT_LENGTH).trim();
  if (!trimmed) return null;

  if (contentType?.includes('application/json')) {
    try {
      return sanitizeValue(JSON.parse(trimmed));
    } catch {
      return sanitizeString(trimmed);
    }
  }

  if (contentType?.includes('application/x-www-form-urlencoded')) {
    return sanitizeValue(new URLSearchParams(trimmed));
  }

  return sanitizeString(trimmed);
};

const readResponseBody = async (response: Response): Promise<unknown> => {
  const cloned = response.clone();
  const contentType = cloned.headers.get('content-type');

  try {
    const buffer = await cloned.arrayBuffer();
    if (buffer.byteLength === 0) return null;

    const mimeType = contentType?.split(';')[0]?.trim().toLowerCase() || null;
    const isTextLike =
      (mimeType?.startsWith('text/') ?? false) ||
      mimeType === 'application/json' ||
      mimeType === 'application/problem+json' ||
      mimeType === 'application/x-www-form-urlencoded' ||
      mimeType === 'application/xml' ||
      mimeType === 'text/xml' ||
      mimeType === 'image/svg+xml';

    if (!isTextLike) {
      return {
        kind: 'binary_response_body',
        mimeType,
        byteLength: buffer.byteLength,
      };
    }

    const bodyText = new TextDecoder().decode(buffer.slice(0, MAX_BODY_TEXT_LENGTH));
    return tryParseBody(bodyText, contentType);
  } catch (error) {
    return {
      kind: 'unreadable_response_body',
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const readRequestBody = async (request: Request): Promise<unknown> => {
  const cloned = request.clone();
  const contentType = cloned.headers.get('content-type');
  if (!cloned.body) return null;

  try {
    const bodyText = await cloned.text();
    return tryParseBody(bodyText, contentType);
  } catch (error) {
    return {
      kind: 'unreadable_request_body',
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const shouldLogUrl = (url: URL): boolean => {
  if (!/^https?:$/i.test(url.protocol)) return false;
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return false;

  const openObservePrefix = getOpenObserveEndpointPrefix();
  if (openObservePrefix && url.toString().startsWith(openObservePrefix)) {
    return false;
  }

  return true;
};

const ingestUpstreamRequestLog = async (payload: Record<string, unknown>) => {
  const baseUrl = process.env.OPENOBSERVE_BASE_URL?.trim();
  const username = process.env.OPENOBSERVE_USERNAME?.trim();
  const password = process.env.OPENOBSERVE_PASSWORD?.trim();
  const org = process.env.OPENOBSERVE_ORG?.trim() || 'default';
  const stream = process.env.OPENOBSERVE_UPSTREAM_REQUEST_STREAM?.trim() || 'upstream_requests';
  if (!baseUrl || !username || !password) return;

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/${encodeURIComponent(org)}/${encodeURIComponent(stream)}/_json`;
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  const originalFetch = globalThis.fetch.bind(globalThis);

  try {
    await originalFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify([payload]),
    });
  } catch {}
};

export const installUpstreamFetchLogger = (): void => {
  if (!shouldLogUpstreamRequests()) return;

  const currentFetch = globalThis.fetch as PatchedFetch | undefined;
  if (!currentFetch || currentFetch.__tanvaUpstreamLoggingPatched) return;

  const originalFetch = currentFetch.bind(globalThis);

  const patchedFetch: PatchedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (!shouldLogUrl(url)) {
      return originalFetch(input as any, init);
    }

    const startedAt = Date.now();
    const activeSpan = trace.getSpan(context.active())?.spanContext();
    const requestContext = getRequestContext();
    const requestBody = await readRequestBody(request);
    const requestHeaders = sanitizeHeaders(request.headers);

    try {
      const response = await originalFetch(request);
      const responseHeaders = sanitizeHeaders(response.headers);
      const responseBody = await readResponseBody(response);
      void ingestUpstreamRequestLog({
        trace_id: activeSpan?.traceId || requestContext?.traceId || null,
        span_id: activeSpan?.spanId || null,
        request_id: requestContext?.requestId || null,
        user_id: requestContext?.userId || null,
        method: request.method,
        url: request.url,
        host: url.host,
        pathname: url.pathname,
        status_code: response.status,
        duration_ms: Date.now() - startedAt,
        request_headers: requestHeaders,
        request_body: requestBody,
        response_headers: responseHeaders,
        response_body: responseBody,
        service_name: process.env.OPENOBSERVE_TRACE_SERVICE_NAME?.trim() || 'tanva-backend',
        received_at: new Date().toISOString(),
        log_type: 'upstream_request',
        service: 'backend',
      });
      return response;
    } catch (error) {
      void ingestUpstreamRequestLog({
        trace_id: activeSpan?.traceId || requestContext?.traceId || null,
        span_id: activeSpan?.spanId || null,
        request_id: requestContext?.requestId || null,
        user_id: requestContext?.userId || null,
        method: request.method,
        url: request.url,
        host: url.host,
        pathname: url.pathname,
        status_code: null,
        duration_ms: Date.now() - startedAt,
        request_headers: requestHeaders,
        request_body: requestBody,
        response_headers: null,
        error: error instanceof Error ? error.message : String(error),
        service_name: process.env.OPENOBSERVE_TRACE_SERVICE_NAME?.trim() || 'tanva-backend',
        received_at: new Date().toISOString(),
        log_type: 'upstream_request',
        service: 'backend',
      });
      throw error;
    }
  };

  patchedFetch.__tanvaUpstreamLoggingPatched = true;
  globalThis.fetch = patchedFetch;
};
