import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiResponseStatus } from '../credits/dto/credits.dto';

export interface AdminDashboardStats {
  totalUsers: number;
  activeUsers: number;
  totalCreditsInCirculation: number;
  totalCreditsSpent: number;
  totalApiCalls: number;
  successfulApiCalls: number;
  failedApiCalls: number;
}

export interface UserWithCredits {
  id: string;
  email: string | null;
  phone: string;
  name: string | null;
  role: string;
  status: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  creditBalance: number;
  totalSpent: number;
  totalEarned: number;
  apiCallCount: number;
}

export interface ApiUsageStats {
  serviceType: string;
  serviceName: string;
  provider: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalCreditsUsed: number;
  userCount: number;
  topUsers: Array<{
    userId: string;
    userName: string | null;
    userPhone: string;
    userEmail: string | null;
    callCount: number;
  }>;
}

export type CreditChangeSource = 'recharge' | 'admin_add' | 'admin_deduct';

export interface CreditChangeRecord {
  id: string;
  source: CreditChangeSource;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description: string;
  createdAt: Date;
  user: {
    id: string;
    phone: string;
    email: string | null;
    name: string | null;
  };
  admin: {
    id: string;
    phone: string;
    email: string | null;
    name: string | null;
  } | null;
  payment: {
    id: string;
    orderNo: string;
    amount: number;
    paymentMethod: string;
    paidAt: Date | null;
  } | null;
}

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  private asJsonObject(value: unknown): Record<string, any> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, any>;
    }
    return null;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  /**
   * 获取管理后台统计数据
   */
  async getDashboardStats(): Promise<AdminDashboardStats> {
    const [
      totalUsers,
      activeUsers,
      creditStats,
      apiStats,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.creditAccount.aggregate({
        _sum: {
          balance: true,
          totalSpent: true,
        },
      }),
      this.prisma.apiUsageRecord.groupBy({
        by: ['responseStatus'],
        _count: true,
      }),
    ]);

    const totalApiCalls = apiStats.reduce((sum, item) => sum + item._count, 0);
    const successfulApiCalls = apiStats.find(s => s.responseStatus === ApiResponseStatus.SUCCESS)?._count || 0;
    const failedApiCalls = apiStats.find(s => s.responseStatus === ApiResponseStatus.FAILED)?._count || 0;

    return {
      totalUsers,
      activeUsers,
      totalCreditsInCirculation: creditStats._sum.balance || 0,
      totalCreditsSpent: creditStats._sum.totalSpent || 0,
      totalApiCalls,
      successfulApiCalls,
      failedApiCalls,
    };
  }

  /**
   * 获取所有用户列表（带积分信息）
   */
  async getAllUsers(options: {
    page?: number;
    pageSize?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<{ users: UserWithCredits[]; pagination: any }> {
    const { page = 1, pageSize = 10, search, sortBy = 'createdAt', sortOrder = 'desc' } = options;

    const where: any = {};
    if (search) {
      where.OR = [
        { phone: { contains: search } },
        { email: { contains: search } },
        { name: { contains: search } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: {
          creditAccount: true,
          _count: {
            select: { apiUsageRecords: true },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    const usersWithCredits: UserWithCredits[] = users.map((user: any) => ({
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      creditBalance: user.creditAccount?.balance || 0,
      totalSpent: user.creditAccount?.totalSpent || 0,
      totalEarned: user.creditAccount?.totalEarned || 0,
      apiCallCount: user._count.apiUsageRecords,
    }));

    return {
      users: usersWithCredits,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * 获取单个用户详情
   */
  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        creditAccount: {
          include: {
            transactions: {
              orderBy: { createdAt: 'desc' },
              take: 50,
            },
          },
        },
        apiUsageRecords: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      creditAccount: user.creditAccount,
      recentApiUsage: user.apiUsageRecords,
    };
  }

  /**
   * 获取积分变更记录（充值 + 后台手动调整）
   */
  async getCreditChangeRecords(options: {
    page?: number;
    pageSize?: number;
    search?: string;
    source?: 'all' | 'recharge' | 'admin_add' | 'admin_deduct';
    startDate?: Date;
    endDate?: Date;
  } = {}): Promise<{ records: CreditChangeRecord[]; pagination: any }> {
    const {
      page = 1,
      pageSize = 20,
      search,
      source = 'all',
      startDate,
      endDate,
    } = options;

    const where: any = {};

    if (source === 'recharge') {
      where.OR = [{ type: 'earn', description: '充值' }];
    } else if (source === 'admin_add') {
      where.OR = [{ type: 'admin_adjust', amount: { gt: 0 } }];
    } else if (source === 'admin_deduct') {
      where.OR = [{ type: 'admin_adjust', amount: { lt: 0 } }];
    } else {
      where.OR = [
        { type: 'earn', description: '充值' },
        { type: 'admin_adjust' },
      ];
    }

    if (search) {
      const matchedUsers = await this.prisma.user.findMany({
        where: {
          OR: [
            { phone: { contains: search } },
            { email: { contains: search } },
            { name: { contains: search } },
          ],
        },
        select: { id: true },
      });

      const matchedUserIds = matchedUsers.map((u) => u.id);
      if (matchedUserIds.length === 0) {
        return {
          records: [],
          pagination: {
            page,
            pageSize,
            total: 0,
            totalPages: 0,
          },
        };
      }

      const matchedAccounts = await this.prisma.creditAccount.findMany({
        where: {
          userId: { in: matchedUserIds },
        },
        select: { id: true },
      });

      const matchedAccountIds = matchedAccounts.map((a) => a.id);
      if (matchedAccountIds.length === 0) {
        return {
          records: [],
          pagination: {
            page,
            pageSize,
            total: 0,
            totalPages: 0,
          },
        };
      }

      where.accountId = { in: matchedAccountIds };
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [transactions, total] = await Promise.all([
      this.prisma.creditTransaction.findMany({
        where,
        include: {
          account: {
            include: {
              user: {
                select: {
                  id: true,
                  phone: true,
                  email: true,
                  name: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.creditTransaction.count({ where }),
    ]);

    const adminIds = new Set<string>();
    const paymentRefs = new Set<string>();

    for (const tx of transactions) {
      const metadata = this.asJsonObject(tx.metadata);
      if (tx.type === 'admin_adjust') {
        const adminId = metadata?.adminId;
        if (typeof adminId === 'string' && adminId.length > 0) {
          adminIds.add(adminId);
        }
      }
      if (tx.type === 'earn' && tx.description === '充值') {
        const orderRef = metadata?.orderNo;
        if (typeof orderRef === 'string' && orderRef.length > 0) {
          paymentRefs.add(orderRef);
        }
      }
    }

    const paymentRefsArray = Array.from(paymentRefs);
    const paymentIdRefs = paymentRefsArray.filter((ref) => this.isUuid(ref));
    const paymentOrderNoRefs = paymentRefsArray.filter((ref) => !this.isUuid(ref));
    const paymentWhereOr: Array<Record<string, any>> = [];
    if (paymentIdRefs.length > 0) {
      paymentWhereOr.push({ id: { in: paymentIdRefs } });
    }
    if (paymentOrderNoRefs.length > 0) {
      paymentWhereOr.push({ orderNo: { in: paymentOrderNoRefs } });
    }

    const [admins, paymentOrders] = await Promise.all([
      adminIds.size > 0
        ? this.prisma.user.findMany({
            where: { id: { in: Array.from(adminIds) } },
            select: {
              id: true,
              phone: true,
              email: true,
              name: true,
            },
          })
        : Promise.resolve([]),
      paymentWhereOr.length > 0
        ? this.prisma.paymentOrder.findMany({
            where: {
              OR: paymentWhereOr,
            },
            select: {
              id: true,
              orderNo: true,
              amount: true,
              paymentMethod: true,
              paidAt: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const adminMap = new Map(admins.map((a) => [a.id, a]));
    const paymentById = new Map(paymentOrders.map((p) => [p.id, p]));
    const paymentByOrderNo = new Map(paymentOrders.map((p) => [p.orderNo, p]));

    const records: CreditChangeRecord[] = transactions.map((tx) => {
      const metadata = this.asJsonObject(tx.metadata);
      const user = tx.account.user;

      let recordSource: CreditChangeSource = 'recharge';
      if (tx.type === 'admin_adjust') {
        recordSource = tx.amount >= 0 ? 'admin_add' : 'admin_deduct';
      }

      const adminId = typeof metadata?.adminId === 'string' ? metadata.adminId : null;
      const admin = adminId ? adminMap.get(adminId) ?? null : null;

      const paymentRef = typeof metadata?.orderNo === 'string' ? metadata.orderNo : null;
      const paymentOrder = paymentRef
        ? paymentById.get(paymentRef) ?? paymentByOrderNo.get(paymentRef) ?? null
        : null;

      return {
        id: tx.id,
        source: recordSource,
        amount: tx.amount,
        balanceBefore: tx.balanceBefore,
        balanceAfter: tx.balanceAfter,
        description: tx.description,
        createdAt: tx.createdAt,
        user: {
          id: user.id,
          phone: user.phone,
          email: user.email,
          name: user.name,
        },
        admin: admin
          ? {
              id: admin.id,
              phone: admin.phone,
              email: admin.email,
              name: admin.name,
            }
          : null,
        payment: paymentOrder
          ? {
              id: paymentOrder.id,
              orderNo: paymentOrder.orderNo,
              amount: Number(paymentOrder.amount),
              paymentMethod: paymentOrder.paymentMethod,
              paidAt: paymentOrder.paidAt,
            }
          : null,
      };
    });

    return {
      records,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * 获取 API 使用统计（按服务类型分组）
   */
  async getApiUsageStats(options: {
    startDate?: Date;
    endDate?: Date;
  } = {}): Promise<ApiUsageStats[]> {
    const { startDate, endDate } = options;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const stats = await this.prisma.apiUsageRecord.groupBy({
      by: ['serviceType', 'serviceName', 'provider', 'responseStatus'],
      where,
      _count: true,
      _sum: {
        creditsUsed: true,
      },
    });

    // 聚合数据
    const aggregated = new Map<string, ApiUsageStats>();

    stats.forEach((item) => {
      const key = item.serviceType;
      if (!aggregated.has(key)) {
        aggregated.set(key, {
          serviceType: item.serviceType,
          serviceName: item.serviceName,
          provider: item.provider,
          totalCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          totalCreditsUsed: 0,
          userCount: 0,
          topUsers: [],
        });
      }

      const stat = aggregated.get(key)!;
      stat.totalCalls += item._count;
      stat.totalCreditsUsed += item._sum.creditsUsed || 0;

      if (item.responseStatus === ApiResponseStatus.SUCCESS) {
        stat.successfulCalls += item._count;
      } else if (item.responseStatus === ApiResponseStatus.FAILED) {
        stat.failedCalls += item._count;
      }
    });

    // 一次性获取所有服务类型的用户统计信息
    const result = Array.from(aggregated.values());
    const serviceTypes = result.map(s => s.serviceType);
    
    if (serviceTypes.length > 0) {
      // 获取所有服务类型的用户统计
      const allUserStats = await this.prisma.apiUsageRecord.groupBy({
        by: ['userId', 'serviceType'],
        where: {
          ...where,
          serviceType: { in: serviceTypes },
        },
        _count: true,
      });

      // 获取所有相关用户信息
      const allUserIds = [...new Set(allUserStats.map(s => s.userId))];
      const allUsers = await this.prisma.user.findMany({
        where: { id: { in: allUserIds } },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
        },
      });

      const userMap = new Map(allUsers.map(u => [u.id, u]));
      
      // 按服务类型分组用户统计
      const userStatsByService = new Map<string, Array<{ userId: string; callCount: number }>>();
      
      allUserStats.forEach(stat => {
        if (!userStatsByService.has(stat.serviceType)) {
          userStatsByService.set(stat.serviceType, []);
        }
        userStatsByService.get(stat.serviceType)!.push({
          userId: stat.userId,
          callCount: stat._count,
        });
      });

      // 为每个服务类型填充用户信息
      result.forEach(stat => {
        const userStats = userStatsByService.get(stat.serviceType) || [];
        const uniqueUserIds = [...new Set(userStats.map(s => s.userId))];
        
        // 按调用次数排序，取前5个
        const topUserStats = userStats
          .sort((a, b) => b.callCount - a.callCount)
          .slice(0, 5);

        stat.userCount = uniqueUserIds.length;
        stat.topUsers = topUserStats.map(uc => {
          const user = userMap.get(uc.userId);
          return {
            userId: uc.userId,
            userName: user?.name || null,
            userPhone: user?.phone || '',
            userEmail: user?.email || null,
            callCount: uc.callCount,
          };
        });
      });
    }

    return result;
  }

  /**
   * 获取所有 API 使用记录
   */
  async getAllApiUsageRecords(options: {
    page?: number;
    pageSize?: number;
    userId?: string;
    serviceType?: string;
    provider?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
  } = {}) {
    const { page = 1, pageSize = 10, userId, serviceType, provider, status, startDate, endDate } = options;

    const where: any = {};
    if (userId) where.userId = userId;
    if (serviceType) where.serviceType = serviceType;
    if (provider) where.provider = provider;
    if (status) where.responseStatus = status;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [records, total] = await Promise.all([
      this.prisma.apiUsageRecord.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              phone: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.apiUsageRecord.count({ where }),
    ]);

    return {
      records,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * 更新用户状态
   */
  async updateUserStatus(userId: string, status: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { status },
    });
  }

  /**
   * 更新用户角色
   */
  async updateUserRole(userId: string, role: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { role },
    });
  }

  // ==================== 系统设置 ====================

  /**
   * 获取所有系统设置
   */
  async getAllSettings() {
    return this.prisma.systemSetting.findMany({
      orderBy: { key: 'asc' },
    });
  }

  /**
   * 获取单个系统设置
   */
  async getSetting(key: string) {
    return this.prisma.systemSetting.findUnique({
      where: { key },
    });
  }

  /**
   * 更新或创建系统设置
   */
  async upsertSetting(
    key: string,
    value: string,
    updatedBy: string,
    description?: string,
    metadata?: Record<string, any>,
  ) {
    return this.prisma.systemSetting.upsert({
      where: { key },
      update: {
        value,
        updatedBy,
        description: description ?? undefined,
        metadata: metadata ?? undefined,
      },
      create: {
        key,
        value,
        description,
        metadata,
        updatedBy,
      },
    });
  }

  /**
   * 删除系统设置
   */
  async deleteSetting(key: string) {
    return this.prisma.systemSetting.delete({
      where: { key },
    });
  }

  // ==================== 水印白名单管理 ====================

  /**
   * 获取水印白名单用户列表
   */
  async getWatermarkWhitelist(options: {
    page?: number;
    pageSize?: number;
    search?: string;
  } = {}) {
    const { page = 1, pageSize = 10, search } = options;

    const where: any = { noWatermark: true };
    if (search) {
      where.OR = [
        { phone: { contains: search } },
        { email: { contains: search } },
        { name: { contains: search } },
      ];
      where.noWatermark = true;
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          phone: true,
          email: true,
          name: true,
          noWatermark: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * 添加用户到水印白名单
   */
  async addToWatermarkWhitelist(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { noWatermark: true },
      select: { id: true, phone: true, name: true, noWatermark: true },
    });
  }

  /**
   * 从水印白名单移除用户
   */
  async removeFromWatermarkWhitelist(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { noWatermark: false },
      select: { id: true, phone: true, name: true, noWatermark: true },
    });
  }

  /**
   * 检查用户是否在水印白名单中
   */
  async checkWatermarkWhitelist(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { noWatermark: true },
    });
    return user?.noWatermark ?? false;
  }

  // ==================== 付费用户管理 ====================

  /**
   * 获取付费用户列表（按总支付金额排序）
   */
  async getPaidUsers(options: {
    page?: number;
    pageSize?: number;
    search?: string;
  } = {}) {
    const { page = 1, pageSize = 10, search } = options;

    // 先获取所有有支付记录的用户及其总支付金额
    const paidUsersQuery = await this.prisma.paymentOrder.groupBy({
      by: ['userId'],
      where: {
        status: 'paid',
      },
      _sum: {
        amount: true,
      },
      _count: {
        id: true,
      },
    });

    // 获取用户ID列表
    const userIds = paidUsersQuery.map(p => p.userId);

    if (userIds.length === 0) {
      return {
        users: [],
        pagination: {
          page,
          pageSize,
          total: 0,
          totalPages: 0,
        },
      };
    }

    // 构建搜索条件
    const where: any = {
      id: { in: userIds },
    };
    if (search) {
      where.OR = [
        { phone: { contains: search } },
        { email: { contains: search } },
        { name: { contains: search } },
      ];
    }

    // 获取符合搜索条件的用户
    const filteredUsers = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        phone: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        creditAccount: {
          select: {
            balance: true,
            totalSpent: true,
            totalEarned: true,
          },
        },
      },
    });

    // 创建用户ID到支付信息的映射
    const paymentMap = new Map(
      paidUsersQuery.map(p => [
        p.userId,
        {
          totalPaid: Number(p._sum.amount) || 0,
          orderCount: p._count.id,
        },
      ])
    );

    // 合并用户信息和支付信息，并按总支付金额排序
    const usersWithPayment = filteredUsers
      .map(user => ({
        id: user.id,
        phone: user.phone,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        creditBalance: user.creditAccount?.balance || 0,
        totalSpent: user.creditAccount?.totalSpent || 0,
        totalEarned: user.creditAccount?.totalEarned || 0,
        totalPaid: paymentMap.get(user.id)?.totalPaid || 0,
        orderCount: paymentMap.get(user.id)?.orderCount || 0,
      }))
      .sort((a, b) => b.totalPaid - a.totalPaid);

    // 分页
    const total = usersWithPayment.length;
    const totalPages = Math.ceil(total / pageSize);
    const paginatedUsers = usersWithPayment.slice(
      (page - 1) * pageSize,
      page * pageSize
    );

    return {
      users: paginatedUsers,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  }
}
