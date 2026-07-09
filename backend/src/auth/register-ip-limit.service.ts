import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

let IORedis: any;
try {
  // optional dependency（与 sms.service 一致）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  IORedis = require("ioredis");
} catch (e) {
  IORedis = null;
}

/**
 * 注册 IP 限流：同一 IP 每天最多注册 REGISTER_IP_DAILY_LIMIT 个账号（默认 1，0 = 关闭）。
 * 优先用 Redis（REDIS_URL）跨进程共享计数；无 Redis 时退回进程内存
 * （pm2 多实例时内存计数各自独立，上限会放大为 实例数×限额，生产建议配 REDIS_URL）。
 */
@Injectable()
export class RegisterIpLimitService {
  private readonly logger = new Logger(RegisterIpLimitService.name);
  private redisClient: any | undefined;
  private memoryStore = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly config: ConfigService) {
    const redisUrl = this.config.get<string>("REDIS_URL");
    if (redisUrl && IORedis) {
      this.redisClient = new IORedis(redisUrl);
    }
  }

  private get dailyLimit(): number {
    const raw = this.config.get<string>("REGISTER_IP_DAILY_LIMIT");
    if (raw === undefined || raw === null || raw === "") return 1;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
  }

  private isUncountableIp(ip?: string | null): boolean {
    if (!ip) return true;
    // 回环地址说明反代真实 IP 透传失败，强行限流会把全站用户拦死，放行并告警
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  }

  private buildKey(ip: string): string {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return `reg_ip_daily:${ip}:${day}`;
  }

  private async getCount(key: string): Promise<number> {
    if (this.redisClient) {
      const v = await this.redisClient.get(key);
      return v ? Number(v) || 0 : 0;
    }
    const item = this.memoryStore.get(key);
    if (!item || item.expiresAt < Date.now()) {
      if (item) this.memoryStore.delete(key);
      return 0;
    }
    return item.count;
  }

  /** 注册前检查；超限抛 400 */
  async assertAllowed(ip?: string | null): Promise<void> {
    const limit = this.dailyLimit;
    if (limit <= 0) return;
    if (this.isUncountableIp(ip)) {
      this.logger.warn(
        `注册 IP 限流未生效：拿到的客户端 IP 是 ${ip || "空"}（检查 trustProxy 与 nginx X-Forwarded-For 配置）`
      );
      return;
    }
    const count = await this.getCount(this.buildKey(ip as string));
    if (count >= limit) {
      this.logger.warn(`注册被 IP 限流拦截: ip=${ip} 今日已注册 ${count} 次`);
      throw new BadRequestException("该网络环境今日注册次数已达上限，请明天再试");
    }
  }

  /** 注册成功后计数（TTL 覆盖到次日） */
  async record(ip?: string | null): Promise<void> {
    if (this.dailyLimit <= 0 || this.isUncountableIp(ip)) return;
    const key = this.buildKey(ip as string);
    const ttlSec = 25 * 3600;
    try {
      if (this.redisClient) {
        await this.redisClient.incr(key);
        await this.redisClient.expire(key, ttlSec);
        return;
      }
      const now = Date.now();
      const item = this.memoryStore.get(key);
      if (item && item.expiresAt > now) {
        item.count += 1;
      } else {
        this.memoryStore.set(key, { count: 1, expiresAt: now + ttlSec * 1000 });
      }
      // 顺手清理过期键，避免长期堆积
      if (this.memoryStore.size > 10000) {
        for (const [k, v] of this.memoryStore) {
          if (v.expiresAt <= now) this.memoryStore.delete(k);
        }
      }
    } catch (e) {
      this.logger.warn(`注册 IP 计数写入失败（不阻断注册）: ${e instanceof Error ? e.message : e}`);
    }
  }
}
