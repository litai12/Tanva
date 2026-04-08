import { Body, Controller, Get, Inject, Post, Query, Request, UseGuards, forwardRef } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { MembershipService } from './membership.service';
import { PaymentService } from '../payment/payment.service';
import { PaymentMethod } from '../payment/dto/payment.dto';

interface AuthenticatedUser {
  id?: string;
  sub?: string;
}

@ApiTags('会员系统')
@Controller('membership')
export class MembershipController {
  constructor(
    private readonly membershipService: MembershipService,
    @Inject(forwardRef(() => PaymentService))
    private readonly paymentService: PaymentService,
  ) {}

  @Get('plans')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取会员套餐展示页数据' })
  async getMembershipPlans() {
    return this.membershipService.getMembershipPlansPage();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户会员信息' })
  async getMembershipMe(
    @Request() req: FastifyRequest & { user: AuthenticatedUser },
  ) {
    const userId = req.user.id ?? req.user.sub;
    return this.membershipService.getMembershipMe(userId as string);
  }

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

  @Post('orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建会员订单' })
  async createMembershipOrder(
    @Request() req: FastifyRequest & { user: AuthenticatedUser },
    @Body() body: { planCode: string; paymentMethod: PaymentMethod },
  ) {
    const userId = req.user.id ?? req.user.sub;
    return this.paymentService.createMembershipOrderByPlanCode(userId as string, body);
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取会员订单列表' })
  async getMembershipOrders(
    @Request() req: FastifyRequest & { user: AuthenticatedUser },
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const userId = req.user.id ?? req.user.sub;
    return this.paymentService.getMembershipOrders(
      userId as string,
      parseInt(page || '1'),
      parseInt(pageSize || '20'),
    );
  }
}
