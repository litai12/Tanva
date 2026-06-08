import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TenantIterationService } from '../tenancy/tenant-iteration.service';
import { TeamSubscriptionService } from './team-subscription.service';

@Injectable()
export class TeamSubscriptionScheduler {
  private readonly logger = new Logger(TeamSubscriptionScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantIteration: TenantIterationService,
    private readonly subService: TeamSubscriptionService,
  ) {}

  @Cron('*/5 * * * *')
  async handleRenewal() {
    if (this.running) return;
    this.running = true;
    try {
      // cron 脱离 CLS（默认落主站）：逐租户在各自 CLS 内跑，入口 findMany 被扩展限定到本租户。
      // 仅 default 一个 active 租户时 = 原逻辑跑一次（回归安全）。
      await this.tenantIteration.forEachTenant(() => this.renewDueForCurrentTenant());
    } finally {
      this.running = false;
    }
  }

  private async renewDueForCurrentTenant() {
    const due = await this.prisma.teamSubscription.findMany({
      where: { status: 'active', nextCreditRenewalAt: { lte: new Date() } },
      take: 50,
    });
    for (const sub of due) {
      await this.subService.renewSubscription(sub).catch((e) =>
        this.logger.error(`续期失败 subId=${sub.id}: ${e}`),
      );
    }
    if (due.length) this.logger.log(`团队积分续期完成，处理 ${due.length} 条订阅`);
  }
}
