import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';

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
}

