import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

let IORedis: any;
try {
  // optional dependency
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  IORedis = require('ioredis');
} catch (e) {
  IORedis = null;
}

let AliSmsClient: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  AliSmsClient = require('@alicloud/sms-sdk');
} catch (e) {
  AliSmsClient = null;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private redisClient: any | undefined;
  private memoryStore = new Map<string, { code: string; expiresAt: number }>();
  private lockStore = new Map<string, number>();

  constructor(private readonly config: ConfigService) {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (redisUrl && IORedis) {
      this.redisClient = new IORedis(redisUrl);
    }
  }

  private genCode(): string {
    // always produce 6 digits (may start with 0)
    return Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  }

  private async setCode(phone: string, code: string, ttlSec = 300) {
    if (this.redisClient) {
      await this.redisClient.setex(`sms_code:${phone}`, ttlSec, code);
      return;
    }
    const expiresAt = Date.now() + ttlSec * 1000;
    this.memoryStore.set(phone, { code, expiresAt });
    // schedule cleanup
    setTimeout(() => {
      const cur = this.memoryStore.get(phone);
      if (cur && cur.expiresAt <= Date.now()) this.memoryStore.delete(phone);
    }, ttlSec * 1000 + 1000);
  }

  private async getCode(phone: string) {
    if (this.redisClient) {
      return await this.redisClient.get(`sms_code:${phone}`);
    }
    const item = this.memoryStore.get(phone);
    if (!item) return null;
    if (item.expiresAt < Date.now()) {
      this.memoryStore.delete(phone);
      return null;
    }
    return item.code;
  }

  private async delCode(phone: string) {
    if (this.redisClient) {
      await this.redisClient.del(`sms_code:${phone}`);
    } else {
      this.memoryStore.delete(phone);
    }
  }

  /**
   * Send verification code to phone and store it (ttl seconds)
   * Returns debugCode in dev/debug mode.
   */
  async sendCode(phone: string): Promise<{ ok: true; debugCode?: string }> {
    // 限流：同一手机号 60 秒内只允许一次发送
    const lockKey = `sms_lock:${phone}`;
    const lockTtlSec = 60;
    if (this.redisClient) {
      // Redis 原子限流：SET lockKey 1 NX EX 60
      try {
        const allowed = await this.redisClient.set(lockKey, '1', 'NX', 'EX', lockTtlSec);
        if (!allowed) {
          throw new Error(`请等待 ${lockTtlSec} 秒后再试`);
        }
      } catch (err) {
        // 如果 Redis 出错，退回到内存限流逻辑 below
        this.logger.warn('Redis 限流检查失败，退回到内存限流', err);
      }
    } else {
      const prev = this.lockStore.get(phone);
      if (prev && prev > Date.now()) {
        const remain = Math.ceil((prev - Date.now()) / 1000);
        throw new Error(`请等待 ${remain} 秒后再试`);
      }
      this.lockStore.set(phone, Date.now() + lockTtlSec * 1000);
      // 清理任务
      setTimeout(() => {
        const t = this.lockStore.get(phone);
        if (t && t <= Date.now()) this.lockStore.delete(phone);
      }, lockTtlSec * 1000 + 1000);
    }

    const ttl = Number(this.config.get<number>('SMS_CODE_TTL') ?? 300);
    const code = this.genCode();

    // If Ali SMS client is available and keys exist, try to call it.
    if (AliSmsClient && this.config.get('ALI_ACCESS_KEY_ID') && this.config.get('ALI_ACCESS_KEY_SECRET')) {
      // @alicloud/sms-sdk usage
      const client = new AliSmsClient({
        accessKeyId: this.config.get('ALI_ACCESS_KEY_ID'),
        secretAccessKey: this.config.get('ALI_ACCESS_KEY_SECRET'),
      });
      const params = {
        PhoneNumbers: phone,
        SignName: this.config.get('ALI_SIGN_NAME'),
        TemplateCode: this.config.get('ALI_TEMPLATE_CODE'),
        TemplateParam: JSON.stringify({ code }),
      };
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const res = await client.sendSMS(params);
        if (res?.Code !== 'OK') {
          this.logger.warn(`Ali SMS send failed: ${res?.Message || JSON.stringify(res)}`);
          // 发送失败，释放 Redis 限流键或内存锁，允许立即重试
          try {
            if (this.redisClient) await this.redisClient.del(lockKey);
            else this.lockStore.delete(phone);
          } catch (e) {
            /* ignore cleanup errors */
          }
          throw new Error(res?.Message || 'aliyun sms error');
        }
      } catch (err) {
        this.logger.warn(`Ali SMS send error: ${String(err)}`);
        throw err;
      }
    } else {
      this.logger.log(`SMS not sent (missing ALI keys). Generated code=${code} for ${phone}`);
    }

    // 写入验证码（如果使用 Redis 则写入 Redis；否则内存）
    await this.setCode(phone, code, ttl);

    return { ok: true };
  }

  async verifyCode(phone: string, inputCode: string) {
    const real = await this.getCode(phone);
    if (!real) return { ok: false, msg: '验证码已过期' };
    if (real !== inputCode) return { ok: false, msg: '验证码错误' };
    await this.delCode(phone);
    return { ok: true };
  }
}

