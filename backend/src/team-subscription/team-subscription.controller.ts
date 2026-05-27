import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { TeamSubscriptionService } from './team-subscription.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

@ApiTags('team-subscription')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller()
export class TeamSubscriptionController {
  constructor(private readonly svc: TeamSubscriptionService) {}

  @Get('team-plans')
  listPlans() { return this.svc.listPlans(); }

  @Get('teams/:teamId/subscription')
  getSubscription(@Req() req: any, @Param('teamId') teamId: string) {
    return this.svc.getSubscription(teamId, req.user.sub);
  }

  @Post('teams/:teamId/subscription')
  createSubscription(@Req() req: any, @Param('teamId') teamId: string, @Body() dto: CreateSubscriptionDto) {
    return this.svc.createSubscription(teamId, dto, req.user.sub);
  }

  @Delete('teams/:teamId/subscription')
  cancelSubscription(@Req() req: any, @Param('teamId') teamId: string) {
    return this.svc.cancelSubscription(teamId, req.user.sub);
  }
}
