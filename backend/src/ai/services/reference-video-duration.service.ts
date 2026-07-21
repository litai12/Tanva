import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { promises as dns } from 'dns';
import { promises as fs } from 'fs';
import { isIP } from 'net';
import * as os from 'os';
import * as path from 'path';

const DEFAULT_MAX_DOWNLOAD_MB = 64;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

const parsePositiveInt = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

@Injectable()
export class ReferenceVideoDurationService {
  private readonly logger = new Logger(ReferenceVideoDurationService.name);
  private readonly maxDownloadBytes =
    parsePositiveInt(process.env.MAX_FILE_DOWNLOAD_MB, DEFAULT_MAX_DOWNLOAD_MB) * 1024 * 1024;
  private readonly downloadTimeoutMs = parsePositiveInt(
    process.env.REFERENCE_VIDEO_DOWNLOAD_TIMEOUT_MS,
    DEFAULT_DOWNLOAD_TIMEOUT_MS,
  );
  private readonly probeTimeoutMs = parsePositiveInt(
    process.env.REFERENCE_VIDEO_PROBE_TIMEOUT_MS,
    DEFAULT_PROBE_TIMEOUT_MS,
  );

  async sumDurations(rawUrls: unknown[]): Promise<{
    durations: Array<{ url: string; durationSec: number }>;
    totalDurationSec: number;
  }> {
    const urls = Array.from(
      new Set(
        rawUrls
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );

    const durations: Array<{ url: string; durationSec: number }> = [];
    for (const url of urls) {
      durations.push({ url, durationSec: await this.probeDuration(url) });
    }

    return {
      durations,
      totalDurationSec: Number(
        durations.reduce((total, item) => total + item.durationSec, 0).toFixed(3),
      ),
    };
  }

  async probeDuration(rawUrl: string): Promise<number> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tanva-reference-video-'));
    const tempPath = path.join(tempDir, 'reference.mp4');

    try {
      await this.downloadToFile(rawUrl, tempPath);
      return await this.probeLocalFile(tempPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Reference video duration probe failed: ${message}`);
      throw new BadRequestException('无法读取参考视频时长，请确认视频链接可访问且为有效 MP4');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async downloadToFile(rawUrl: string, targetPath: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.downloadTimeoutMs);

    try {
      let currentUrl = rawUrl;
      for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
        const parsed = await this.parseAndValidatePublicUrl(currentUrl);
        const response = await fetch(parsed, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location || redirectCount === MAX_REDIRECTS) {
            throw new Error('reference video redirect limit exceeded');
          }
          await response.body?.cancel().catch(() => undefined);
          currentUrl = new URL(location, parsed).toString();
          continue;
        }

        if (!response.ok || !response.body) {
          throw new Error(`reference video download returned HTTP ${response.status}`);
        }

        const declaredLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(declaredLength) && declaredLength > this.maxDownloadBytes) {
          throw new Error('reference video exceeds the maximum download size');
        }

        const file = await fs.open(targetPath, 'w');
        let written = 0;
        try {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            written += value.byteLength;
            if (written > this.maxDownloadBytes) {
              await reader.cancel();
              throw new Error('reference video exceeds the maximum download size');
            }
            await file.write(value);
          }
        } finally {
          await file.close();
        }
        return;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseAndValidatePublicUrl(rawUrl: string): Promise<URL> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error('invalid reference video URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('reference video URL must use http or https');
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
      throw new Error('reference video URL points to a local host');
    }

    const addresses = isIP(hostname)
      ? [hostname]
      : (await dns.lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
    if (addresses.length === 0 || addresses.some((address) => !this.isPublicAddress(address))) {
      throw new Error('reference video URL resolves to a non-public address');
    }
    return parsed;
  }

  private isPublicAddress(address: string): boolean {
    const normalized = address.toLowerCase();
    const mappedIpv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1];
    if (mappedIpv4) return this.isPublicIpv4(mappedIpv4);
    if (isIP(normalized) === 4) return this.isPublicIpv4(normalized);
    if (isIP(normalized) !== 6) return false;

    return !(
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('ff')
    );
  }

  private isPublicIpv4(address: string): boolean {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      return false;
    }
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }

  private probeLocalFile(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback();
      };
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        finish(() => reject(new Error('ffprobe timed out')));
      }, this.probeTimeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-500);
      });
      child.on('error', (error) => finish(() => reject(error)));
      child.on('close', (code) => {
        if (code !== 0) {
          finish(() => reject(new Error(`ffprobe failed: ${stderr}`)));
          return;
        }
        const duration = Number(stdout.trim());
        if (!Number.isFinite(duration) || duration <= 0) {
          finish(() => reject(new Error('ffprobe returned an invalid duration')));
          return;
        }
        finish(() => resolve(Number(duration.toFixed(3))));
      });
    });
  }
}
