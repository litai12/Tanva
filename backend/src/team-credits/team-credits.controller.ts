import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiCookieAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { TeamCreditsService } from './team-credits.service';

@ApiTags('team-credits')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('teams/:teamId')
export class TeamCreditsController {
  constructor(private readonly svc: TeamCreditsService) {}

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

}
