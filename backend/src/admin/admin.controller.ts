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
import { CreditsAnomalyService } from '../credits/credits-anomaly.service';
import { TransactionHistoryQueryDto } from '../credits/dto/credits.dto';
import { TemplateService } from './services/template.service';
import { NodeConfigService, NodeConfigDto, UpdateNodeConfigDto } from './services/node-config.service';
import { BusinessPolicyService } from '../business-policy/business-policy.service';
import type { UpdateMembershipCreditPolicyInput } from '../business-policy/business-policy.types';
import { MembershipService } from '../membership/membership.service';
import {
  UsersQueryDto,
  ApiUsageStatsQueryDto,
  ApiUsageRecordsQueryDto,
  UpdateUserStatusDto,
  UpdateUserRoleDto,
  CreditChangeRecordsQueryDto,
  CreditAnomalyRecordsQueryDto,
} from './dto/admin.dto';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  TemplateQueryDto,
} from './dto/template.dto';
import { MODEL_PROVIDER_MAPPING_SETTING_KEY } from '../ai/services/model-routing.service';

interface AuthenticatedUser {
  id: string;
  role: string;
}

type AuthenticatedRequest = FastifyRequest & { user: AuthenticatedUser };

type AdminPermission =
  | 'dashboard:view'
  | 'users:list'
  | 'users:credits:add'
  | 'users:credits:deduct'
  | 'users:credits:transactions'
  | 'api-usage:stats'
  | 'api-usage:records'
  | 'templates:manage'
  | 'watermark-whitelist:manage';

const FULL_ADMIN_ROLE = 'admin';
const NORMAL_ADMIN_ROLE = 'normal_admin';
const NORMAL_ADMIN_ALLOWED_PERMISSIONS = new Set<AdminPermission>([
  'dashboard:view',
  'users:list',
  'users:credits:add',
  'users:credits:deduct',
  'users:credits:transactions',
  'api-usage:stats',
  'api-usage:records',
  'templates:manage',
  'watermark-whitelist:manage',
]);

