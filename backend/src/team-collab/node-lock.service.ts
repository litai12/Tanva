import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type RedisClient = any;

const LOCK_PREFIX = 'canvas:lock:';
const LOCK_TTL_SEC = 10;

function lockKey(projectId: string, nodeId: string): string {
  return `${LOCK_PREFIX}${projectId}:${nodeId}`;
}

function scanPattern(projectId: string): string {
  return `${LOCK_PREFIX}${projectId}:*`;
}

export interface LockInfo {
  nodeId: string;
  userId: string;
  connId: string;
  expiresAt: number;
}

@Injectable()
export class NodeLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NodeLockService.name);
  private client: RedisClient | undefined;
  private inMemory = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      this.logger.warn('REDIS_URL not configured; node locks run in-process only');
      return;
    }
    try {
      const IORedis = require('ioredis');
      this.client = new IORedis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
      this.client.on('error', (err: Error) => {
        this.logger.warn(`NodeLockService Redis error: ${err.message}`);
      });
    } catch (err) {
      this.logger.warn(`ioredis init failed: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client?.quit();
    } catch {}
  }

  private encodeValue(userId: string, connId: string): string {
    return `${userId}|${connId}`;
  }

  private decodeValue(raw: string | null | undefined): { userId: string; connId: string } | null {
    if (!raw) return null;
    const idx = raw.indexOf('|');
    if (idx < 0) return null;
    return { userId: raw.slice(0, idx), connId: raw.slice(idx + 1) };
  }

  async claim(
    projectId: string,
    nodeId: string,
    userId: string,
    connId: string,
  ): Promise<{ acquired: boolean; holder?: { userId: string; connId: string }; expiresAt: number }> {
    const key = lockKey(projectId, nodeId);
    const value = this.encodeValue(userId, connId);
    const expiresAt = Date.now() + LOCK_TTL_SEC * 1000;
    if (this.client) {
      try {
        const result = await this.client.set(key, value, 'NX', 'EX', LOCK_TTL_SEC);
        if (result === 'OK') return { acquired: true, expiresAt };
        const current = await this.client.get(key);
        const holder = this.decodeValue(current);
        if (holder && holder.userId === userId && holder.connId === connId) {
          await this.client.expire(key, LOCK_TTL_SEC);
          return { acquired: true, expiresAt };
        }
        return { acquired: false, holder: holder ?? undefined, expiresAt };
      } catch (err) {
        this.logger.warn(`Redis claim failed: ${(err as Error).message}`);
      }
    }
    // in-memory fallback
    const existing = this.inMemory.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      const holder = this.decodeValue(existing.value);
      if (holder && holder.userId === userId && holder.connId === connId) {
        existing.expiresAt = expiresAt;
        return { acquired: true, expiresAt };
      }
      return { acquired: false, holder: holder ?? undefined, expiresAt: existing.expiresAt };
    }
    this.inMemory.set(key, { value, expiresAt });
    return { acquired: true, expiresAt };
  }

  async renew(
    projectId: string,
    nodeId: string,
    userId: string,
    connId: string,
  ): Promise<{ acquired: boolean; expiresAt: number }> {
    const key = lockKey(projectId, nodeId);
    const value = this.encodeValue(userId, connId);
    const expiresAt = Date.now() + LOCK_TTL_SEC * 1000;
    if (this.client) {
      try {
        const current = await this.client.get(key);
        if (current !== value) {
          return { acquired: false, expiresAt: 0 };
        }
        await this.client.expire(key, LOCK_TTL_SEC);
        return { acquired: true, expiresAt };
      } catch (err) {
        this.logger.warn(`Redis renew failed: ${(err as Error).message}`);
        return { acquired: false, expiresAt: 0 };
      }
    }
    const existing = this.inMemory.get(key);
    if (existing && existing.value === value && existing.expiresAt > Date.now()) {
      existing.expiresAt = expiresAt;
      return { acquired: true, expiresAt };
    }
    return { acquired: false, expiresAt: 0 };
  }

  async release(
    projectId: string,
    nodeId: string,
    userId: string,
    connId: string,
  ): Promise<boolean> {
    const key = lockKey(projectId, nodeId);
    const value = this.encodeValue(userId, connId);
    if (this.client) {
      try {
        const current = await this.client.get(key);
        if (current !== value) return false;
        await this.client.del(key);
        return true;
      } catch (err) {
        this.logger.warn(`Redis release failed: ${(err as Error).message}`);
        return false;
      }
    }
    const existing = this.inMemory.get(key);
    if (existing && existing.value === value) {
      this.inMemory.delete(key);
      return true;
    }
    return false;
  }

  async releaseByConn(projectId: string, connId: string): Promise<string[]> {
    const released: string[] = [];
    if (this.client) {
      try {
        let cursor = '0';
        const pattern = scanPattern(projectId);
        do {
          const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
          cursor = String(next);
          for (const key of keys as string[]) {
            try {
              const val = await this.client.get(key);
              const holder = this.decodeValue(val);
              if (holder && holder.connId === connId) {
                await this.client.del(key);
                const nodeId = key.slice(`${LOCK_PREFIX}${projectId}:`.length);
                released.push(nodeId);
              }
            } catch {}
          }
        } while (cursor !== '0');
        return released;
      } catch (err) {
        this.logger.warn(`Redis releaseByConn failed: ${(err as Error).message}`);
      }
    }
    const prefix = `${LOCK_PREFIX}${projectId}:`;
    for (const [key, val] of this.inMemory) {
      if (!key.startsWith(prefix)) continue;
      const holder = this.decodeValue(val.value);
      if (holder && holder.connId === connId) {
        this.inMemory.delete(key);
        released.push(key.slice(prefix.length));
      }
    }
    return released;
  }

  async releaseByUser(projectId: string, userId: string): Promise<string[]> {
    const released: string[] = [];
    if (this.client) {
      try {
        let cursor = '0';
        const pattern = scanPattern(projectId);
        do {
          const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
          cursor = String(next);
          for (const key of keys as string[]) {
            try {
              const val = await this.client.get(key);
              const holder = this.decodeValue(val);
              if (holder && holder.userId === userId) {
                await this.client.del(key);
                released.push(key.slice(`${LOCK_PREFIX}${projectId}:`.length));
              }
            } catch {}
          }
        } while (cursor !== '0');
        return released;
      } catch (err) {
        this.logger.warn(`Redis releaseByUser failed: ${(err as Error).message}`);
      }
    }
    const prefix = `${LOCK_PREFIX}${projectId}:`;
    for (const [key, val] of this.inMemory) {
      if (!key.startsWith(prefix)) continue;
      const holder = this.decodeValue(val.value);
      if (holder && holder.userId === userId) {
        this.inMemory.delete(key);
        released.push(key.slice(prefix.length));
      }
    }
    return released;
  }

  get lockTtlMs(): number {
    return LOCK_TTL_SEC * 1000;
  }
}
