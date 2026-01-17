import { BadGatewayException, BadRequestException, Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { OssService } from './oss.service';

@ApiTags('assets')
@Controller('assets')
export class AssetsController {
  constructor(private readonly oss: OssService) {}

  private resolveTargetUrl(params: { url?: string; key?: string }): string {
    const key = typeof params.key === 'string' ? params.key.trim() : '';
    if (key) {
      return this.oss.publicUrl(key.replace(/^\/+/, ''));
    }

    const url = typeof params.url === 'string' ? params.url.trim() : '';
    if (!url) {
      throw new BadRequestException('Missing `url` or `key`');
    }
    return url;
  }

  private isAllowedHost(hostname: string): boolean {
    const allowed = this.oss.allowedPublicHosts();
    // 支持精确匹配和后缀匹配（如 .aliyuncs.com）
    return allowed.some(host =>
      hostname === host || hostname.endsWith('.' + host) || hostname.endsWith(host)
    );
  }

  @Get('proxy')
  @ApiOperation({ summary: 'Proxy public OSS assets to avoid browser CORS' })
  @ApiQuery({ name: 'url', required: false, description: 'Full remote URL (must be an allowed OSS/CDN host)' })
  @ApiQuery({ name: 'key', required: false, description: 'OSS object key (alternative to url)' })
  async proxy(
    @Res() reply: FastifyReply,
    @Req() req: FastifyRequest,
    @Query('url') url?: string,
    @Query('key') key?: string
  ) {
    const abortController = new AbortController();
    let abortedByClient = false;
    let upstreamBody: ReadableStream<Uint8Array> | null = null;

    const abortUpstream = () => {
      if (abortedByClient) return;
      abortedByClient = true;
      try {
        abortController.abort();
      } catch {
        // ignore
      }
      try {
        upstreamBody?.cancel();
      } catch {
        // ignore
      }
    };

    // 客户端中断时：取消上游请求，避免继续拉取大文件占用内存/连接池。
    // 注意：FastifyReply.raw 是 Node ServerResponse。
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

    const initialUrl = this.resolveTargetUrl({ url, key });

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

    const pickHeader = (name: string): string | undefined => {
      const raw = (req.headers as Record<string, unknown>)[name];
      return typeof raw === 'string' ? raw : undefined;
    };

    const upstreamHeaders: Record<string, string> = {};
    const range = pickHeader('range');
    const ifNoneMatch = pickHeader('if-none-match');
    const ifModifiedSince = pickHeader('if-modified-since');
    if (range) upstreamHeaders['range'] = range;
    if (ifNoneMatch) upstreamHeaders['if-none-match'] = ifNoneMatch;
    if (ifModifiedSince) upstreamHeaders['if-modified-since'] = ifModifiedSince;

    const fetchWithRedirectCheck = async (inputUrl: string) => {
      let currentUrl = inputUrl;
      for (let i = 0; i < 5; i++) {
        const res = await fetch(currentUrl, {
          redirect: 'manual',
          headers: upstreamHeaders,
          signal: abortController.signal,
        });

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

          // 继续跟随重定向前，必须显式取消/消费上一个响应体，否则 undici 会占用连接与内存。
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

    let upstream: Response;
    try {
      upstream = await fetchWithRedirectCheck(initialUrl);
    } catch (err: any) {
      if (abortedByClient) return;
      throw new BadGatewayException(err?.message || 'Upstream fetch failed');
    }
    upstreamBody = upstream.body;
    if (abortedByClient) return;

    // 设置 CORS 头，允许跨域访问（用于视频抽帧等场景）
    reply.header('access-control-allow-origin', '*');
    reply.header(
      'access-control-expose-headers',
      'content-type,content-length,content-range,accept-ranges,etag,last-modified,cache-control'
    );
    reply.header('cross-origin-resource-policy', 'cross-origin');

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
      const value = upstream.headers.get(name);
      if (value) reply.header(name, value);
    });

    // 仅对成功响应缓存，避免把偶发的 4xx/5xx “缓存成空白图”。
    // 上游若未提供 cache-control，则设置一个温和的默认值。
    if (upstream.ok && !upstream.headers.get('cache-control')) {
      reply.header('cache-control', 'public, max-age=3600');
    }
    if (!upstream.ok) {
      reply.header('cache-control', 'no-store');
    }

    reply.status(upstream.status);

    if (!upstream.body) {
      reply.send(Buffer.from(await upstream.arrayBuffer()));
      return;
    }

    // Node fetch 返回 Web ReadableStream；转为 Node stream 以支持流式转发（视频 Range/seek）
    const fromWeb = (Readable as unknown as { fromWeb?: (stream: unknown) => NodeJS.ReadableStream }).fromWeb;
    const nodeStream: NodeJS.ReadableStream = typeof fromWeb === 'function'
      ? fromWeb(upstream.body as unknown)
      : Readable.from(Buffer.from(await upstream.arrayBuffer()));

    reply.send(nodeStream);
  }
}