@ApiTags('管理后台')
@Controller('admin')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly creditsService: CreditsService,
    private readonly creditsAnomalyService: CreditsAnomalyService,
    private readonly templateService: TemplateService,
    private readonly nodeConfigService: NodeConfigService,
    private readonly businessPolicyService: BusinessPolicyService,
    private readonly membershipService: MembershipService,
  ) {}

  /**
   * 验证管理员权限
   */
  private checkAdmin(req: AuthenticatedRequest, permission?: AdminPermission) {
    const role = typeof req.user?.role === 'string' ? req.user.role.toLowerCase() : '';
    if (role === FULL_ADMIN_ROLE) return;
    if (
      role === NORMAL_ADMIN_ROLE &&
      permission &&
      NORMAL_ADMIN_ALLOWED_PERMISSIONS.has(permission)
    ) {
      return;
    }
    throw new ForbiddenException('Only administrators can access this endpoint');
  }

  @Get('dashboard')
  @ApiOperation({ summary: '获取管理后台统计数据' })
  async getDashboardStats(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req, 'dashboard:view');
    return this.adminService.getDashboardStats();
  }

  @Get('users')
  @ApiOperation({ summary: '获取所有用户列表' })
  async getAllUsers(@Request() req: AuthenticatedRequest, @Query() query: UsersQueryDto) {
    this.checkAdmin(req, 'users:list');
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

  @Delete('users/:userId')
  @ApiOperation({ summary: '删除用户账号' })
  async deleteUser(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    this.checkAdmin(req);
    return this.adminService.deleteUserAccount(userId, req.user.id);
  }

  @Post('users/:userId/unbind-wechat')
  @ApiOperation({ summary: '解绑用户微信号' })
  async unbindUserWechat(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    this.checkAdmin(req);
    return this.adminService.unbindUserWechat(userId);
  }

  @Post('users/:userId/credits/add')
  @ApiOperation({ summary: '为用户添加积分' })
  async addCredits(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: { amount: number; description: string },
  ) {
    this.checkAdmin(req, 'users:credits:add');
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
    this.checkAdmin(req, 'users:credits:deduct');
    return this.creditsService.adminDeductCredits(
      userId,
      dto.amount,
      dto.description,
      req.user.id,
    );
  }

  @Get('users/:userId/credits/transactions')
  @ApiOperation({ summary: '获取指定用户积分流水（管理员）' })
  async getUserCreditTransactions(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Query() query: TransactionHistoryQueryDto,
  ) {
    this.checkAdmin(req, 'users:credits:transactions');
    return this.creditsService.getTransactionHistory(userId, {
      page: query.page,
      pageSize: query.pageSize,
      type: query.type,
    });
  }

  @Get('api-usage/stats')
  @ApiOperation({ summary: '获取API使用统计' })
  async getApiUsageStats(@Request() req: AuthenticatedRequest, @Query() query: ApiUsageStatsQueryDto) {
    this.checkAdmin(req, 'api-usage:stats');
    return this.adminService.getApiUsageStats({
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    });
  }

  @Get('api-usage/records')
  @ApiOperation({ summary: '获取所有API使用记录' })
  async getAllApiUsageRecords(@Request() req: AuthenticatedRequest, @Query() query: ApiUsageRecordsQueryDto) {
    this.checkAdmin(req, 'api-usage:records');
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
    const setting = await this.adminService.upsertSetting(
      dto.key,
      dto.value,
      req.user.id,
      dto.description,
      dto.metadata,
    );

    if (dto.key === MODEL_PROVIDER_MAPPING_SETTING_KEY) {
      const nodeConfigSync = await this.nodeConfigService.syncAllConfigs();
      return {
        ...setting,
        nodeConfigSync,
      };
    }

    return setting;
  }

  @Get('membership-credit-policy')
  @ApiOperation({ summary: '获取会员积分策略配置' })
  async getMembershipCreditPolicy(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.businessPolicyService.getMembershipCreditPolicyView();
  }

  @Post('membership-credit-policy')
  @ApiOperation({ summary: '更新会员积分策略配置' })
  async updateMembershipCreditPolicy(
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateMembershipCreditPolicyInput,
  ) {
    this.checkAdmin(req);
    return this.businessPolicyService.updateMembershipCreditPolicy(dto, req.user.id);
  }

  @Get('membership-plans')
  @ApiOperation({ summary: '获取会员套餐管理列表' })
  async getAdminMembershipPlans(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.membershipService.listAllPlansForAdmin();
  }

  @Post('membership-plans')
  @ApiOperation({ summary: '创建会员套餐' })
  async createMembershipPlan(
    @Request() req: AuthenticatedRequest,
    @Body()
    dto: {
      code: string;
      name: string;
      billingCycle: string;
      price: number;
      monthlyQuotaCredits?: number;
      signupBonusCredits?: number;
      dailyGiftCredits?: number;
      isActive?: boolean;
      sortOrder?: number;
      metadata?: Record<string, any>;
    },
  ) {
    this.checkAdmin(req);
    return this.membershipService.createMembershipPlan(dto);
  }

  @Patch('membership-plans/:id')
  @ApiOperation({ summary: '更新会员套餐' })
  async updateMembershipPlan(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    dto: {
      code?: string;
      name?: string;
      billingCycle?: string;
      price?: number;
      monthlyQuotaCredits?: number;
      signupBonusCredits?: number;
      dailyGiftCredits?: number;
      isActive?: boolean;
      sortOrder?: number;
      metadata?: Record<string, any>;
    },
  ) {
    this.checkAdmin(req);
    return this.membershipService.updateMembershipPlan(id, dto);
  }

  @Get('users/:userId/membership')
  @ApiOperation({ summary: '获取指定用户会员状态（管理员）' })
  async getUserMembershipState(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    this.checkAdmin(req);
    return this.membershipService.getAdminMembershipState(userId);
  }

  @Post('users/:userId/membership/expire')
  @ApiOperation({ summary: '立即让用户会员到期（管理员）' })
  async expireUserMembershipNow(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: { reason?: string },
  ) {
    this.checkAdmin(req);
    return this.membershipService.adminExpireMembershipNow(
      userId,
      dto.reason?.trim() || 'admin_expire_now',
      req.user.id,
    );
  }

  @Post('users/:userId/membership/adjust-period')
  @ApiOperation({ summary: '调整用户会员时长（管理员）' })
  async adjustUserMembershipPeriod(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: { days: number; reason?: string },
  ) {
    this.checkAdmin(req);
    return this.membershipService.adminAdjustMembershipPeriod(
      userId,
      dto.days,
      dto.reason?.trim() || 'admin_adjust_membership_period',
      req.user.id,
    );
  }

  @Post('users/:userId/membership/change-plan')
  @ApiOperation({ summary: '变更用户会员套餐（管理员）' })
  async changeUserMembershipPlan(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body()
    dto: {
      planCode: string;
      effectiveMode: 'immediate' | 'next_cycle';
      reason?: string;
    },
  ) {
    this.checkAdmin(req);
    return this.membershipService.adminScheduleMembershipChange({
      userId,
      planCode: dto.planCode,
      effectiveMode: dto.effectiveMode,
      reason: dto.reason?.trim() || 'admin_change_plan',
      requestedBy: req.user.id,
    });
  }

  @Get('users/:userId/membership/transition-preview')
  @ApiOperation({ summary: '预览指定用户切换目标套餐的结果（管理员）' })
  async getUserMembershipTransitionPreview(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Query('planCode') planCode?: string,
  ) {
    this.checkAdmin(req);
    return this.membershipService.getUserTransitionPreview(userId, planCode || '');
  }

  @Post('membership/ops/apply-scheduled-changes')
  @ApiOperation({ summary: '立即执行待生效订阅切换（管理员）' })
  async applyScheduledMembershipChanges(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.membershipService.applyDueScheduledChanges();
  }

  @Post('membership/ops/expire-scan')
  @ApiOperation({ summary: '立即执行会员到期扫描（管理员）' })
  async expireMembershipsNow(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.membershipService.expireElapsedMemberships();
  }

  @Post('membership/ops/issue-daily-gifts')
  @ApiOperation({ summary: '立即执行会员每日赠送发放（管理员）' })
  async issueDailyMembershipGifts(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return {
      issuedSubscriptions: 0,
      grantedCredits: 0,
      createdLots: 0,
      disabled: true,
    };
  }

  @Post('membership/ops/decay-gifts')
  @ApiOperation({ summary: '立即执行赠送积分衰减（管理员）' })
  async decayMembershipGifts(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.membershipService.decayDailyGiftCredits();
  }

  @Post('membership/ops/refresh-yearly-quota')
  @ApiOperation({ summary: '立即执行年费会员月额度刷新（管理员）' })
  async refreshYearlyMembershipQuota(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.membershipService.refreshYearlySubscriptionQuotaLots();
  }

  // ==================== 公共模板管理 ====================

  // 注意：categories 路由必须放在 :id 路由之前，否则 'categories' 会被当作 id 参数
  @Get('templates/categories')
  @ApiOperation({ summary: '获取所有模板分类' })
  async getTemplateCategories(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req, 'templates:manage');
    return this.templateService.getTemplateCategories();
  }

  @Post('templates/categories')
  @ApiOperation({ summary: '添加新的模板分类' })
  async addTemplateCategory(
    @Request() req: AuthenticatedRequest,
    @Body() dto: { category: string },
  ) {
    this.checkAdmin(req, 'templates:manage');
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

  @Delete('templates/categories/:category')
  @ApiOperation({ summary: '删除模板分类' })
  async deleteTemplateCategory(
    @Request() req: AuthenticatedRequest,
    @Param('category') category: string,
  ) {
    this.checkAdmin(req, 'templates:manage');
    const cat = decodeURIComponent(category).trim();
    if (!cat) {
      return { success: false, message: '分类不能为空' };
    }
    if (cat === '其他') {
      return { success: false, message: '"其他"分类不能删除' };
    }
    const key = 'template_categories';
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
    const newList = list.filter((c) => c !== cat);
    await this.adminService.upsertSetting(key, JSON.stringify(newList), req.user.id, '模板分类');
    return { success: true, categories: newList.sort() };
  }

  @Post('templates')
  @ApiOperation({ summary: '创建公共模板' })
  async createTemplate(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateTemplateDto,
  ) {
    this.checkAdmin(req, 'templates:manage');
    return this.templateService.createTemplate(dto, req.user.id);
  }

  @Get('templates')
  @ApiOperation({ summary: '获取公共模板列表' })
  async getTemplates(
    @Request() req: AuthenticatedRequest,
    @Query() query: TemplateQueryDto,
  ) {
    this.checkAdmin(req, 'templates:manage');
    return this.templateService.getTemplates(query);
  }

  @Get('templates/:id')
  @ApiOperation({ summary: '获取单个公共模板详情' })
  async getTemplate(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    this.checkAdmin(req, 'templates:manage');
    return this.templateService.getTemplateById(id);
  }

  @Patch('templates/:id')
  @ApiOperation({ summary: '更新公共模板' })
  async updateTemplate(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    this.checkAdmin(req, 'templates:manage');
    return this.templateService.updateTemplate(id, dto, req.user.id);
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: '删除公共模板' })
  async deleteTemplate(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    this.checkAdmin(req, 'templates:manage');
    return this.templateService.deleteTemplate(id);
  }

  // ==================== 水印白名单管理 ====================

  @Get('watermark-whitelist')
  @ApiOperation({ summary: '获取水印白名单用户列表' })
  async getWatermarkWhitelist(
    @Request() req: AuthenticatedRequest,
    @Query() query: { page?: string; pageSize?: string; search?: string },
  ) {
    this.checkAdmin(req, 'watermark-whitelist:manage');
    return this.adminService.getWatermarkWhitelist({
      page: query.page ? parseInt(query.page) : 1,
      pageSize: query.pageSize ? parseInt(query.pageSize) : 20,
      search: query.search,
    });
  }

  @Post('watermark-whitelist/:userId')
  @ApiOperation({ summary: '添加用户到水印白名单' })
  async addToWatermarkWhitelist(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    this.checkAdmin(req, 'watermark-whitelist:manage');
    return this.adminService.addToWatermarkWhitelist(userId);
  }

  @Delete('watermark-whitelist/:userId')
  @ApiOperation({ summary: '从水印白名单移除用户' })
  async removeFromWatermarkWhitelist(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    this.checkAdmin(req, 'watermark-whitelist:manage');
    return this.adminService.removeFromWatermarkWhitelist(userId);
  }

  // ==================== 付费用户管理 ====================

  @Get('paid-users')
  @ApiOperation({ summary: '获取付费用户列表（支持金额/注册时间/支付时间排序）' })
  async getPaidUsers(
    @Request() req: AuthenticatedRequest,
    @Query() query: {
      page?: string;
      pageSize?: string;
      search?: string;
      sortBy?: 'amount' | 'registeredAt' | 'paidAt';
      sortOrder?: 'asc' | 'desc';
    },
  ) {
    this.checkAdmin(req);
    return this.adminService.getPaidUsers({
      page: query.page ? parseInt(query.page) : 1,
      pageSize: query.pageSize ? parseInt(query.pageSize) : 10,
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });
  }

  @Get('credit-change-records')
  @ApiOperation({ summary: '获取积分变更记录（充值 + 后台手动调整）' })
  async getCreditChangeRecords(
    @Request() req: AuthenticatedRequest,
    @Query() query: CreditChangeRecordsQueryDto,
  ) {
    this.checkAdmin(req);
    return this.adminService.getCreditChangeRecords({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      userId: query.userId,
      source: query.source,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    });
  }

  @Get('credit-anomalies')
  @ApiOperation({ summary: '获取积分异常检测记录（当天增量超过2000）' })
  async getCreditAnomalyRecords(
    @Request() req: AuthenticatedRequest,
    @Query() query: CreditAnomalyRecordsQueryDto,
  ) {
    this.checkAdmin(req);
    return this.creditsAnomalyService.getCreditAnomalyRecords({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      userId: query.userId,
      severity: query.severity,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    });
  }

  // ==================== 节点配置管理 ====================

  @Get('node-configs')
  @ApiOperation({ summary: '获取所有节点配置（管理员）' })
  async getAllNodeConfigs(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.nodeConfigService.getAllNodeConfigsAdmin();
  }

  @Get('node-configs/:nodeKey')
  @ApiOperation({ summary: '获取单个节点配置' })
  async getNodeConfig(
    @Request() req: AuthenticatedRequest,
    @Param('nodeKey') nodeKey: string,
  ) {
    this.checkAdmin(req);
    const config = await this.nodeConfigService.getNodeConfig(nodeKey);
    if (!config) {
      throw new NotFoundException(`节点配置不存在: ${nodeKey}`);
    }
    return config;
  }

  @Post('node-configs')
  @ApiOperation({ summary: '创建节点配置' })
  async createNodeConfig(
    @Request() req: AuthenticatedRequest,
    @Body() dto: NodeConfigDto,
  ) {
    this.checkAdmin(req);
    return this.nodeConfigService.createNodeConfig(dto);
  }

  @Patch('node-configs/:nodeKey')
  @ApiOperation({ summary: '更新节点配置' })
  async updateNodeConfig(
    @Request() req: AuthenticatedRequest,
    @Param('nodeKey') nodeKey: string,
    @Body() dto: UpdateNodeConfigDto,
  ) {
    this.checkAdmin(req);
    return this.nodeConfigService.updateNodeConfig(nodeKey, dto);
  }

  @Delete('node-configs/:nodeKey')
  @ApiOperation({ summary: '删除节点配置' })
  async deleteNodeConfig(
    @Request() req: AuthenticatedRequest,
    @Param('nodeKey') nodeKey: string,
  ) {
    this.checkAdmin(req);
    return this.nodeConfigService.deleteNodeConfig(nodeKey);
  }

  @Post('node-configs/initialize')
  @ApiOperation({ summary: '初始化默认节点配置' })
  async initializeNodeConfigs(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.nodeConfigService.initializeDefaultConfigs();
  }

  @Post('node-configs/sync')
  @ApiOperation({ summary: '同步所有节点配置（覆盖已存在的）' })
  async syncNodeConfigs(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.nodeConfigService.syncAllConfigs();
  }
}
