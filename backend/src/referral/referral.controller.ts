import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { ReferralService } from './referral.service';

interface AuthenticatedUser {
  id: string;
  role: string;
}

type AuthenticatedRequest = FastifyRequest & { user: AuthenticatedUser };

@ApiTags('推广激励')
@Controller('referral')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取推广激励统计' })
  async getReferralStats(@Request() req: AuthenticatedRequest) {
    return this.referralService.getReferralStats(req.user.id);
  }

  @Get('check-in/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取签到状态' })
  async getCheckInStatus(@Request() req: AuthenticatedRequest) {
    return this.referralService.getCheckInStatus(req.user.id);
  }

  @Post('check-in')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '执行签到' })
  async checkIn(@Request() req: AuthenticatedRequest) {
    return this.referralService.checkIn(req.user.id);
  }

  @Get('validate-code')
  @ApiOperation({ summary: '验证邀请码是否有效' })
  async validateInviteCode(@Query('code') code: string) {
    return this.referralService.validateInviteCode(code);
  }

  @Post('use-code')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '使用邀请码' })
  async useInviteCode(
    @Request() req: AuthenticatedRequest,
    @Body() body: { code: string },
  ) {
    return this.referralService.useInviteCode(req.user.id, body.code);
  }
}
