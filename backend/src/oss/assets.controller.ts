import {
  BadGatewayException,
  BadRequestException,
  Controller,
  GatewayTimeoutException,
  Get,
  PayloadTooLargeException,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { OssObjectTooLargeError, OssReadTimeoutError, OssService } from './oss.service';

// Cap for the rare full-buffer fallbacks below (no presigned URL / no upstream
// body stream). Streaming is always preferred; this only bounds the worst case
// so a giant object can't OOM the process. Overridable via env.
const PROXY_BUFFER_FALLBACK_MAX_BYTES = (() => {
  const raw = Number(process.env.ASSET_PROXY_MAX_BUFFER_BYTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 64 * 1024 * 1024; // 64MB
})();

const MANAGED_ASSET_KEY_REGEX = /^(projects|uploads|templates|videos|ai)\//i;
const DEFAULT_PROXY_UPSTREAM_TIMEOUT_MS = 12_000;
const MAX_PROXY_UPSTREAM_RETRIES = 1;
const RETRYABLE_PROXY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

@ApiTags('assets')
@Controller('assets')
export class AssetsController {
  constructor(private readonly oss: OssService) {}

  private normalizeManagedAssetKey(raw?: string | null): string | null {
    const value = typeof raw === 'string' ? raw.trim().replace(/^\/+/, '') : '';
    // Reject query/fragment chars: object keys never contain them, and allowing
    // them would let `projects/a.png?Signature=fake` masquerade as a presigned
    // URL once signUrl() fail-opens to publicUrl() (see isPresignedUrl).
    if (!value || /[?#]/.test(value)) return null;
    return MANAGED_ASSET_KEY_REGEX.test(value) ? value : null;
  }

  private resolveBucketOriginUrl(key: string): string | null {
    const normalizedKey = this.normalizeManagedAssetKey(key);
    if (!normalizedKey) return null;
    const signed = this.oss.signUrl(normalizedKey, 300);
    if (signed) return signed;
    return this.oss.publicUrl(normalizedKey);
  }

  private extractManagedAssetKey(
    input?: string | null,
    visited: Set<string> = new Set(),
  ): string | null {
    const trimmed = typeof input === 'string' ? input.trim() : '';
    if (!trimmed) return null;
    if (visited.has(trimmed)) return null;
    visited.add(trimmed);

    const direct = this.normalizeManagedAssetKey(trimmed);
    if (direct) return direct;

    try {
      const parsed = new URL(trimmed);
      const fromPath = this.normalizeManagedAssetKey(parsed.pathname);
      if (fromPath) return fromPath;

      const fromKeyQuery = this.normalizeManagedAssetKey(parsed.searchParams.get('key'));
      if (fromKeyQuery) return fromKeyQuery;

      const nestedUrl = parsed.searchParams.get('url');
      if (nestedUrl && nestedUrl !== trimmed) {
        const nested = this.extractManagedAssetKey(nestedUrl, visited);
        if (nested) return nested;
      }
    } catch {
      // ignore
    }

    return null;
  }

  private normalizeTargetUrlForFetch(rawUrl: string): string {
    const managedKey = this.extractManagedAssetKey(rawUrl);
    if (!managedKey) return rawUrl;
    return (
      this.resolveBucketOriginUrl(managedKey) ||
      this.oss.signUrl(managedKey, 300) ||
      this.oss.publicUrl(managedKey)
    );
  }

  private resolveTargetUrl(params: { url?: string; key?: string }): string {
    const key = typeof params.key === 'string' ? params.key.trim().replace(/^\/+/, '') : '';
    if (key) {
      const normalizedKey = this.normalizeManagedAssetKey(key);
      if (normalizedKey) {
        return this.resolveBucketOriginUrl(normalizedKey) || this.oss.publicUrl(normalizedKey);
      }
      return this.oss.publicUrl(key.replace(/^\/+/, ''));
    }

    const url = typeof params.url === 'string' ? params.url.trim() : '';
    if (!url) {
      throw new BadRequestException('Missing `url` or `key`');
    }
    return this.normalizeTargetUrlForFetch(url);
  }

  private isAllowedHost(hostname: string): boolean {
    const target = String(hostname || '').toLowerCase();
    if (!target) return false;
    const allowed = this.oss.allowedPublicHosts();
    return allowed.some((host) => {
      const h = String(host || '').toLowerCase();
      // Exact host or proper dot-delimited subdomain only — avoid suffix
      // bypasses like `evilaliyuncs.com` matching `aliyuncs.com`.
      return !!h && (target === h || target.endsWith(`.${h}`));
    });
  }

  // signUrl() is fail-open: it returns the (unsigned) public URL when OSS is
  // disabled or signing fails. For the direct-redirect path we must be
  // fail-closed — only treat the result as usable when it actually carries a
  // presigned signature, otherwise fall back to streaming the bytes.
  private isPresignedUrl(url?: string | null): boolean {
    if (typeof url !== 'string' || !url) return false;
    return /[?&](?:X-Tos-Signature|X-Amz-Signature|Signature|OSSAccessKeyId)=/i.test(url);
  }

  private setProxyCorsHeaders(reply: FastifyReply): void {
    reply.header('access-control-allow-origin', '*');
    reply.header(
      'access-control-expose-headers',
      'content-type,content-length,content-range,accept-ranges,etag,last-modified,cache-control',
    );
    reply.header('cross-origin-resource-policy', 'cross-origin');
  }

  private setPassthroughHeaders(reply: FastifyReply, headers: Record<string, string>): void {
    const passthroughHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified',
      'cache-control',
      'content-disposition',
    ] as const;
    passthroughHeaders.forEach((name) => {
      const value = headers?.[name];
      if (value) reply.header(name, value);
    });
  }

  @Get('proxy')
  @ApiOperation({ summary: 'Proxy public OSS assets to avoid browser CORS' })
  @ApiQuery({ name: 'url', required: false, description: 'Full remote URL (must be an allowed OSS/CDN host)' })
  @ApiQuery({ name: 'key', required: false, description: 'OSS object key (alternative to url)' })
  @ApiQuery({
    name: 'direct',
    required: false,
    description:
      'When "1"/"true", redirect (302) managed keys to a short-lived presigned URL so the browser fetches bytes directly from storage (used by crossOrigin canvas loaders). Falls back to byte streaming when signing is unavailable.',
  })
  async proxy(
    @Res() reply: FastifyReply,
    @Req() req: FastifyRequest,
    @Query('url') url?: string,
    @Query('key') key?: string,
    @Query('direct') direct?: string,
  ) {
    const abortController = new AbortController();
    let abortedByClient = false;
    let upstreamBody: ReadableStream<Uint8Array> | null = null;
    let upstreamNodeStream: Readable | null = null;

    const abortUpstream = () => {
      if (abortedByClient) return;
      abortedByClient = true;
      try {
        abortController.abort();
      } catch {
        // ignore
      }
      try {
        upstreamNodeStream?.destroy();
      } catch {
        // ignore
      }
      let cancelPromise: Promise<void> | undefined;
      try {
        cancelPromise = upstreamBody?.cancel();
      } catch {
        // ignore
      }
      void cancelPromise?.catch(() => {
        // ignore
      });
    };

    try {
      const rawReply = reply.raw as any;
      rawReply?.once?.('close', () => {
        if (!rawReply?.writableEnded) abortUpstream();
      });
      rawReply?.once?.('error', abortUpstream);
    } catch {
      // ignore
    }
    try {
      const rawReq = req.raw as any;
      rawReq?.once?.('aborted', abortUpstream);
      rawReq?.once?.('error', abortUpstream);
    } catch {
      // ignore
    }

    const pickHeader = (name: string): string | undefined => {
      const raw = (req.headers as Record<string, unknown>)[name];
      return typeof raw === 'string' ? raw : undefined;
    };

    const upstreamHeaders: Record<string, string> = {};
    const range = pickHeader('range');
    const ifNoneMatch = pickHeader('if-none-match');
    const ifModifiedSince = pickHeader('if-modified-since');
    if (range) upstreamHeaders.range = range;
    if (ifNoneMatch) upstreamHeaders['if-none-match'] = ifNoneMatch;
    if (ifModifiedSince) upstreamHeaders['if-modified-since'] = ifModifiedSince;

    const directManagedKey =
      this.normalizeManagedAssetKey(key) ||
      this.extractManagedAssetKey(url);

    // Direct-redirect path: hand the data plane to storage (presigned URL) so
    // the browser fetches bytes directly. Used by crossOrigin canvas loaders
    // (e.g. the image annotation editor) to offload proxy bandwidth.
    const directRaw = typeof direct === 'string' ? direct.trim().toLowerCase() : '';
    const wantDirect = directRaw === '1' || directRaw === 'true';
    if (wantDirect && directManagedKey) {
      const signed = this.oss.signUrl(directManagedKey, 300);
      if (this.isPresignedUrl(signed)) {
        let signedHost = '';
        try {
          signedHost = new URL(signed).hostname;
        } catch {
          signedHost = '';
        }
        if (signedHost && this.isAllowedHost(signedHost)) {
          this.setProxyCorsHeaders(reply);
          // Short-lived signature — never cache the redirect target.
          reply.header('cache-control', 'no-store');
          reply.status(302).header('location', signed).send();
          return;
        }
      }
      // fail-closed: signing unavailable → fall through to byte streaming below.
    }

    // Managed keys (no range): stream the bytes from a short-lived presigned
    // URL via the bounded streaming path below (real AbortController
    // cancellation, no full-object buffering). This replaces an in-memory
    // getObjectBuffer() read that ran on the SDK's 5-min request timeout, which
    // let slow/dangling objects pile up full-image buffers and saturate the
    // event loop (incident 2026-06-15). Only fall back to the authenticated
    // buffer read — now bounded by a short read timeout — when a presigned URL
    // cannot be produced (signing unavailable).
    let managedStreamUrl: string | null = null;
    if (directManagedKey && !range) {
      const signed = this.oss.signUrl(directManagedKey, 300);
      if (this.isPresignedUrl(signed)) {
        // Reuse the signature for the streaming path below instead of
        // re-signing via resolveTargetUrl().
        managedStreamUrl = signed;
      } else {
        try {
          const object = await this.oss.getObjectBuffer(directManagedKey, {
            maxBytes: PROXY_BUFFER_FALLBACK_MAX_BYTES,
          });
          this.setProxyCorsHeaders(reply);
          this.setPassthroughHeaders(reply, object.headers || {});
          if (!object.headers?.['cache-control']) {
            reply.header('cache-control', 'public, max-age=3600');
          }
          reply.status(200).send(object.buffer);
          return;
        } catch (err) {
          if (err instanceof OssReadTimeoutError) {
            reply.header('cache-control', 'no-store');
            throw new GatewayTimeoutException('Asset read timed out');
          }
          if (err instanceof OssObjectTooLargeError) {
            // Object too big to buffer; never OOM. Fail fast — client can retry
            // a presigned/streamed path or the object is genuinely oversized.
            reply.header('cache-control', 'no-store');
            throw new PayloadTooLargeException('Asset too large to proxy');
          }
          // Fall through to URL proxy path.
        }
      }
    }

    const initialUrl = managedStreamUrl ?? this.resolveTargetUrl({ url, key });

    let parsed: URL;
    try {
      parsed = new URL(initialUrl);
    } catch {
      throw new BadRequestException('Invalid URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('Unsupported URL protocol');
    }

    if (!this.isAllowedHost(parsed.hostname)) {
      throw new BadRequestException('Host not allowed');
    }

    const upstreamTimeoutMs = (() => {
      const raw =
        process.env.ASSET_PROXY_UPSTREAM_TIMEOUT_MS ||
        process.env.OSS_PROXY_TIMEOUT_MS ||
        '';
      const parsedValue = Number(raw);
      if (!Number.isFinite(parsedValue)) return DEFAULT_PROXY_UPSTREAM_TIMEOUT_MS;
      return Math.max(2_000, Math.min(60_000, Math.floor(parsedValue)));
    })();

    const fetchWithAbortAndTimeout = async (targetUrl: string): Promise<Response> => {
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => {
        timeoutController.abort();
      }, upstreamTimeoutMs);
      const onClientAbort = () => timeoutController.abort();
      abortController.signal.addEventListener('abort', onClientAbort, { once: true });
      try {
        return await fetch(targetUrl, {
          redirect: 'manual',
          headers: upstreamHeaders,
          signal: timeoutController.signal,
        });
      } finally {
        clearTimeout(timeoutId);
        abortController.signal.removeEventListener('abort', onClientAbort);
      }
    };

    const fetchWithRedirectCheck = async (inputUrl: string) => {
      let currentUrl = inputUrl;
      for (let i = 0; i < 5; i++) {
        const res = await fetchWithAbortAndTimeout(currentUrl);

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) return res;

          let next: URL;
          try {
            next = new URL(location, currentUrl);
          } catch {
            throw new BadRequestException('Invalid redirect URL');
          }

          if (next.protocol !== 'http:' && next.protocol !== 'https:') {
            throw new BadRequestException('Unsupported redirect URL protocol');
          }
          if (!this.isAllowedHost(next.hostname)) {
            throw new BadRequestException('Redirect host not allowed');
          }

          try {
            await res.body?.cancel();
          } catch {
            // ignore
          }
          currentUrl = next.toString();
          continue;
        }

        return res;
      }
      throw new BadRequestException('Too many redirects');
    };

    const fetchWithRetry = async (inputUrl: string) => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt <= MAX_PROXY_UPSTREAM_RETRIES; attempt += 1) {
        try {
          const res = await fetchWithRedirectCheck(inputUrl);
          if (RETRYABLE_PROXY_STATUS.has(res.status) && attempt < MAX_PROXY_UPSTREAM_RETRIES) {
            try {
              await res.body?.cancel();
            } catch {
              // ignore
            }
            await sleep(150 * (attempt + 1));
            continue;
          }
          return res;
        } catch (err: any) {
          if (abortedByClient) throw err;
          if (err instanceof BadRequestException || attempt >= MAX_PROXY_UPSTREAM_RETRIES) {
            throw err;
          }
          lastError = err;
          await sleep(150 * (attempt + 1));
        }
      }
      if (lastError) throw lastError;
      throw new BadGatewayException('Upstream fetch failed');
    };

    let upstream: Response;
    try {
      upstream = await fetchWithRetry(initialUrl);
    } catch (err: any) {
      if (abortedByClient) return;
      throw new BadGatewayException(err?.message || 'Upstream fetch failed');
    }
    upstreamBody = upstream.body;
    if (abortedByClient) return;

    this.setProxyCorsHeaders(reply);

    const upstreamHeaderRecord: Record<string, string> = {};
    for (const [k, v] of upstream.headers.entries()) {
      upstreamHeaderRecord[k.toLowerCase()] = v;
    }
    this.setPassthroughHeaders(reply, upstreamHeaderRecord);

    if (upstream.ok && !upstream.headers.get('cache-control')) {
      reply.header('cache-control', 'public, max-age=3600');
    }
    if (!upstream.ok) {
      reply.header('cache-control', 'no-store');
    }

    reply.status(upstream.status);

    if (!upstream.body) {
      reply.send(await this.readUpstreamArrayBufferCapped(upstream));
      return;
    }

    const fromWeb = (Readable as unknown as { fromWeb?: (stream: unknown) => Readable }).fromWeb;
    const nodeStream: Readable = typeof fromWeb === 'function'
      ? fromWeb(upstream.body as unknown)
      : Readable.from(await this.readUpstreamArrayBufferCapped(upstream));

    upstreamNodeStream = nodeStream;
    reply.send(nodeStream);
  }

  // Bounded read for the rare full-buffer fallbacks (no body stream / no
  // Readable.fromWeb). Rejects via Content-Length up-front and re-checks the
  // realized size so an oversized upstream object can't OOM the proxy.
  private async readUpstreamArrayBufferCapped(upstream: {
    headers: { get(name: string): string | null };
    arrayBuffer(): Promise<ArrayBuffer>;
  }): Promise<Buffer> {
    const declared = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > PROXY_BUFFER_FALLBACK_MAX_BYTES) {
      throw new PayloadTooLargeException('Upstream asset too large to proxy');
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > PROXY_BUFFER_FALLBACK_MAX_BYTES) {
      throw new PayloadTooLargeException('Upstream asset too large to proxy');
    }
    return buf;
  }
}
