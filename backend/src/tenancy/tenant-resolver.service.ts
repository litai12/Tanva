import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PLATFORM_TENANT_ID } from './tenant.constants';
import { normalizeHost } from './host.util';

/**
 * 由 ClsModule 的 setup 在「CLS 上下文已建立」时调用，解析请求 Host → tenantId。
 * 用 setup 而非独立中间件：保证在 nestjs-cls 上下文内执行，cls.set 才生效（Fastify 下
 * 独立中间件会跑在上下文之外）。
 * - 已登记域名 → 对应租户
 * - 未登记域名：默认兜底主站（非破坏性）；TENANT_STRICT_HOST=true 时拒绝 404（codex#7）。
 */
@Injectable()
export class TenantResolverService {
  // host -> tenantId 带 TTL 的进程内缓存。增删域名后靠 TTL（默认 60s）兜底失效，
  // 把域名迁移/删除的错配窗口限制在 TTL 内（多实例无需共享缓存）。
  private cache = new Map<string, { tenantId: string; expireAt: number }>();
  private readonly ttlMs = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private now(): number {
    return Number(process.hrtime.bigint() / 1_000_000n);
  }

  async resolve(req: any): Promise<string> {
    const trustForwarded = this.config.get('TRUST_FORWARDED_HOST') === 'true';
    const rawHost =
      trustForwarded && req?.headers?.['x-forwarded-host']
        ? req.headers['x-forwarded-host']
        : req?.headers?.['host'];
    const host = normalizeHost(rawHost);

    const hit = host ? this.cache.get(host) : undefined;
    let tenantId = hit && hit.expireAt > this.now() ? hit.tenantId : undefined;
    if (host && !tenantId) {
      const row = await (this.prisma as any).tenantDomain.findUnique({ where: { host } });
      if (row) {
        tenantId = row.tenantId as string;
        this.cache.set(host, { tenantId, expireAt: this.now() + this.ttlMs });
      }
    }

    if (!tenantId) {
      if (this.config.get('TENANT_STRICT_HOST') === 'true') {
        throw new NotFoundException('站点未配置'); // 严格模式拒绝未知域名
      }
      tenantId = PLATFORM_TENANT_ID; // 默认兜底主站
    }
    return tenantId;
  }
}
