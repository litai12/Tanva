import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TeamCoreService } from '../team-core/team-core.service';
import { PaymentService } from '../payment/payment.service';
import {
  TEAM_SEAT_PLANS,
  TEAM_SEAT_MIN_SEATS,
  TEAM_PERMANENT_SEATS,
  TeamSeatCycle,
} from '../payment/dto/payment.dto';

@Injectable()
export class TeamSeatPackageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamCore: TeamCoreService,
    private readonly paymentService: PaymentService,
  ) {}

  async createOrder(
    teamId: string,
    requestingUserId: string,
    dto: { seats: number; cycle: TeamSeatCycle; paymentMethod: 'alipay' | 'wechat' },
  ) {
    await this.teamCore.assertRole(teamId, requestingUserId, ['owner', 'admin']);
    if (!Number.isInteger(dto.seats) || dto.seats < TEAM_SEAT_MIN_SEATS) {
      throw new BadRequestException(`最少购买 ${TEAM_SEAT_MIN_SEATS} 席位`);
    }
    if (!TEAM_SEAT_PLANS[dto.cycle]) {
      throw new BadRequestException('无效的套餐周期');
    }
    const plan = TEAM_SEAT_PLANS[dto.cycle];
    const amount = plan.pricePerSeat * dto.seats;
    const credits = plan.creditsPerSeat * dto.seats;

    return this.paymentService.createOrder(requestingUserId, {
      amount,
      credits,
      paymentMethod: dto.paymentMethod as any,
      orderType: 'team_seat',
      metadata: { teamId, seats: dto.seats, cycle: dto.cycle },
    });
  }

  async listPackages(teamId: string, requestingUserId: string) {
    await this.teamCore.assertMember(teamId, requestingUserId);

    // 惰性过期：查询时标记已到期的包
    await this.prisma.teamSeatPackage.updateMany({
      where: { teamId, status: 'active', expiresAt: { lt: new Date() } },
      data: { status: 'expired' },
    });

    const activePackages = await this.prisma.teamSeatPackage.findMany({
      where: { teamId, status: 'active' },
      orderBy: { expiresAt: 'asc' },
    });

    const purchasedSeats = activePackages.reduce((sum, p) => sum + p.seats, 0);
    const usedSeats = await this.prisma.teamMembership.count({ where: { teamId } });

    return {
      permanentSeats: TEAM_PERMANENT_SEATS,
      totalSeats: TEAM_PERMANENT_SEATS + purchasedSeats,
      usedSeats,
      activePackages,
    };
  }
}
