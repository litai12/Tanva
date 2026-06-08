import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from './tenant-context.service';
import { PLATFORM_TENANT_ID } from './tenant.constants';

export type NewApiKeyTier = 'normal' | 'vip' | 'svip';

interface TenantKeys {
  normal: string | null;
  vip: string | null;
  svip: string | null;
}

/**
 * 按当前请求租户解析 new-api 三组 key（普通/VIP/SVIP）。
 * - 主站(default)或租户未配置该档 → 回落传入的平台 env key（不破坏现有）
 * - 子租户配了 → 用租户自己的 key（实现 AI 成本按租户分账的前提）
 * Tenant 属全局白名单表，普通 prisma 读取即可跨租户。
 */
@Injectable()
export class NewApiKeyResolver {
  // 带 TTL 的进程内缓存：本实例 setApiKeys 会主动失效；多实例/多进程靠 TTL 兜底
  // 把改 key 后的错账窗口限制在 TTL 内（默认 60s）。
  private cache = new Map<string, { keys: TenantKeys; expireAt: number }>();
  private readonly ttlMs = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** 租户 key 变更后调用，清本实例缓存 */
  invalidate(tenantId?: string) {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }

  private now(): number {
    // 避免直接用 Date.now()（脚本环境受限）；用单调时间
    return Number(process.hrtime.bigint() / 1_000_000n);
  }

  private async getTenantKeys(tenantId: string): Promise<TenantKeys> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expireAt > this.now()) return cached.keys;
    const t = await (this.prisma as any).tenant.findUnique({
      where: { id: tenantId },
      select: { newApiKey: true, newApiKeyVip: true, newApiKeySvip: true },
    });
    const keys: TenantKeys = {
      normal: t?.newApiKey ?? null,
      vip: t?.newApiKeyVip ?? null,
      svip: t?.newApiKeySvip ?? null,
    };
    this.cache.set(tenantId, { keys, expireAt: this.now() + this.ttlMs });
    return keys;
  }

  /**
   * @param tier      档位
   * @param envFallback 平台 env 对应档位的 key（租户未配时返回它）
   */
  async resolve(tier: NewApiKeyTier, envFallback: string): Promise<string> {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId || tenantId === PLATFORM_TENANT_ID) return envFallback;
    const keys = await this.getTenantKeys(tenantId);
    const k = tier === 'svip' ? keys.svip : tier === 'vip' ? keys.vip : keys.normal;
    return (k && k.trim()) || envFallback;
  }
}
