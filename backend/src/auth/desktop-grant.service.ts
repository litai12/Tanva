import { BadRequestException, ConflictException, Injectable, OnModuleDestroy, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import Redis from 'ioredis';

type GrantStatus = 'pending' | 'approved' | 'denied' | 'consumed';
export interface DesktopGrant {
  id: string; state: string; challenge: string; csrf: string;
  status: GrantStatus; expiresAt: number; userId?: string;
}
export interface CreateDesktopGrant {
  state: string; challenge: string; challengeMethod: string; callbackUrl: string;
}
const TTL_MS = 5 * 60_000;
const KEY_PREFIX = 'tanva:desktop-auth:';
const token = () => randomBytes(32).toString('base64url');
const equal = (a: string, b: string) => {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const CAS = `local value = redis.call('GET', KEYS[1]); if not value then return 0 end; local row = cjson.decode(value); if row.status ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL'); return 1`;

/** Short-lived PKCE grants contain no tokens. Production uses atomic Redis
 * transitions across API instances; native cookies use the existing auth service. */
@Injectable()
export class DesktopGrantService implements OnModuleDestroy {
  private readonly redis?: Redis;
  private readonly memory = new Map<string, DesktopGrant>();
  private readonly production: boolean;
  constructor(config: ConfigService) {
    this.production = !['test', 'development'].includes(config.get<string>('NODE_ENV') || '');
    const redisUrl = config.get<string>('REDIS_URL');
    if (redisUrl) {
      this.redis = new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
      this.redis.on('error', () => { /* Requests report 503; never log credentials/Redis URLs. */ });
    }
  }
  async onModuleDestroy() { this.redis?.disconnect(); }
  private available() {
    if (this.production && !this.redis) throw new ServiceUnavailableException('桌面授权需要配置 REDIS_URL');
  }
  private async withStore<T>(work: () => Promise<T>): Promise<T> {
    this.available();
    try { return await work(); }
    catch (error) {
      if (error instanceof BadRequestException || error instanceof UnauthorizedException || error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException('桌面授权存储不可用，请稍后重试', { cause: error });
    }
  }
  async create(input: CreateDesktopGrant) {
    if (!input || !/^[A-Za-z0-9_-]{43}$/.test(input.state) || !/^[A-Za-z0-9_-]{43}$/.test(input.challenge)
      || input.challengeMethod !== 'S256' || input.callbackUrl !== 'tanva://auth/callback') throw new BadRequestException('无效桌面授权请求');
    return this.withStore(async () => {
      const grant: DesktopGrant = { id: token(), state: input.state, challenge: input.challenge, csrf: token(), status: 'pending', expiresAt: Date.now() + TTL_MS };
      if (this.redis) {
        if (await this.redis.set(`${KEY_PREFIX}${grant.id}`, JSON.stringify(grant), 'PX', TTL_MS, 'NX') !== 'OK') throw new Error('Grant collision');
      } else {
        for (const [id, existing] of this.memory) if (existing.expiresAt <= Date.now()) this.memory.delete(id);
        if (this.memory.size >= 1000) throw new ServiceUnavailableException('桌面授权请求过多');
        this.memory.set(grant.id, grant);
      }
      return grant;
    });
  }
  async read(id: string): Promise<DesktopGrant | null> {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id)) throw new BadRequestException('无效桌面授权会话');
    return this.withStore(async () => {
      const row = this.redis ? await this.redis.get(`${KEY_PREFIX}${id}`) : this.memory.get(id);
      const grant: DesktopGrant | null = typeof row === 'string' ? JSON.parse(row) as DesktopGrant : row ?? null;
      return grant && grant.expiresAt > Date.now() ? grant : null;
    });
  }
  private async transition(previous: DesktopGrant, next: DesktopGrant) {
    return this.withStore(async () => {
      if (this.redis) return Number(await this.redis.eval(CAS, 1, `${KEY_PREFIX}${previous.id}`, previous.status, JSON.stringify(next))) === 1;
      if (this.memory.get(previous.id)?.status !== previous.status) return false;
      this.memory.set(previous.id, next); return true;
    });
  }
  async approve(id: string, csrf: string, userId: string, decision: string) {
    const grant = await this.read(id);
    if (!grant) throw new BadRequestException('桌面授权已过期');
    if (typeof csrf !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(csrf) || !equal(csrf, grant.csrf)) throw new UnauthorizedException('授权页面校验失败');
    if (decision !== 'approve' && decision !== 'deny') throw new BadRequestException('无效授权决定');
    if (grant.status !== 'pending') throw new ConflictException('此授权已处理');
    const next: DesktopGrant = { ...grant, status: decision === 'approve' ? 'approved' : 'denied', userId };
    if (!await this.transition(grant, next)) throw new ConflictException('此授权已处理');
    return { status: next.status, callbackUrl: `tanva://auth/callback?state=${encodeURIComponent(grant.state)}` };
  }
  async exchange(id: string, state: string, verifier: string): Promise<{ status: 'pending' | 'denied' | 'expired' } | { status: 'authorized'; userId: string }> {
    const grant = await this.read(id);
    if (!grant) return { status: 'expired' };
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state) || !equal(state, grant.state) || typeof verifier !== 'string'
      || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier) || !equal(createHash('sha256').update(verifier).digest('base64url'), grant.challenge)) throw new UnauthorizedException('桌面授权校验失败');
    if (grant.status === 'pending' || grant.status === 'denied') return { status: grant.status };
    if (grant.status !== 'approved' || !grant.userId) throw new ConflictException('授权已兑换，请重新发起登录');
    if (!await this.transition(grant, { ...grant, status: 'consumed' })) throw new ConflictException('授权已兑换');
    return { status: 'authorized', userId: grant.userId };
  }
}
