import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from './tenant-context.service';

/**
 * 跨租户迭代共享助手。
 *
 * 用途：cron / BullMQ worker / setInterval 等脱离 CLS 的入口，
 * 默认会落主站（default）。把原方法体整体包进 forEachTenant，
 * 每个 active 租户在自己的 CLS 内跑、被 Prisma 扩展自动限定到本租户数据。
 *
 * 回归安全：当系统只有 default 一个 active 租户时，forEachTenant 只迭代一次，
 * 行为与改动前完全一致。
 */
@Injectable()
export class TenantIterationService {
  private readonly logger = new Logger(TenantIterationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * 列出所有 active 租户 id。
   * Tenant 是全局白名单表；用 runAsPlatform 保证查询不被租户注入。
   */
  async listActiveTenantIds(): Promise<string[]> {
    const tenants = await this.tenantContext.runAsPlatform(() =>
      this.prisma.tenant.findMany({
        where: { status: 'active' },
        select: { id: true },
      }),
    );
    return tenants.map((t) => t.id);
  }

  /**
   * 对每个 active 租户，在该租户的 CLS 内执行 fn。
   * 单个租户抛错会被记录并跳过，不影响其它租户。
   */
  async forEachTenant(fn: (tenantId: string) => Promise<void> | void): Promise<void> {
    const tenantIds = await this.listActiveTenantIds();
    for (const tenantId of tenantIds) {
      try {
        await this.tenantContext.runAsTenant(tenantId, () => fn(tenantId));
      } catch (error) {
        this.logger.error(
          `forEachTenant failed for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }
}
