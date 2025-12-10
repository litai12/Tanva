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
    const { region, bucket, accessKeyId, accessKeySecret, endpoint } = this.conf;
    return new OSS({ region, bucket, accessKeyId, accessKeySecret, endpoint });
  }

  async putStream(
    key: string,
    stream: NodeJS.ReadableStream,
    options?: OSS.PutStreamOptions
  ): Promise<{ key: string; url: string }> {
    const client = this.client();
    await client.putStream(key, stream, options);
    return { key, url: this.publicUrl(key) };
  }

  async putJSON(key: string, data: unknown) {
    try {
      const client = this.client();
      const body = Buffer.from(JSON.stringify(data));
      await client.put(key, body, { headers: { 'Content-Type': 'application/json' } });
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
}
