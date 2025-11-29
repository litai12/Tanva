import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CreditsService } from './credits.service';
import {
  GetBalanceResponseDto,
  AdminAddCreditsDto,
  AdminDeductCreditsDto,
  TransactionHistoryQueryDto,
  ApiUsageQueryDto,
  PricingResponseDto,
} from './dto/credits.dto';

interface AuthenticatedUser {
  id: string;
  role: string;
}

@ApiTags('积分系统')
@Controller('credits')
export class CreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  @Get('balance')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户积分余额' })
  @ApiResponse({ status: 200, type: GetBalanceResponseDto })
  async getBalance(@Request() req: FastifyRequest & { user: AuthenticatedUser }): Promise<GetBalanceResponseDto> {
    return this.creditsService.getAccountDetails(req.user.id);
  }

  @Get('pricing')
  @ApiOperation({ summary: '获取所有服务定价' })
  @ApiResponse({ status: 200, type: [PricingResponseDto] })
  async getAllPricing(): Promise<PricingResponseDto[]> {
    return this.creditsService.getAllPricing();
  }

  @Get('transactions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户交易记录' })
  async getTransactionHistory(
    @Request() req: FastifyRequest & { user: AuthenticatedUser },
    @Query() query: TransactionHistoryQueryDto,
  ) {
    return this.creditsService.getTransactionHistory(req.user.id, {
      page: query.page,
      pageSize: query.pageSize,
      type: query.type,
    });
  }

  @Get('usage')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户API使用记录' })
  async getApiUsageHistory(
    @Request() req: FastifyRequest & { user: AuthenticatedUser },
    @Query() query: ApiUsageQueryDto,
  ) {
    return this.creditsService.getApiUsageHistory(req.user.id, {
      page: query.page,
      pageSize: query.pageSize,
      serviceType: query.serviceType,
      provider: query.provider,
      status: query.status,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    });
  }

  // ==================== 管理员接口 ====================

  @Post('admin/add')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '管理员添加积分' })
  async adminAddCredits(
    @Request() req: FastifyRequest & { user: AuthenticatedUser },
    @Body() dto: AdminAddCreditsDto,
  ) {
    // 检查是否为管理员
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('只有管理员可以执行此操作');
    }

    return this.creditsService.adminAddCredits(
      dto.userId,
      dto.amount,
      dto.description,
      req.user.id,
    );
  }

  @Post('admin/deduct')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '管理员扣除积分' })
  async adminDeductCredits(
    @Request() req: FastifyRequest & { user: AuthenticatedUser },
    @Body() dto: AdminDeductCreditsDto,
  ) {
    // 检查是否为管理员
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('只有管理员可以执行此操作');
    }

    return this.creditsService.adminDeductCredits(
      dto.userId,
      dto.amount,
      dto.description,
      req.user.id,
    );
  }
}
