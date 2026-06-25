// Bounded reads for remote downloads. A single oversized fetch (large video or
// image) buffered fully into a Buffer can balloon the V8 heap past its limit
// and crash the process with "JavaScript heap out of memory" (incident
// 2026-06-25). These helpers cap the worst-case single allocation.

export class ResponseTooLargeError extends Error {
  constructor(
    readonly limitBytes: number,
    readonly actualBytes?: number,
  ) {
    super(
      `Response body exceeds limit of ${limitBytes} bytes` +
        (typeof actualBytes === 'number' ? ` (read ${actualBytes})` : ''),
    );
    this.name = 'ResponseTooLargeError';
  }
}

type FetchLikeResponse = {
  headers: { get(name: string): string | null };
  body?: unknown;
  arrayBuffer(): Promise<ArrayBuffer>;
};

/**
 * Read a fetch Response body fully into a Buffer, aborting as soon as the
 * accumulated bytes exceed `maxBytes`.
 *
 * - Rejects up-front when Content-Length already declares more than the cap.
 * - When a web ReadableStream body is available, streams chunk-by-chunk and
 *   cancels the stream on overflow, so we never hold more than the cap in heap.
 * - Falls back to arrayBuffer() with a post-read size check otherwise.
 */
export async function bufferResponseWithLimit(
  response: FetchLikeResponse,
  maxBytes: number,
): Promise<Buffer> {
  const cap = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 0;
  if (!cap) {
    return Buffer.from(await response.arrayBuffer());
  }

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    throw new ResponseTooLargeError(cap, declared);
  }

  const body = response.body as
    | { getReader?: () => ReadableStreamDefaultReader<Uint8Array> }
    | null
    | undefined;

  if (!body || typeof body.getReader !== 'function') {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > cap) {
      throw new ResponseTooLargeError(cap, buf.length);
    }
    return buf;
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > cap) {
        try {
          await reader.cancel();
        } catch {
          /* best-effort */
        }
        throw new ResponseTooLargeError(cap, total);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
  return Buffer.concat(chunks, total);
}
