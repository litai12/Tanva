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

  async putJSON(key: string, data: unknown) {
    const client = this.client();
    const body = Buffer.from(JSON.stringify(data));
    await client.put(key, body, { headers: { 'Content-Type': 'application/json' } });
    return key;
  }

  publicUrl(key: string): string {
    const { cdnHost, bucket, region } = this.conf;
    const host = cdnHost || `${bucket}.${region}.aliyuncs.com`;
    return `https://${host}/${key}`;
  }
}
