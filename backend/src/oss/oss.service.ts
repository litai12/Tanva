// OSS helper for upload/signing and public host resolution.
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';
import OSS from 'ali-oss';
import { Readable } from 'node:stream';
import { TosClient } from '@volcengine/tos-sdk';

type PresignPolicy = {
  host: string;
  dir: string;
  expire: number;
  accessId?: string;
  policy: string;
  signature: string;
  algorithm?: string;
  credential?: string;
  date?: string;
  securityToken?: string;
};

/**
 * Thrown when an object read exceeds the dedicated proxy read timeout. Callers
 * (the asset proxy) use this to fail fast instead of falling back to another
 * slow path. See getObjectBuffer().
 */
export class OssReadTimeoutError extends Error {
  constructor(
    readonly objectKey: string,
    readonly timeoutMs: number,
  ) {
    super(`OSS read timed out after ${timeoutMs}ms for key: ${objectKey}`);
    this.name = 'OssReadTimeoutError';
  }
}

@Injectable()
export class OssService {
  constructor(private readonly config: ConfigService) {}

  private cachedClient: OSS | null = null;
  private readonly tosClients = new Map<string, TosClient>();
  private preferredTosSecret: string | null = null;
  private ossEnabledChecked = false;
  private ossEnabled = false;
  private loggedDisabled = false;

  private get conf() {
    return {
      region: this.config.get<string>('OSS_REGION') || 'oss-cn-hangzhou',
      bucket: this.config.get<string>('OSS_BUCKET') || 'your-bucket',
      accessKeyId: this.config.get<string>('OSS_ACCESS_KEY_ID') || 'test-id',
      accessKeySecret: this.config.get<string>('OSS_ACCESS_KEY_SECRET') || 'test-secret',
      sessionToken:
        this.config.get<string>('OSS_SESSION_TOKEN') ||
        this.config.get<string>('OSS_SECURITY_TOKEN') ||
        this.config.get<string>('TOS_SESSION_TOKEN') ||
        '',
      cdnHost: this.config.get<string>('OSS_CDN_HOST') || '',
      endpoint: this.config.get<string>('OSS_ENDPOINT') || undefined,
      s3Endpoint: this.config.get<string>('OSS_S3_ENDPOINT') || undefined,
    };
  }

  private isOssEnabled(): boolean {
    if (this.ossEnabledChecked) return this.ossEnabled;

    const disable =
      (this.config.get<string>('OSS_DISABLE') ?? 'false') === 'true' ||
      (this.config.get<string>('DISABLE_OSS') ?? 'false') === 'true';
    if (disable) {
      this.ossEnabled = false;
      this.ossEnabledChecked = true;
      return this.ossEnabled;
    }

    const enabledOverride = (this.config.get<string>('OSS_ENABLED') ?? 'false') === 'true';
    if (enabledOverride) {
      this.ossEnabled = true;
      this.ossEnabledChecked = true;
      return this.ossEnabled;
    }

    const { bucket, accessKeyId, accessKeySecret } = this.conf;
    this.ossEnabled =
      Boolean(bucket && accessKeyId && accessKeySecret) &&
      bucket !== 'your-bucket' &&
      accessKeyId !== 'test-id' &&
      accessKeySecret !== 'test-secret';

    this.ossEnabledChecked = true;
    return this.ossEnabled;
  }

  isEnabled(): boolean {
    return this.isOssEnabled();
  }

  diagnostics(): {
    enabled: boolean;
    bucket: string;
    region: string;
    endpoint: string;
    s3Endpoint: string;
    cdnHost: string;
    objectHost: string;
    provider: 'tos' | 'oss';
    hasAccessKeyId: boolean;
    hasAccessKeySecret: boolean;
    hasSessionToken: boolean;
  } {
    const conf = this.conf;
    const objectHost = this.resolveObjectHost();
    return {
      enabled: this.isOssEnabled(),
      bucket: conf.bucket,
      region: conf.region,
      endpoint: conf.endpoint || '',
      s3Endpoint: conf.s3Endpoint || '',
      cdnHost: conf.cdnHost || '',
      objectHost,
      provider: this.isTosHost(objectHost) ? 'tos' : 'oss',
      hasAccessKeyId: Boolean(conf.accessKeyId && conf.accessKeyId !== 'test-id'),
      hasAccessKeySecret: Boolean(conf.accessKeySecret && conf.accessKeySecret !== 'test-secret'),
      hasSessionToken: Boolean(conf.sessionToken),
    };
  }

