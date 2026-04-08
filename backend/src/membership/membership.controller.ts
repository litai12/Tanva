import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { MembershipService } from './membership.service';

interface AuthenticatedUser {
  id?: string;
  sub?: string;
}

@ApiTags('会员系统')
@Controller('membership')
export class MembershipController {
  constructor(private readonly membershipService: MembershipService) {}

  @Get('current')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前会员订阅信息' })
  async getCurrentMembership(
    @Request() req: FastifyRequest & { user: AuthenticatedUser },
  ) {
    const userId = req.user.id ?? req.user.sub;
    return this.membershipService.getCurrentMembership(userId as string);
  }

  @Get('entitlement')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前会员权益快照' })
  async getMembershipEntitlement(
    @Request() req: FastifyRequest & { user: AuthenticatedUser },
  ) {
    const userId = req.user.id ?? req.user.sub;
    return this.membershipService.getMembershipEntitlement(userId as string);
  }
}
