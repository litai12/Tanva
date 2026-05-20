import {
  Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiCookieAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { TeamCoreService } from './team-core.service';
import { TeamInviteService } from './team-invite.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

@ApiTags('teams')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller()
export class TeamCoreController {
  constructor(
    private readonly teamCore: TeamCoreService,
    private readonly teamInvite: TeamInviteService,
  ) {}

  @Post('teams')
  create(@Req() req: any, @Body() dto: CreateTeamDto) {
    return this.teamCore.createTeam(req.user.sub, dto);
  }

  @Get('teams')
  myTeams(@Req() req: any) {
    return this.teamCore.getMyTeams(req.user.sub);
  }

  @Get('teams/:teamId')
  getTeam(@Req() req: any, @Param('teamId') teamId: string) {
    return this.teamCore.getTeam(teamId, req.user.sub);
  }

  @Delete('teams/:teamId')
  dissolve(@Req() req: any, @Param('teamId') teamId: string) {
    return this.teamCore.dissolveTeam(teamId, req.user.sub);
  }

  @Get('teams/:teamId/members')
  members(@Req() req: any, @Param('teamId') teamId: string) {
    return this.teamCore.getMembers(teamId, req.user.sub);
  }

  @Patch('teams/:teamId/members/:userId')
  updateRole(
    @Req() req: any,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.teamCore.updateMemberRole(teamId, userId, dto.role, req.user.sub);
  }

  @Delete('teams/:teamId/members/:userId')
  removeMember(
    @Req() req: any,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
  ) {
    return this.teamCore.removeMember(teamId, userId, req.user.sub);
  }

  @Post('teams/:teamId/transfer-ownership')
  transferOwnership(
    @Req() req: any,
    @Param('teamId') teamId: string,
    @Body('newOwnerId') newOwnerId: string,
  ) {
    return this.teamCore.transferOwnership(teamId, newOwnerId, req.user.sub);
  }

  @Post('teams/:teamId/invites')
  createInvite(
    @Req() req: any,
    @Param('teamId') teamId: string,
    @Body() dto: InviteMemberDto,
  ) {
    return this.teamInvite.createInvite(teamId, req.user.sub, dto);
  }

  @Get('teams/:teamId/invites')
  listInvites(@Req() req: any, @Param('teamId') teamId: string) {
    return this.teamInvite.listInvites(teamId, req.user.sub);
  }

  @Delete('teams/:teamId/invites/:inviteId')
  revokeInvite(
    @Req() req: any,
    @Param('teamId') teamId: string,
    @Param('inviteId') inviteId: string,
  ) {
    return this.teamInvite.revokeInvite(inviteId, teamId, req.user.sub);
  }

  @Get('invites/:code')
  getInviteInfo(@Param('code') code: string) {
    return this.teamInvite.getInviteInfo(code);
  }

  @Post('invites/:code/accept')
  acceptInvite(@Req() req: any, @Param('code') code: string) {
    return this.teamInvite.acceptInvite(code, req.user.sub);
  }
}
