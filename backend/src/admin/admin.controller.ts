import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AdminService } from './admin.service';
import { CreditsService } from '../credits/credits.service';
import {
  UsersQueryDto,
  ApiUsageStatsQueryDto,
  ApiUsageRecordsQueryDto,
  UpdateUserStatusDto,
  UpdateUserRoleDto,
} from './dto/admin.dto';

interface AuthenticatedUser {
  id: string;
  role: string;
}

type AuthenticatedRequest = FastifyRequest & { user: AuthenticatedUser };

@ApiTags('管理后台')
@Controller('admin')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly creditsService: CreditsService,
  ) {}

  /**
   * 验证管理员权限
   */
  private checkAdmin(req: AuthenticatedRequest) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('只有管理员可以访问此接口');
    }
  }

  @Get('dashboard')
  @ApiOperation({ summary: '获取管理后台统计数据' })
  async getDashboardStats(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.adminService.getDashboardStats();
  }

  @Get('users')
  @ApiOperation({ summary: '获取所有用户列表' })
  async getAllUsers(@Request() req: AuthenticatedRequest, @Query() query: UsersQueryDto) {
    this.checkAdmin(req);
    return this.adminService.getAllUsers({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });
  }

  @Get('users/:userId')
  @ApiOperation({ summary: '获取单个用户详情' })
  async getUserDetail(@Request() req: AuthenticatedRequest, @Param('userId') userId: string) {
    this.checkAdmin(req);
    const user = await this.adminService.getUserDetail(userId);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return user;
  }

  @Patch('users/:userId/status')
  @ApiOperation({ summary: '更新用户状态' })
  async updateUserStatus(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    this.checkAdmin(req);
    return this.adminService.updateUserStatus(userId, dto.status);
  }

  @Patch('users/:userId/role')
  @ApiOperation({ summary: '更新用户角色' })
  async updateUserRole(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    this.checkAdmin(req);
    return this.adminService.updateUserRole(userId, dto.role);
  }

  @Post('users/:userId/credits/add')
  @ApiOperation({ summary: '为用户添加积分' })
  async addCredits(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: { amount: number; description: string },
  ) {
    this.checkAdmin(req);
    return this.creditsService.adminAddCredits(
      userId,
      dto.amount,
      dto.description,
      req.user.id,
    );
  }

  @Post('users/:userId/credits/deduct')
  @ApiOperation({ summary: '扣除用户积分' })
  async deductCredits(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: { amount: number; description: string },
  ) {
    this.checkAdmin(req);
    return this.creditsService.adminDeductCredits(
      userId,
      dto.amount,
      dto.description,
      req.user.id,
    );
  }

  @Get('api-usage/stats')
  @ApiOperation({ summary: '获取API使用统计' })
  async getApiUsageStats(@Request() req: AuthenticatedRequest, @Query() query: ApiUsageStatsQueryDto) {
    this.checkAdmin(req);
    return this.adminService.getApiUsageStats({
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    });
  }

  @Get('api-usage/records')
  @ApiOperation({ summary: '获取所有API使用记录' })
  async getAllApiUsageRecords(@Request() req: AuthenticatedRequest, @Query() query: ApiUsageRecordsQueryDto) {
    this.checkAdmin(req);
    return this.adminService.getAllApiUsageRecords({
      page: query.page,
      pageSize: query.pageSize,
      userId: query.userId,
      serviceType: query.serviceType,
      provider: query.provider,
      status: query.status,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    });
  }

  @Get('pricing')
  @ApiOperation({ summary: '获取所有服务定价配置' })
  async getAllPricing(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.creditsService.getAllPricing();
  }
}
