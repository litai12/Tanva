import { BadRequestException, Injectable } from '@nestjs/common';
import { promises as dns } from 'node:dns';
import { promises as fs } from 'node:fs';
import { BlockList, isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Agent } from 'undici';
import sharp from 'sharp';
import { OssService } from '../../oss/oss.service';

// The deployed Gemini 3.1 ToAPIs reference downloader rejects files > 20 MiB.
// This is a model/channel constraint, not the original asset/upload size limit.
export const TOAPIS_REFERENCE_MAX_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
const MAX_INPUT_PIXELS = 40_000_000;

/** Only apply verified contracts. Do not transfer one model's cap to other routes.
 * Gemini 3.1: deployed ToAPIs download rejection says 20 MiB.
 * GPT Image 2: https://docs.toapis.com/docs/cn/api-reference/images/gpt-image-2/edits
 * documents PNG/JPG inputs up to 50 MB; Tencent stable has a separate contract.
 */
export function imageReferenceByteLimit(model: unknown, options?: any): number | undefined {
  const identity = String(model || '').trim().toLowerCase();
  if (/^gemini-3\.1-(?:image(?:-edit|-blend)?|flash-image-preview)$/.test(identity)) {
    return TOAPIS_REFERENCE_MAX_BYTES;
  }
  if (identity === 'gpt-image-2' &&
      (options?.banana?.imageRoute || options?.bananaImageRoute) !== 'stable') return 50_000_000;
  return undefined;
}

export function needsToapisReferencePreparation(model: unknown, options?: any): boolean {
  return imageReferenceByteLimit(model, options) !== undefined;
}

const blockedAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) blockedAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 96], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10],
  ['ff00::', 8], ['2001:db8::', 32], ['2001::', 32],
  ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['2002::', 16],
] as const) blockedAddresses.addSubnet(address, prefix, 'ipv6');

export function isPublicImageAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  return !blockedAddresses.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

export interface PreparedImageReference {
  originalUrl: string;
  preparedUrl: string;
  originalBytes: number;
  preparedBytes: number;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  format: string;
}