  private logDisabledOnce() {
    if (this.loggedDisabled) return;
    this.loggedDisabled = true;
    // eslint-disable-next-line no-console
    console.warn('[OSS] OSS is disabled or not configured; skip OSS read/write operations.');
  }

  private timeoutMs(): number {
    const raw = this.config.get<string>('OSS_TIMEOUT_MS');
    const n = raw ? Number(raw) : 300000;
    if (!Number.isFinite(n)) return 300000;
    return Math.max(1000, Math.min(600000, Math.floor(n)));
  }

  // Dedicated, short timeout for object *reads* (asset proxy). Kept separate
  // from timeoutMs() — that default (5 min) must stay large for big uploads,
  // but reusing it for proxy reads let slow/dangling objects hang for minutes
  // and pile up full-image buffers, saturating the event loop (incident
  // 2026-06-15). Default 12s, clamped to [1s, 60s], override via env.
  private readTimeoutMs(): number {
    const raw = this.config.get<string>('OSS_READ_TIMEOUT_MS');
    const n = raw ? Number(raw) : 12000;
    if (!Number.isFinite(n)) return 12000;
    return Math.max(1000, Math.min(60000, Math.floor(n)));
  }

  private stripProtocolAndSlash(value: string): string {
    return value.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }

  private resolveObjectHost(): string {
    const { cdnHost, endpoint, bucket, region } = this.conf;
    if (cdnHost) return this.stripProtocolAndSlash(cdnHost);
    if (endpoint) {
      const ep = this.stripProtocolAndSlash(endpoint);
      if (!ep) return `${bucket}.${region}.aliyuncs.com`;
      if (ep === bucket || ep.startsWith(`${bucket}.`)) return ep;
      return `${bucket}.${ep}`;
    }
    return `${bucket}.${region}.aliyuncs.com`;
  }

  private isTosHost(host: string): boolean {
    const lower = String(host || '').toLowerCase();
    return lower.includes('.tos-') || lower.endsWith('.volces.com') || lower.endsWith('.ivolces.com');
  }

  private resolveTosEndpoint(): string {
    const { endpoint, s3Endpoint, bucket } = this.conf;
    // TOS SDK requires TOS endpoint (tos-xxx), not S3-compatible endpoint (tos-s3-xxx).
    const preferred = endpoint || s3Endpoint || '';
    let raw = this.stripProtocolAndSlash(preferred);
    if (!raw) return '';

    // If only a tos-s3 endpoint is provided, convert it to tos endpoint format.
    raw = raw.replace(/^tos-s3-/i, 'tos-');

    const bucketPrefix = `${bucket}.`;
    if (raw.startsWith(bucketPrefix)) return raw.slice(bucketPrefix.length);
    return raw;
  }

  private buildTosClientCacheKey(secret: string): string {
    const { accessKeyId, bucket, region, sessionToken } = this.conf;
    return [accessKeyId, secret, bucket, region, this.resolveTosEndpoint(), sessionToken || ''].join('|');
  }

  private ensureNoProxyForTosHosts(): void {
    const { bucket } = this.conf;
    const endpoint = this.resolveTosEndpoint();
    const hosts = [
      endpoint,
      endpoint ? `.${endpoint}` : '',
      endpoint ? `${bucket}.${endpoint}` : '',
      this.resolveObjectHost(),
    ].filter(Boolean);

    if (hosts.length === 0) return;

    for (const envKey of ['NO_PROXY', 'no_proxy']) {
      const current = process.env[envKey] || '';
      if (current.trim() === '*') continue;

      const values = new Set(
        current
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      );
      hosts.forEach((host) => values.add(host));
      process.env[envKey] = Array.from(values).join(',');
    }
  }

  private getTosClient(secret: string): TosClient {
    const cacheKey = this.buildTosClientCacheKey(secret);
    const cached = this.tosClients.get(cacheKey);
    if (cached) return cached;

    const { accessKeyId, bucket, region, sessionToken } = this.conf;
    const endpoint = this.resolveTosEndpoint();
    this.ensureNoProxyForTosHosts();
    const client = new TosClient({
      accessKeyId,
      accessKeySecret: secret,
      stsToken: sessionToken || undefined,
      bucket,
      region,
      endpoint: endpoint || undefined,
      secure: true,
      requestTimeout: this.timeoutMs(),
    });
    this.tosClients.set(cacheKey, client);
    return client;
  }

