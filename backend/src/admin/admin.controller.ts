import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
import { TemplateService } from './services/template.service';
import {
  UsersQueryDto,
  ApiUsageStatsQueryDto,
  ApiUsageRecordsQueryDto,
  UpdateUserStatusDto,
  UpdateUserRoleDto,
} from './dto/admin.dto';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  TemplateQueryDto,
} from './dto/template.dto';

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
    private readonly templateService: TemplateService,
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

  // ==================== 系统设置 ====================

  @Get('settings')
  @ApiOperation({ summary: '获取所有系统设置' })
  async getAllSettings(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.adminService.getAllSettings();
  }

  @Get('settings/:key')
  @ApiOperation({ summary: '获取单个系统设置' })
  async getSetting(@Request() req: AuthenticatedRequest, @Param('key') key: string) {
    this.checkAdmin(req);
    const setting = await this.adminService.getSetting(key);
    if (!setting) {
      throw new NotFoundException('设置项不存在');
    }
    return setting;
  }

  @Post('settings')
  @ApiOperation({ summary: '创建或更新系统设置' })
  async upsertSetting(
    @Request() req: AuthenticatedRequest,
    @Body() dto: { key: string; value: string; description?: string; metadata?: Record<string, any> },
  ) {
    this.checkAdmin(req);
    return this.adminService.upsertSetting(
      dto.key,
      dto.value,
      req.user.id,
      dto.description,
      dto.metadata,
    );
  }

  // ==================== 公共模板管理 ====================

  @Post('templates')
  @ApiOperation({ summary: '创建公共模板' })
  async createTemplate(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateTemplateDto,
  ) {
    this.checkAdmin(req);
    return this.templateService.createTemplate(dto, req.user.id);
  }

  @Get('templates')
  @ApiOperation({ summary: '获取公共模板列表' })
  async getTemplates(
    @Request() req: AuthenticatedRequest,
    @Query() query: TemplateQueryDto,
  ) {
    this.checkAdmin(req);
    return this.templateService.getTemplates(query);
  }

  @Get('templates/:id')
  @ApiOperation({ summary: '获取单个公共模板详情' })
  async getTemplate(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    this.checkAdmin(req);
    return this.templateService.getTemplateById(id);
  }

  @Patch('templates/:id')
  @ApiOperation({ summary: '更新公共模板' })
  async updateTemplate(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    this.checkAdmin(req);
    return this.templateService.updateTemplate(id, dto, req.user.id);
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: '删除公共模板' })
  async deleteTemplate(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    this.checkAdmin(req);
    return this.templateService.deleteTemplate(id);
  }

  @Get('templates/categories')
  @ApiOperation({ summary: '获取所有模板分类' })
  async getTemplateCategories(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.templateService.getTemplateCategories();
  }

  @Post('templates/categories')
  @ApiOperation({ summary: '添加新的模板分类' })
  async addTemplateCategory(
    @Request() req: AuthenticatedRequest,
    @Body() dto: { category: string },
  ) {
    this.checkAdmin(req);
    const key = 'template_categories';
    // 读取现有设置
    const existing = await this.adminService.getSetting(key);
    let list: string[] = [];
    if (existing && existing.value) {
      try {
        const parsed = JSON.parse(existing.value);
        if (Array.isArray(parsed)) list = parsed;
      } catch (e) {
        // ignore
      }
    }
    if (!dto?.category || !dto.category.trim()) {
      return { success: false, message: '分类不能为空' };
    }
    const cat = dto.category.trim();
    if (!list.includes(cat)) {
      list.push(cat);
      await this.adminService.upsertSetting(key, JSON.stringify(list), req.user.id, '模板分类');
    }
    return { success: true, categories: list.sort() };
  }
}