@Injectable()
export class ImageReferencePreparationService {
  // Limit decoded native image memory independently of BullMQ's job concurrency.
  private active = 0;
  private activeHeads = 0;
  private readonly waitingHeads: Array<() => void> = [];
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly oss: OssService) {}

  async prepare(urls: string[], model: unknown, options?: any): Promise<{
    urls: string[];
    adjustments: PreparedImageReference[];
  }> {
    const limit = imageReferenceByteLimit(model, options);
    if (limit === undefined || !urls.length) {
      return { urls, adjustments: [] };
    }
    const results = new Map<string, { url: string; adjustment?: PreparedImageReference }>();
    const uniqueUrls = [...new Set(urls)];
    const probes = await Promise.allSettled(uniqueUrls.map(url =>
      this.withHeadSlot(() => this.probeSize(url))));
    // Download/transform only references requiring it; retain render URLs and order.
    for (const [index, url] of uniqueUrls.entries()) {
      const probe = probes[index];
      if (probe.status === 'rejected') throw probe.reason;
      const size = probe.value;
      results.set(url, size !== undefined && size <= limit
        ? { url } : await this.withSlot(() => this.prepareOne(url, limit)));
    }
    return {
      urls: urls.map(url => results.get(url)!.url),
      adjustments: [...results.values()].flatMap(result => result.adjustment ? [result.adjustment] : []),
    };
  }

  private async withSlot<T>(run: () => Promise<T>): Promise<T> {
    if (this.active >= 2) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active += 1;
    try { return await run(); }
    finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }

  private async prepareOne(url: string, limit: number): Promise<{ url: string; adjustment?: PreparedImageReference }> {
    const directory = await fs.mkdtemp(join(tmpdir(), 'tanva-image-reference-'));
    const input = join(directory, 'input');
    try {
      const bytes = await this.download(url, input);
      if (bytes <= limit) return { url };
      const prepared = await this.compress(input, limit);
      const key = `uploads/ai/references/${randomUUID()}.${prepared.format === 'jpeg' ? 'jpg' : 'png'}`;
      const upload = await this.oss.putBufferWithHeaders(key, prepared.buffer,
        prepared.format === 'jpeg' ? 'image/jpeg' : 'image/png',
        { 'Cache-Control': 'public, max-age=31536000, immutable' });
      if (!upload.url.startsWith('https://')) throw new Error('prepared image must have a remote HTTPS URL');
      return { url: upload.url, adjustment: {
        originalUrl: url, preparedUrl: upload.url,
        originalBytes: bytes, preparedBytes: prepared.buffer.length,
        originalWidth: prepared.originalWidth, originalHeight: prepared.originalHeight,
        width: prepared.width, height: prepared.height, format: prepared.format,
      } };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      // Do not leak presigned URLs or storage credentials in native/fetch errors.
      throw new BadRequestException('无法准备远程参考图，请确认图片可访问且大小不超过 64MiB');
    } finally {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async compress(input: string, limit: number): Promise<{
    buffer: Buffer; format: 'png' | 'jpeg'; width: number; height: number;
    originalWidth: number; originalHeight: number;
  }> {
    const open = () => sharp(input, { sequentialRead: true, limitInputPixels: MAX_INPUT_PIXELS });
    const metadata = await open().metadata();
    if (!metadata.width || !metadata.height || (metadata.pages || 1) > 1) {
      throw new BadRequestException('超限参考图必须是有效的单帧图片');
    }
    const originalWidth = metadata.width;
    const originalHeight = metadata.height;
    const encode = async (format: 'png' | 'jpeg', width?: number) => {
      let pipeline = open().rotate();
      if (width) pipeline = pipeline.resize({ width, withoutEnlargement: true });
      const result = await (format === 'png'
        ? pipeline.png({ compressionLevel: 9 })
        : pipeline.jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
      ).toBuffer({ resolveWithObject: true });
      return { buffer: result.data, width: result.info.width, height: result.info.height,
        format, originalWidth, originalHeight };
    };
    // PNG recompression preserves alpha and source pixels. Never flatten transparency.
    let candidate = await encode('png');
    if (candidate.buffer.length <= limit) return candidate;
    // Generated PNGs often contain an all-255 alpha channel. That is still
    // opaque and can use a same-size JPEG; actual transparent pixels stay PNG.
    const hasTransparency = metadata.hasAlpha && !(await open().stats()).isOpaque;
    const format = hasTransparency ? 'png' : 'jpeg';
    if (format === 'jpeg') candidate = await encode(format);
    if (candidate.buffer.length <= limit) return candidate;
    let width = candidate.width;
    for (let step = 0; step < 12; step += 1) {
      const scale = Math.min(0.85, Math.sqrt(limit / candidate.buffer.length) * 0.95);
      width = Math.max(1, Math.floor(width * scale));
      candidate = await encode(format, width);
      if (candidate.buffer.length <= limit) return candidate;
    }
    throw new BadRequestException(`无法将参考图调整到当前型号的 ${limit} 字节限额`);
  }

  private async validateUrl(raw: string): Promise<{ url: URL; addresses: Array<{ address: string; family: number }> }> {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new BadRequestException('参考图必须是无登录凭据的公网 HTTP(S) URL');
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }]
      : await dns.lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(item => !isPublicImageAddress(item.address))) {
      throw new BadRequestException('参考图 URL 不得指向本机或私有网络');
    }
    return { url, addresses };
  }

  private async withHeadSlot<T>(run: () => Promise<T>): Promise<T> {
    if (this.activeHeads >= 8) await new Promise<void>(resolve => this.waitingHeads.push(resolve));
    else this.activeHeads += 1;
    try { return await run(); }
    finally {
      const next = this.waitingHeads.shift();
      if (next) next();
      else this.activeHeads -= 1;
    }
  }

  private async publicResponse(rawUrl: string, method: 'HEAD' | 'GET', signal: AbortSignal): Promise<{
    response: Response; dispose: () => Promise<void>;
  }> {
    let currentUrl = rawUrl;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const { url, addresses } = await this.validateUrl(currentUrl);
      // Bind each connection to its checked addresses to avoid DNS rebinding.
      const dispatcher = new Agent({ connect: { lookup: ((_hostname: any, options: any, callback: any) => {
        const entries = options.family ? addresses.filter(item => item.family === options.family) : addresses;
        if (!entries.length) return callback(new Error('no public address in requested family'));
        if (options.all) callback(null, entries);
        else callback(null, entries[0].address, entries[0].family);
      }) as any } });
      try {
        const response = await fetch(url, { method, redirect: 'manual', signal, dispatcher } as any);
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          await dispatcher.close();
          if (!location || redirects === MAX_REDIRECTS) throw new Error('redirect limit');
          currentUrl = new URL(location, url).toString();
          continue;
        }
        return { response, dispose: () => dispatcher.destroy() };
      } catch (error) {
        await dispatcher.close();
        throw error;
      }
    }
    throw new Error('redirect limit');
  }

  private async probeSize(url: string): Promise<number | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const { response, dispose } = await this.publicResponse(url, 'HEAD', controller.signal);
      try {
        const lengthHeader = response.headers.get('content-length');
        const length = Number(lengthHeader);
        const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const encoding = (response.headers.get('content-encoding') || 'identity').toLowerCase();
        return response.ok && lengthHeader !== null && Number.isSafeInteger(length) && length > 0 &&
          encoding === 'identity' &&
          ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)
          ? length : undefined;
      } finally {
        await response.body?.cancel();
        await dispose();
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      // HEAD is optional; unsupported/missing metadata falls back to the bounded GET.
      return undefined;
    } finally { clearTimeout(timeout); }
  }

  private async download(rawUrl: string, path: string): Promise<number> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const { response, dispose } = await this.publicResponse(rawUrl, 'GET', controller.signal);
      try {
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          throw new Error('image download failed');
        }
        if (Number(response.headers.get('content-length')) > DOWNLOAD_MAX_BYTES) {
          await response.body.cancel();
          throw new BadRequestException('参考图超过 64MiB 下载上限');
        }
        const file = await fs.open(path, 'w');
        const reader = response.body.getReader();
        let bytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > DOWNLOAD_MAX_BYTES) throw new BadRequestException('参考图超过 64MiB 下载上限');
            await file.write(value);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
          await file.close();
        }
        if (!bytes) throw new Error('empty reference image');
        return bytes;
      } finally { await dispose(); }
    } finally { clearTimeout(timeout); }
  }
}
