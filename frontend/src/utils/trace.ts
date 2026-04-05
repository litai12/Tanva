const TRACE_HEADER = "x-trace-id";
const TRACE_PARENT_HEADER = "traceparent";

const randomHex = (size: number): string => {
  const chars = "0123456789abcdef";
  let output = "";
  for (let i = 0; i < size; i += 1) {
    output += chars[Math.floor(Math.random() * chars.length)];
  }
  return output;
};

export const createTraceId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(16)}${randomHex(16)}`;
};

export const createSpanId = (): string => randomHex(16);

export const createTraceParent = (traceId: string, spanId = createSpanId()): string =>
  `00-${traceId}-${spanId}-01`;

export const ensureTraceHeader = (headers: Headers): string => {
  const existing = headers.get(TRACE_HEADER)?.trim();
  const traceId = existing || createTraceId();
  headers.set(TRACE_HEADER, traceId);
  if (!headers.get(TRACE_PARENT_HEADER)) {
    headers.set(TRACE_PARENT_HEADER, createTraceParent(traceId));
  }
  return traceId;
};

export const TRACE_ID_HEADER = TRACE_HEADER;
export const TRACE_PARENT_ID_HEADER = TRACE_PARENT_HEADER;
