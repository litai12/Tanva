import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";

let IORedis: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  IORedis = require("ioredis");
} catch (_error) {
  IORedis = null;
}

export const WECHAT_LOGIN_SESSION_COOLDOWN_MS = 5_000;

type WechatLoginVisitor = {
  clientId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

@Injectable()
export class WechatLoginSessionRateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(WechatLoginSessionRateLimitService.name);
  private readonly memoryLocks = new Map<string, number>();
  private readonly redisClient: any | undefined;
  private redisUnavailableUntil = 0;

  constructor(private readonly config: ConfigService) {
    const redisUrl = this.config.get<string>("REDIS_URL");
    if (redisUrl && IORedis) {
      this.redisClient = new IORedis(redisUrl, {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      });
      this.redisClient.on("error", () => {
        // Redis 异常时 assertAllowed 会回退到进程内锁，避免刷日志风暴。
      });
    }
  }

  async onModuleDestroy() {
    if (!this.redisClient) return;
    try {
      await this.redisClient.quit();
    } catch {
      this.redisClient.disconnect();
    }
  }

  private normalizeClientId(clientId?: string | null) {
    const value = typeof clientId === "string" ? clientId.trim() : "";
    return /^[a-zA-Z0-9_-]{16,128}$/.test(value) ? value : null;
  }

  private normalizeIp(ip?: string | null) {
    const value = typeof ip === "string" ? ip.trim() : "";
    return value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
  }

  private buildKey(visitor: WechatLoginVisitor) {
    const clientId = this.normalizeClientId(visitor.clientId);
    const identity = clientId
      ? `client:${clientId}`
      : `network:${this.normalizeIp(visitor.ip) || "unknown"}|ua:${(
          visitor.userAgent || "unknown"
        ).slice(0, 256)}`;
    const digest = createHash("sha256").update(identity).digest("hex");
    return `wechat_login_session_refresh:${digest}`;
  }

  private reject(retryAfterMs: number): never {
    const normalizedRetryAfterMs = Math.max(1, Math.ceil(retryAfterMs));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `二维码刷新过于频繁，请 ${Math.ceil(
          normalizedRetryAfterMs / 1000
        )} 秒后再试`,
        retryAfterMs: normalizedRetryAfterMs,
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }

  private assertAllowedInMemory(key: string) {
    const now = Date.now();
    const lockedUntil = this.memoryLocks.get(key) || 0;
    if (lockedUntil > now) {
      this.reject(lockedUntil - now);
    }

    this.memoryLocks.set(key, now + WECHAT_LOGIN_SESSION_COOLDOWN_MS);
    if (this.memoryLocks.size > 10_000) {
      for (const [storedKey, expiresAt] of this.memoryLocks) {
        if (expiresAt <= now) this.memoryLocks.delete(storedKey);
      }
    }
  }

  async assertAllowed(visitor: WechatLoginVisitor) {
    const key = this.buildKey(visitor);
    if (this.redisClient && Date.now() >= this.redisUnavailableUntil) {
      try {
        const acquired = await this.redisClient.set(
          key,
          "1",
          "PX",
          WECHAT_LOGIN_SESSION_COOLDOWN_MS,
          "NX"
        );
        if (acquired === "OK") return;

        const remainingMs = Number(await this.redisClient.pttl(key));
        this.reject(
          Number.isFinite(remainingMs) && remainingMs > 0
            ? remainingMs
            : WECHAT_LOGIN_SESSION_COOLDOWN_MS
        );
      } catch (error) {
        if (error instanceof HttpException) throw error;
        this.redisUnavailableUntil = Date.now() + 30_000;
        this.logger.warn(
          `微信登录二维码 Redis 限流不可用，回退到进程内锁: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    this.assertAllowedInMemory(key);
  }
}