  private shouldRetryWithNextTosSecret(error: unknown): boolean {
    const message = String((error as any)?.message || error || '');
    return (
      /SignatureDoesNotMatch/i.test(message) ||
      /InvalidAccessKeyId/i.test(message) ||
      /InvalidSecurityToken/i.test(message) ||
      /The security token included in the request is invalid/i.test(message)
    );
  }

  private async withTosSecretCandidates<T>(
    fn: (client: TosClient, secret: string) => Promise<T>
  ): Promise<T> {
    const candidates = this.getTosSecretCandidates();
    if (candidates.length === 0) throw new Error('Missing OSS/TOS access secret');

    const ordered = this.preferredTosSecret
      ? [this.preferredTosSecret, ...candidates.filter((s) => s !== this.preferredTosSecret)]
      : candidates;

    let lastError: unknown = null;
    for (let i = 0; i < ordered.length; i += 1) {
      const secret = ordered[i];
      const client = this.getTosClient(secret);
      try {
        const result = await fn(client, secret);
        this.preferredTosSecret = secret;
        return result;
      } catch (error) {
        lastError = error;
        if (!this.shouldRetryWithNextTosSecret(error) || i === ordered.length - 1) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'TOS operation failed'));
  }

  private hmacSha256(key: string | Buffer, data: string): Buffer {
    return crypto.createHmac('sha256', key).update(data).digest();
  }

