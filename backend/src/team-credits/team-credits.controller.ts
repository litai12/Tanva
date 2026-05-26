import { Controller, Get, Param, Query, Req, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiCookieAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { TeamCreditsService } from './team-credits.service';
import { TeamSeatPackageService } from './team-seat-package.service';
import { TeamSeatCycle } from '../payment/dto/payment.dto';

@ApiTags('team-credits')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('teams/:teamId')
export class TeamCreditsController {
  constructor(
    private readonly svc: TeamCreditsService,
    private readonly seatPackageSvc: TeamSeatPackageService,
  ) {}

  @Get('credits')
  getAccount(@Req() req: any, @Param('teamId') teamId: string) {
    return this.svc.getAccount(teamId, req.user.sub);
  }

  @Get('credits/ledger')
  getLedger(
    @Req() req: any,
    @Param('teamId') teamId: string,
    @Query('take') take = '50',
    @Query('skip') skip = '0',
  ) {
    return this.svc.getLedger(teamId, req.user.sub, +take, +skip);
  }

  @Get('credits/members')
  getMemberUsages(@Req() req: any, @Param('teamId') teamId: string) {
    return this.svc.getMemberUsages(teamId, req.user.sub);
  }

  @Post('seat-packages/orders')
  createSeatOrder(
    @Req() req: any,
    @Param('teamId') teamId: string,
    @Body() body: { seats: number; cycle: TeamSeatCycle; paymentMethod: 'alipay' | 'wechat' },
  ) {
    return this.seatPackageSvc.createOrder(teamId, req.user.sub, body);
  }

  @Get('seat-packages')
  listSeatPackages(@Req() req: any, @Param('teamId') teamId: string) {
    return this.seatPackageSvc.listPackages(teamId, req.user.sub);
  }
}
