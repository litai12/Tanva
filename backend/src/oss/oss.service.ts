// OSS helper for upload/signing and public host resolution.
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';
import OSS from 'ali-oss';

type PresignPolicy = {
  host: string;
  dir: string;
  expire: number;
  accessId: string;
  policy: string;
  signature: string;
};

@Injectable()
export class OssService {
  constructor(private readonly config: ConfigService) {}

  private cachedClient: OSS | null = null;
  private ossEnabledChecked = false;
  private ossEnabled = false;
  private loggedDisabled = false;

  private get conf() {
    return {
      region: this.config.get<string>('OSS_REGION') || 'oss-cn-hangzhou',
      bucket: this.config.get<string>('OSS_BUCKET') || 'your-bucket',
      accessKeyId: this.config.get<string>('OSS_ACCESS_KEY_ID') || 'test-id',
      accessKeySecret: this.config.get<string>('OSS_ACCESS_KEY_SECRET') || 'test-secret',
      cdnHost: this.config.get<string>('OSS_CDN_HOST') || '',
      endpoint: this.config.get<string>('OSS_ENDPOINT') || undefined,
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
    // 未显式配置 OSS 时（仍为默认占位符），直接视为禁用，避免每次请求都卡在公网超时。
    this.ossEnabled =
      Boolean(bucket && accessKeyId && accessKeySecret) &&
      bucket !== 'your-bucket' &&
      accessKeyId !== 'test-id' &&
      accessKeySecret !== 'test-secret';

    this.ossEnabledChecked = true;
    return this.ossEnabled;
  }

  /**
   * OSS 是否已启用（并且已配置真实 bucket/ak/sk）。
   * 仅用于在需要“必须上传成功”的场景做前置校验。
   */
  isEnabled(): boolean {
    return this.isOssEnabled();
  }

  private logDisabledOnce() {
    if (this.loggedDisabled) return;
    this.loggedDisabled = true;
    // eslint-disable-next-line no-console
    console.warn('[OSS] OSS 未配置或已禁用，将跳过 OSS 读写（仅使用数据库内容）。');
  }

  private timeoutMs(): number {
    const raw = this.config.get<string>('OSS_TIMEOUT_MS');
    const n = raw ? Number(raw) : 8000;
    if (!Number.isFinite(n)) return 8000;
    return Math.max(1000, Math.min(120000, Math.floor(n)));
  }

  presignPost(dir = 'uploads/', expiresInSeconds = 300, maxSize = 20 * 1024 * 1024): PresignPolicy {
    const { region, bucket, accessKeyId, accessKeySecret } = this.conf;
    const host = `https://${bucket}.${region}.aliyuncs.com`;
    const expire = Math.floor(Date.now() / 1000) + expiresInSeconds;

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
    const client = this.client();
    await client.putStream(key, stream, options as any);
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
      const client = this.client();
      const body = Buffer.from(JSON.stringify(data));
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (options?.acl) {
        headers['x-oss-object-acl'] = options.acl;
      }
      await client.put(key, body, { headers });
      console.log(`OSS putJSON success: ${key}`);
      return key;
    } catch (error: any) {
      console.warn(`OSS putJSON failed: ${error.message || error}`);
      // 在开发环境中，OSS错误不应该阻止应用正常运行
      // 可以考虑将数据保存到本地文件系统作为备选方案
      return key;
    }
  }

  async getJSON<T = unknown>(key: string): Promise<T | null> {
    if (!this.isOssEnabled()) {
      this.logDisabledOnce();
      return null;
    }
    try {
      const client = this.client();
      const res = await client.get(key);
      const content = res.content?.toString();
      if (!content) return null;
      return JSON.parse(content) as T;
    } catch (err: any) {
      if (err?.name === 'NoSuchKeyError' || err?.code === 'NoSuchKey') {
        return null;
      }
      // 处理其他OSS错误（如bucket不存在等）
      console.warn(`OSS getJSON failed: ${err.message || err}`);
      return null;
    }
  }

  publicUrl(key: string): string {
    const { cdnHost, bucket, region } = this.conf;
    const host = cdnHost || `${bucket}.${region}.aliyuncs.com`;
    return `https://${host}/${key}`;
  }

  publicHosts(): string[] {
    const { cdnHost, bucket, region } = this.conf;
    const stripProtocol = (value: string) => value.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const hosts = [`${bucket}.${region}.aliyuncs.com`];
    if (cdnHost) {
      hosts.push(stripProtocol(cdnHost));
    }
    return Array.from(new Set(hosts)).filter(Boolean);
  }

  allowedPublicHosts(): string[] {
    const { cdnHost, bucket, region } = this.conf;
    const stripProtocol = (value: string) => value.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    
    // 基础允许的域名：当前配置的 OSS 域名
    const hosts = [`${bucket}.${region}.aliyuncs.com`];
    
    // 如果配置了 CDN 域名
    if (cdnHost) {
      hosts.push(stripProtocol(cdnHost));
    }

    // 从环境变量 ALLOWED_PROXY_HOSTS 读取额外的白名单域名 (逗号分隔)
    const extraHosts = this.config.get<string>('ALLOWED_PROXY_HOSTS');
    if (extraHosts) {
      extraHosts.split(',').forEach(h => {
        const trimmed = h.trim();
        if (trimmed) hosts.push(stripProtocol(trimmed));
      });
    }

    // 默认内置一些常用的 AI 供应商资源域名，避免用户频繁配置
    const defaultAllowed = [
      'kechuangai.com',      // Kling / 可灵
      'v2-fdl.kechuangai.com',
      'models.kapon.cloud',  // Kapon / Vidu / Kling
      'volces.com',          // 字节/豆包
      'ark.cn-beijing.volces.com',
      'ark-project-oss-cn-beijing.volces.com',
      'alicdn.com',
      'aliyuncs.com',        // 允许所有阿里云 OSS 域名（可选，如果需要更宽松的话）
    ];
    
    defaultAllowed.forEach(h => hosts.push(h));

    return Array.from(new Set(hosts)).filter(Boolean);
  }
}