  private isPrintableAscii(value: string): boolean {
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code < 0x20 || code > 0x7e) return false;
    }
    return true;
  }

  private getTosSecretCandidates(): string[] {
    const raw = String(this.conf.accessKeySecret || '').trim();
    if (!raw) return [];
    const result = new Set<string>([raw]);
    if (/^[A-Za-z0-9+/=]+$/.test(raw) && raw.length % 4 === 0) {
      try {
        const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
        if (decoded && decoded !== raw && decoded.length >= 8 && this.isPrintableAscii(decoded)) {
          result.add(decoded);
        }
      } catch {
        // ignore invalid base64
      }
    }
    return Array.from(result);
  }

  private utcDateParts(date: Date): { short: string; full: string } {
    const pad = (n: number) => String(n).padStart(2, '0');
    const y = date.getUTCFullYear();
    const m = pad(date.getUTCMonth() + 1);
    const d = pad(date.getUTCDate());
    const hh = pad(date.getUTCHours());
    const mm = pad(date.getUTCMinutes());
    const ss = pad(date.getUTCSeconds());
    return {
      short: `${y}${m}${d}`,
      full: `${y}${m}${d}T${hh}${mm}${ss}Z`,
    };
  }

  private buildTosPresignPost(
    dir: string,
    expire: number,
    maxSize: number,
    secret: string
  ): PresignPolicy {
    const { accessKeyId, region, sessionToken } = this.conf;
    const host = `https://${this.resolveObjectHost()}`;
    const now = new Date();
    const { short, full } = this.utcDateParts(now);
    const algorithm = 'TOS4-HMAC-SHA256';
    const credential = `${accessKeyId}/${short}/${region}/tos/request`;

    const policyText = {
      expiration: new Date(expire * 1000).toISOString(),
      conditions: [
        ['content-length-range', 0, maxSize],
        ['starts-with', '$key', dir],
        { 'x-tos-algorithm': algorithm },
        { 'x-tos-credential': credential },
        { 'x-tos-date': full },
        ...(sessionToken ? [{ 'x-tos-security-token': sessionToken }] : []),
      ],
    } as const;

    const policy = Buffer.from(JSON.stringify(policyText)).toString('base64');
    // 火山 TOS 的 TOS4-HMAC-SHA256 派生 signingKey 时 SecretKey 直接使用、不加前缀，
    // 不同于 AWS S3 V4 的 "AWS4"+SecretKey。之前误加 `TOS4` 前缀导致 SignatureDoesNotMatch。
    const kDate = this.hmacSha256(secret, short);
    const kRegion = this.hmacSha256(kDate, region);
    const kService = this.hmacSha256(kRegion, 'tos');
    const kSigning = this.hmacSha256(kService, 'request');
    const signature = crypto.createHmac('sha256', kSigning).update(policy).digest('hex');

    return {
      host,
      dir,
      expire,
      policy,
      signature,
      algorithm,
      credential,
      date: full,
      securityToken: sessionToken || undefined,
    };
  }

  private async readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Buffer | Uint8Array | string>) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk));
      } else {
        chunks.push(Buffer.from(chunk));
      }
    }
    return Buffer.concat(chunks);
  }

  private normalizeHeaders(input: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (!input || typeof input !== 'object') return out;
    for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
      if (!rawKey) continue;
      if (rawValue == null) continue;
      const key = String(rawKey).toLowerCase().trim();
      if (!key) continue;
      if (Array.isArray(rawValue)) {
        out[key] = rawValue.map((v) => String(v)).join(', ');
      } else {
        out[key] = String(rawValue);
      }
    }
    return out;
  }

  private async toBuffer(input: unknown): Promise<Buffer> {
    if (Buffer.isBuffer(input)) return input;
    if (input instanceof Uint8Array) return Buffer.from(input);
    if (input instanceof ArrayBuffer) return Buffer.from(input);
    if (typeof input === 'string') return Buffer.from(input);

    const anyInput = input as any;
    if (anyInput && typeof anyInput.arrayBuffer === 'function') {
      const ab = await anyInput.arrayBuffer();
      return Buffer.from(ab);
    }

    if (anyInput && typeof anyInput.read === 'function') {
      return this.readStreamToBuffer(anyInput as NodeJS.ReadableStream);
    }
    if (anyInput && typeof anyInput[Symbol.asyncIterator] === 'function') {
      return this.readStreamToBuffer(anyInput as NodeJS.ReadableStream);
    }

    throw new Error('Unsupported object body type');
  }

  private async uploadViaTos(
    key: string,
    body: Buffer,
    contentType?: string
  ): Promise<void> {
    const normalizedKey = typeof key === 'string' ? key.trim().replace(/^\/+/, '') : '';
    if (!normalizedKey) throw new Error('Invalid object key');

    await this.withTosSecretCandidates(async (client) => {
      await client.putObject({
        key: normalizedKey,
        body,
        contentType:
          typeof contentType === 'string' && contentType.trim()
            ? contentType.trim()
            : 'application/octet-stream',
      });
    });
  }

  presignPost(dir = 'uploads/', expiresInSeconds = 300, maxSize = 20 * 1024 * 1024): PresignPolicy {
    const { accessKeyId, accessKeySecret } = this.conf;
    const host = `https://${this.resolveObjectHost()}`;
    const expire = Math.floor(Date.now() / 1000) + expiresInSeconds;

    if (this.isTosHost(this.resolveObjectHost())) {
      const candidates = this.getTosSecretCandidates();
      const signingSecret = candidates[0] || accessKeySecret;
      return this.buildTosPresignPost(dir, expire, maxSize, signingSecret);
    }

    const policyText = {
      expiration: new Date(expire * 1000).toISOString(),
      conditions: [
        ['content-length-range', 0, maxSize],
        ['starts-with', '$key', dir],
      ],
    } as const;
    const policy = Buffer.from(JSON.stringify(policyText)).toString('base64');
    const signature = crypto.createHmac('sha1', accessKeySecret).update(policy).digest('base64');
    return { host, dir, expire, accessId: accessKeyId, policy, signature };
  }

  private client(): OSS {
    if (this.cachedClient) return this.cachedClient;
    const { region, bucket, accessKeyId, accessKeySecret, endpoint } = this.conf;
    this.cachedClient = new OSS({
      region,
      bucket,
      accessKeyId,
      accessKeySecret,
      endpoint,
      timeout: this.timeoutMs(),
    });
    return this.cachedClient;
  }

  async putStream(
    key: string,
    stream: NodeJS.ReadableStream,
    options?: any
  ): Promise<{ key: string; url: string }> {
    if (!this.isOssEnabled()) {
      this.logDisabledOnce();
      throw new Error('OSS is disabled');
    }

    if (this.isTosHost(this.resolveObjectHost())) {
      const buffer = await this.readStreamToBuffer(stream);
      const contentType = options?.headers?.['Content-Type'] || options?.headers?.['content-type'];
      await this.uploadViaTos(key, buffer, contentType);
      return { key, url: this.publicUrl(key) };
    }

    const client = this.client();
    await client.putStream(key, stream, options as any);
    return { key, url: this.publicUrl(key) };
  }

  async putBuffer(
    key: string,
    buffer: Buffer,
    contentType?: string
  ): Promise<{ key: string; url: string }> {
    if (!this.isOssEnabled()) {
      this.logDisabledOnce();
      return { key, url: '' };
    }

    if (this.isTosHost(this.resolveObjectHost())) {
      await this.uploadViaTos(key, buffer, contentType);
      return { key, url: this.publicUrl(key) };
    }

    const client = this.client();
    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = contentType;
    await client.put(key, buffer, { headers });
    return { key, url: this.publicUrl(key) };
  }

  async putJSON(
    key: string,
    data: unknown,
    options?: { acl?: 'private' | 'public-read' | 'public-read-write' }
  ) {
    if (!this.isOssEnabled()) {
      this.logDisabledOnce();
      return key;
    }

    try {
      const body = Buffer.from(JSON.stringify(data));
      if (this.isTosHost(this.resolveObjectHost())) {
        await this.withTosSecretCandidates(async (client) => {
          await client.putObject({
            key,
            body,
            contentType: 'application/json',
          });
        });
      } else {
        const client = this.client();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (options?.acl) headers['x-oss-object-acl'] = options.acl;
        await client.put(key, body, { headers });
      }

      console.log(`OSS putJSON success: ${key}`);
      return key;
    } catch (error: any) {
      console.warn(`OSS putJSON failed: ${error.message || error}`);
      return key;
    }
  }

  async getJSON<T = unknown>(key: string): Promise<T | null> {
    if (!this.isOssEnabled()) {
      this.logDisabledOnce();
      return null;
    }

    try {
      let content = '';
      if (this.isTosHost(this.resolveObjectHost())) {
        const tosData = await this.withTosSecretCandidates(async (client) => {
          const res = await client.getObject({ key });
          return res.data;
        });
        const buffer = Buffer.isBuffer(tosData) ? tosData : Buffer.from(tosData as any);
        content = buffer.toString('utf8');
      } else {
        const client = this.client();
        const res = await client.get(key);
        content = res.content?.toString() || '';
      }

      if (!content) return null;
      return JSON.parse(content) as T;
    } catch (err: any) {
      if (err?.name === 'NoSuchKeyError' || err?.code === 'NoSuchKey') {
        return null;
      }
      console.warn(`OSS getJSON failed: ${err.message || err}`);
      return null;
    }
  }

  async getObjectBuffer(
    key: string,
    opts?: { timeoutMs?: number },
  ): Promise<{ key: string; buffer: Buffer; headers: Record<string, string> }> {
    const normalizedKey = typeof key === 'string' ? key.trim().replace(/^\/+/, '') : '';
    if (!normalizedKey) throw new Error('Invalid object key');
    if (!this.isOssEnabled()) throw new Error('OSS is disabled');

    const timeoutMs =
      typeof opts?.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs)
        ? Math.max(1000, Math.min(60000, Math.floor(opts.timeoutMs)))
        : this.readTimeoutMs();

    // Bound every read. The SDK clients carry timeoutMs() (default 5 min) so
    // uploads can finish; that is far too long for a proxy read. We pass a
    // short per-call timeout to the SDK *and* race a guard so the caller is
    // unblocked even if the SDK ignores it. The background SDK promise is
    // swallowed so a late settle after the race never becomes an unhandled
    // rejection.
    const withReadTimeout = <T>(work: Promise<T>): Promise<T> => {
      let timer: NodeJS.Timeout | undefined;
      const guard = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new OssReadTimeoutError(normalizedKey, timeoutMs)),
          timeoutMs,
        );
      });
      work.catch(() => {
        // Late settle after a race timeout — intentionally ignored.
      });
      return Promise.race([work, guard]).finally(() => {
        if (timer) clearTimeout(timer);
      }) as Promise<T>;
    };

    if (this.isTosHost(this.resolveObjectHost())) {
      const tosResult = await withReadTimeout(
        this.withTosSecretCandidates(async (client) => {
          // requestTimeout is honored per-call by newer SDKs and harmlessly
          // ignored by older ones (the Promise.race guard still applies).
          return await client.getObject({ key: normalizedKey, requestTimeout: timeoutMs } as any);
        }),
      );
      const payload =
        (tosResult as any)?.data ??
        (tosResult as any)?.content ??
        (tosResult as any)?.body ??
        tosResult;
      const buffer = await this.toBuffer(payload);
      const headers = this.normalizeHeaders((tosResult as any)?.headers);
      return { key: normalizedKey, buffer, headers };
    }

    const client = this.client();
    // 2-arg form: ali-oss treats a non-stream/non-string 2nd arg as options and
    // returns the object body as a buffer in result.content.
    const aliResult = await withReadTimeout(
      client.get(normalizedKey, { timeout: timeoutMs } as any),
    );
    const payload =
      (aliResult as any)?.content ??
      (aliResult as any)?.data ??
      aliResult;
    const buffer = await this.toBuffer(payload);
    const headers = this.normalizeHeaders((aliResult as any)?.res?.headers || (aliResult as any)?.headers);
    return { key: normalizedKey, buffer, headers };
  }

  signUrl(key: string, expiresInSeconds = 300): string {
    const normalizedKey = typeof key === 'string' ? key.trim().replace(/^\/+/, '') : '';
    if (!normalizedKey) return '';
    if (!this.isOssEnabled()) return this.publicUrl(normalizedKey);

    if (this.isTosHost(this.resolveObjectHost())) {
      try {
        const candidates = this.getTosSecretCandidates();
        if (candidates.length === 0) return this.publicUrl(normalizedKey);
        const ordered = this.preferredTosSecret
          ? [this.preferredTosSecret, ...candidates.filter((s) => s !== this.preferredTosSecret)]
          : candidates;

        for (let i = 0; i < ordered.length; i += 1) {
          try {
            const client = this.getTosClient(ordered[i]);
            const signed = client.getPreSignedUrl({
              key: normalizedKey,
              method: 'GET',
              expires: Math.max(30, Math.min(3600, Math.floor(expiresInSeconds))),
            });
            this.preferredTosSecret = ordered[i];
            if (typeof signed === 'string' && signed.trim()) return signed;
          } catch (error) {
            if (!this.shouldRetryWithNextTosSecret(error) || i === ordered.length - 1) {
              break;
            }
          }
        }
      } catch {
        return this.publicUrl(normalizedKey);
      }
      return this.publicUrl(normalizedKey);
    }

    try {
      const client = this.client();
      return client.signatureUrl(normalizedKey, {
        expires: Math.max(30, Math.min(3600, Math.floor(expiresInSeconds))),
        method: 'GET',
      } as any);
    } catch {
      return this.publicUrl(normalizedKey);
    }
  }

  publicUrl(key: string): string {
    return `https://${this.resolveObjectHost()}/${key}`;
  }

  publicHosts(): string[] {
    const { endpoint, bucket, region } = this.conf;
    const hosts = [this.resolveObjectHost(), `${bucket}.${region}.aliyuncs.com`];
    if (endpoint) hosts.push(this.stripProtocolAndSlash(endpoint));
    return Array.from(new Set(hosts)).filter(Boolean);
  }

  allowedPublicHosts(): string[] {
    const { cdnHost, endpoint, bucket, region } = this.conf;
    const hosts = [this.resolveObjectHost(), `${bucket}.${region}.aliyuncs.com`];

    if (cdnHost) hosts.push(this.stripProtocolAndSlash(cdnHost));
    if (endpoint) hosts.push(this.stripProtocolAndSlash(endpoint));

    const extraHosts = this.config.get<string>('ALLOWED_PROXY_HOSTS');
    if (extraHosts) {
      extraHosts.split(',').forEach((h) => {
        const trimmed = h.trim();
        if (trimmed) hosts.push(this.stripProtocolAndSlash(trimmed));
      });
    }

    const defaultAllowed = [
      'aliyuncs.com',
      'amazonaws.com.cn',
      'amazonaws.com',
      's3.cn-northwest-1.amazonaws.com.cn',
      'apimart.ai',
      'apib.ai', // APIMart 生成视频的 CDN 域名（如 upload.apib.ai），与 apimart.ai 不同，需单列
      'kechuangai.com',
      'models.kapon.cloud',
      'volces.com',
      'tencentcos.cn',
      'myqcloud.com',
      'tgtai.com',
    ];

    defaultAllowed.forEach((h) => hosts.push(h));
    return Array.from(new Set(hosts)).filter(Boolean);
  }

  /**
   * Append resize params for first-party OSS image URLs to reduce payload size.
   * Non-OSS URLs are returned as-is.
   */
  withImageResize(url: string, maxLongSide = 2048): string {
    if (!url || !url.startsWith('http')) return url;
    try {
      const { cdnHost, bucket, region } = this.conf;
      const ossHost = `${bucket}.${region}.aliyuncs.com`;
      const u = new URL(url);
      const isOss =
        u.hostname === ossHost ||
        (cdnHost && u.hostname === cdnHost.replace(/^https?:\/\//i, '').replace(/\/+$/, ''));
      if (!isOss) return url;
      if (u.searchParams.has('x-oss-process')) return url;
      u.searchParams.set(
        'x-oss-process',
        `image/resize,l_${maxLongSide},m_lfit/format,jpg/quality,q_85`,
      );
      return u.toString();
    } catch {
      return url;
    }
  }
}
