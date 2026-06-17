import { Injectable, BadRequestException } from '@nestjs/common';
import { TeamCoreService } from '../team-core/team-core.service';
import { PaymentService } from '../payment/payment.service';
import {
  CREDITS_PER_YUAN,
  TEAM_CREDITS_MIN_AMOUNT,
} from '../payment/dto/payment.dto';

@Injectable()
export class TeamCreditsTopupService {
  constructor(
    private readonly teamCore: TeamCoreService,
    private readonly paymentService: PaymentService,
  ) {}

  async createOrder(
    teamId: string,
    requestingUserId: string,
    dto: { amount: number; paymentMethod: 'alipay' | 'wechat' },
  ) {
    await this.teamCore.assertRole(teamId, requestingUserId, ['owner', 'admin']);

    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount < TEAM_CREDITS_MIN_AMOUNT) {
      throw new BadRequestException(`最低充值金额为 ¥${TEAM_CREDITS_MIN_AMOUNT}`);
    }

    const credits = Math.round(amount * CREDITS_PER_YUAN);

    return this.paymentService.createOrder(requestingUserId, {
      amount,
      credits,
      paymentMethod: dto.paymentMethod as any,
      orderType: 'team_credits',
      metadata: { teamId },
    });
  }
}
