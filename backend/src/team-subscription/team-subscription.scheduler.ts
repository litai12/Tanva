import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TeamSubscriptionService } from './team-subscription.service';

@Injectable()
export class TeamSubscriptionScheduler {
  private readonly logger = new Logger(TeamSubscriptionScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly subService: TeamSubscriptionService,
  ) {}

  @Cron('*/5 * * * *')
  async handleRenewal() {
    if (this.running) return;
    this.running = true;
    try {
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
    } finally {
      this.running = false;
    }
  }
}
