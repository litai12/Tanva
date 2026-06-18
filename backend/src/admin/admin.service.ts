import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { ApiResponseStatus } from '../credits/dto/credits.dto';
import { TeamCreditsPublisher } from '../team-collab/team-credits-publisher.service';
import { CreditsService } from '../credits/credits.service';
import { TeamCoreService } from '../team-core/team-core.service';

export interface AdminDashboardStats {
  totalUsers: number;
  activeUsers: number;
  dailyActiveUsers: number;
  onlineUsers: number;
  todayRegisteredUsers: number;
  totalCreditsInCirculation: number;
  totalCreditsSpent: number;
  totalApiCalls: number;
  successfulApiCalls: number;
  failedApiCalls: number;
  generatedAt: string;
  userTrend: Array<{
    date: string;
    registeredUsers: number;
    dailyActiveUsers: number;
  }>;
}

export interface UserWithCredits {
  id: string;
  email: string | null;
  phone: string;
  name: string | null;
  role: string;
  status: string;
  wechatBound: boolean;
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

export const LOGIN_NOTICE_SETTING_KEY = 'login_notice';
export const LOGIN_NOTICE_BUTTON_QRCODE_SETTING_KEY = 'login_notice_button_qrcode';
export const CONTEST_REGISTRATION_QRCODE_SETTING_KEY = 'contest_registration_qrcode';

export interface LoginNoticeView {
  enabled: boolean;
  content: string;
  contentHtml: string;
  mediaType: 'image' | 'video' | null;
  mediaUrl: string;
  posterUrl: string;
  primaryButtonText: string;
  primaryButtonUrl: string;
  secondaryButtonText: string;
  secondaryButtonUrl: string;
  secondaryButtonQrUrl: string;
  updatedAt: string | null;
}

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
  constructor(
    private prisma: PrismaService,
    private readonly creditsService: CreditsService,
    private readonly teamCoreService: TeamCoreService,
    @Optional() private readonly teamCreditsPublisher?: TeamCreditsPublisher,
  ) {}

  private toNumber(value: unknown): number {
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private formatDayLabel(date: Date): string {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  private asJsonObject(value: unknown): Record<string, any> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, any>;
    }
    return null;
  }

  private extractLoginNoticeTextFromHtml(value: string): string {
    return value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private sanitizeLoginNoticeUrl(value: unknown): string {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^(?:javascript|data|blob):/i.test(trimmed)) return '';
    if (/^(?:https?:\/\/|\/)/i.test(trimmed)) return trimmed;
    return '';
  }

  private parseLoginNoticeValue(value: string | null | undefined): {
    enabled: boolean;
    content: string;
    contentHtml: string;
    mediaType: 'image' | 'video' | null;
    mediaUrl: string;
    posterUrl: string;
    primaryButtonText: string;
    primaryButtonUrl: string;
    secondaryButtonText: string;
    secondaryButtonUrl: string;
    secondaryButtonQrUrl: string;
  } {
    if (!value) {
      return {
        enabled: false,
        content: '',
        contentHtml: '',
        mediaType: null,
        mediaUrl: '',
        posterUrl: '',
        primaryButtonText: '',
        primaryButtonUrl: '',
        secondaryButtonText: '',
        secondaryButtonUrl: '',
        secondaryButtonQrUrl: '',
      };
    }

    try {
      const parsed = JSON.parse(value);
      const objectValue = this.asJsonObject(parsed);
      if (objectValue) {
        const content = typeof objectValue.content === 'string' ? objectValue.content : '';
        const contentHtml = typeof objectValue.contentHtml === 'string' ? objectValue.contentHtml : '';
        const mediaUrl = this.sanitizeLoginNoticeUrl(objectValue.mediaUrl);
        const rawMediaType = typeof objectValue.mediaType === 'string' ? objectValue.mediaType : '';
        const mediaType = mediaUrl
          ? rawMediaType === 'video'
            ? 'video'
            : 'image'
          : null;
        return {
          enabled: objectValue.enabled === true,
          content: content || this.extractLoginNoticeTextFromHtml(contentHtml),
          contentHtml,
          mediaType,
          mediaUrl,
          posterUrl: this.sanitizeLoginNoticeUrl(objectValue.posterUrl),
          primaryButtonText: typeof objectValue.primaryButtonText === 'string' ? objectValue.primaryButtonText : '',
          primaryButtonUrl: this.sanitizeLoginNoticeUrl(objectValue.primaryButtonUrl),
          secondaryButtonText: typeof objectValue.secondaryButtonText === 'string' ? objectValue.secondaryButtonText : '',
          secondaryButtonUrl: this.sanitizeLoginNoticeUrl(objectValue.secondaryButtonUrl),
          secondaryButtonQrUrl: this.sanitizeLoginNoticeUrl(objectValue.secondaryButtonQrUrl),
        };
      }
    } catch {
      // Legacy/plain-string setting values are treated as enabled content.
    }

    return {
      enabled: true,
      content: value,
      contentHtml: '',
      mediaType: null,
      mediaUrl: '',
      posterUrl: '',
      primaryButtonText: '',
      primaryButtonUrl: '',
      secondaryButtonText: '',
      secondaryButtonUrl: '',
      secondaryButtonQrUrl: '',
    };
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private async runWithMissingTableTolerance<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error: any) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2021'
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * 获取管理后台统计数据
   */
  async getDashboardStats(): Promise<AdminDashboardStats> {
    const now = new Date();
    const startOfToday = this.startOfDay(now);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);
    const onlineThreshold = new Date(now.getTime() - 15 * 60 * 1000);
    const trendDays = 14;
    const trendStart = new Date(startOfToday);
    trendStart.setDate(trendStart.getDate() - (trendDays - 1));

    const trendDayStarts = Array.from({ length: trendDays }, (_, idx) => {
      const d = new Date(trendStart);
      d.setDate(trendStart.getDate() + idx);
      return d;
    });

    const [
      totalUsers,
      todayActiveUsersByLastSeen,
      todayRegisteredUsers,
      onlineUsers,
      todayActiveUsersBySessionRows,
      creditStats,
      apiStats,
      trendRows,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({
        where: {
          lastLoginAt: {
            gte: startOfToday,
            lt: endOfToday,
          },
        },
      }),
      this.prisma.user.count({
        where: {
          createdAt: {
            gte: startOfToday,
            lt: endOfToday,
          },
        },
      }),
      this.prisma.user.count({
        where: {
          status: 'active',
          lastLoginAt: {
            gte: onlineThreshold,
          },
        },
      }),
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>`
        SELECT COUNT(DISTINCT "userId")::bigint AS count
        FROM "RefreshToken"
        WHERE "createdAt" >= ${startOfToday}
          AND "createdAt" < ${endOfToday}
      `,
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
      Promise.all(
        trendDayStarts.map(async (dayStart) => {
          const dayEnd = new Date(dayStart);
          dayEnd.setDate(dayEnd.getDate() + 1);
          const [registeredUsers, dailyActiveRows] = await Promise.all([
            this.prisma.user.count({
              where: {
                createdAt: {
                  gte: dayStart,
                  lt: dayEnd,
                },
              },
            }),
            this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>`
              SELECT COUNT(DISTINCT "userId")::bigint AS count
              FROM "RefreshToken"
              WHERE "createdAt" >= ${dayStart}
                AND "createdAt" < ${dayEnd}
            `,
          ]);
          return {
            date: this.formatDayLabel(dayStart),
            registeredUsers,
            dailyActiveUsers: this.toNumber(dailyActiveRows[0]?.count ?? 0),
          };
        })
      ),
    ]);

    const todayActiveUsersBySession = this.toNumber(todayActiveUsersBySessionRows[0]?.count ?? 0);
    const dailyActiveUsers = Math.max(todayActiveUsersByLastSeen, todayActiveUsersBySession);

    const totalApiCalls = apiStats.reduce((sum, item) => sum + item._count, 0);
    const successfulApiCalls = apiStats.find(s => s.responseStatus === ApiResponseStatus.SUCCESS)?._count || 0;
    const failedApiCalls = apiStats.find(s => s.responseStatus === ApiResponseStatus.FAILED)?._count || 0;

    const userTrend = trendRows.map((item, index) => {
      if (index === trendRows.length - 1) {
        return { ...item, dailyActiveUsers };
      }
      return item;
    });

    return {
      totalUsers,
      activeUsers: dailyActiveUsers,
      dailyActiveUsers,
      onlineUsers,
      todayRegisteredUsers,
      totalCreditsInCirculation: creditStats._sum.balance || 0,
      totalCreditsSpent: creditStats._sum.totalSpent || 0,
      totalApiCalls,
      successfulApiCalls,
      failedApiCalls,
      generatedAt: now.toISOString(),
      userTrend,
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
      wechatBound: Boolean(user.wechatOfficialOpenId || user.wechatUnionId),
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

  async createUser(input: {
    phone: string;
    password: string;
    name: string;
    email?: string | null;
  }): Promise<UserWithCredits> {
    const phone = input.phone.trim();
    const password = input.password;
    const name = input.name.trim();
    const email = input.email?.trim().toLowerCase() || null;

    if (!/^1[3-9]\d{9}$/.test(phone)) {
      throw new BadRequestException('手机号格式不正确');
    }
    if (password.length < 6) {
      throw new BadRequestException('密码至少需要 6 位');
    }
    if (!name) {
      throw new BadRequestException('昵称不能为空');
    }
    if (name === phone) {
      throw new BadRequestException('昵称不能与手机号相同');
    }
    if (email && name.toLowerCase() === email) {
      throw new BadRequestException('昵称不能与邮箱相同');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const existsByPhone = await tx.user.findUnique({ where: { phone } });
      if (existsByPhone) {
        throw new BadRequestException('手机号已注册');
      }

      const existsPhoneMatchedByName = await tx.user.findUnique({ where: { phone: name } });
      if (existsPhoneMatchedByName) {
        throw new BadRequestException('昵称不能与手机号相同');
      }

      if (email) {
        const existsByEmail = await tx.user.findUnique({ where: { email } });
        if (existsByEmail) {
          throw new BadRequestException('邮箱已存在');
        }
      }

      const newUser = await tx.user.create({
        data: {
          email,
          passwordHash,
          name,
          phone,
        },
        include: {
          creditAccount: true,
          _count: {
            select: { apiUsageRecords: true },
          },
        },
      });

      await this.teamCoreService.createPersonalTeam(newUser.id, tx);

      return newUser;
    });

    try {
      await this.creditsService.getOrCreateAccount(user.id);
    } catch (error) {
      console.warn(
        `[AdminCreateUser] Failed to create credit account: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const account = await this.prisma.creditAccount.findUnique({
      where: { userId: user.id },
    });

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      role: user.role,
      status: user.status,
      wechatBound: Boolean(user.wechatOfficialOpenId || user.wechatUnionId),
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      creditBalance: account?.balance || 0,
      totalSpent: account?.totalSpent || 0,
      totalEarned: account?.totalEarned || 0,
      apiCallCount: user._count.apiUsageRecords,
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
      wechatOfficialOpenId: user.wechatOfficialOpenId,
      wechatUnionId: user.wechatUnionId,
      wechatBound: Boolean(user.wechatOfficialOpenId || user.wechatUnionId),
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      creditAccount: user.creditAccount,
      recentApiUsage: user.apiUsageRecords,
    };
  }

  /**
   * 获取积分变更记录（充值 + 后台手动调整）
   * 注意：source='all_earned' 可以查询所有类型的积分增加记录，包括邀请奖励、签到奖励等
   */
  async getCreditChangeRecords(options: {
    page?: number;
    pageSize?: number;
    search?: string;
    userId?: string;
    source?: 'all' | 'recharge' | 'admin_add' | 'admin_deduct' | 'invite_reward' | 'all_earned';
    startDate?: Date;
    endDate?: Date;
  } = {}): Promise<{ records: CreditChangeRecord[]; pagination: any }> {
    const {
      page = 1,
      pageSize = 20,
      search,
      userId,
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
    } else if (source === 'invite_reward') {
      where.OR = [{ type: 'REFERRAL_REWARD' }];
      where.amount = { gt: 0 };
    } else if (source === 'all_earned') {
      // 查询所有类型的积分增加记录（包括邀请奖励、签到奖励等）
      where.OR = [
        { type: 'earn', description: '充值' },
        { type: 'admin_adjust', amount: { gt: 0 } },
        { type: 'REFERRAL_REWARD' }, // 邀请奖励
        { type: 'CHECK_IN' }, // 签到奖励
        { type: 'earn', description: '新用户注册赠送积分' }, // 新用户注册赠送
      ];
      where.amount = { gt: 0 }; // 只查询积分增加的记录
    } else {
      where.OR = [
        { type: 'earn', description: '充值' },
        { type: 'admin_adjust' },
      ];
    }

    if (userId) {
      const account = await this.prisma.creditAccount.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!account) {
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
      where.accountId = account.id;
    } else if (search) {
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
      } else if (tx.type === 'REFERRAL_REWARD') {
        recordSource = 'recharge'; // 邀请奖励显示为充值类型，但会在description中标注
      } else if (tx.type === 'CHECK_IN') {
        recordSource = 'recharge'; // 签到奖励显示为充值类型，但会在description中标注
      } else if (tx.type === 'earn' && tx.description === '新用户注册赠送积分') {
        recordSource = 'recharge'; // 新用户注册赠送显示为充值类型
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
    userSearch?: string;
    serviceType?: string;
    provider?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
  } = {}) {
    const { page = 1, pageSize = 10, userId, userSearch, serviceType, provider, status, startDate, endDate } = options;

    const where: any = {};
    if (userId) where.userId = userId;
    else if (userSearch?.trim()) {
      const keyword = userSearch.trim();
      where.OR = [
        { userId: { contains: keyword, mode: 'insensitive' } },
        { user: { is: { phone: { contains: keyword, mode: 'insensitive' } } } },
        { user: { is: { email: { contains: keyword, mode: 'insensitive' } } } },
        { user: { is: { name: { contains: keyword, mode: 'insensitive' } } } },
      ];
    }
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

  async unbindUserWechat(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        name: true,
        wechatOfficialOpenId: true,
        wechatUnionId: true,
      },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (!user.wechatOfficialOpenId && !user.wechatUnionId) {
      return {
        success: true,
        message: '该用户当前未绑定微信',
      };
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        wechatOfficialOpenId: null,
        wechatUnionId: null,
      },
      select: { id: true },
    });

    return {
      success: true,
      message: '微信绑定已解除',
    };
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

  /**
   * 删除用户账号及关联数据
   */
  async deleteUserAccount(userId: string, operatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const targetUser = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
      });

      if (!targetUser) {
        throw new NotFoundException('用户不存在');
      }

      if (userId === operatorId) {
        throw new ForbiddenException('不能删除当前登录管理员账号');
      }

      if (targetUser.role === 'admin') {
        const adminCount = await tx.user.count({ where: { role: 'admin' } });
        if (adminCount <= 1) {
          throw new BadRequestException('系统至少需要保留一个管理员账号');
        }
      }

      await tx.user.updateMany({
        where: { invitedById: userId },
        data: { invitedById: null },
      });

      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.workflowHistory.deleteMany({ where: { userId } });
      await tx.project.deleteMany({ where: { userId } });

      const account = await tx.creditAccount.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (account) {
        await this.runWithMissingTableTolerance(() =>
          tx.creditAnomalyRecord.deleteMany({ where: { accountId: account.id } }),
        );
        await tx.creditTransaction.deleteMany({ where: { accountId: account.id } });
        await tx.creditLot.deleteMany({ where: { accountId: account.id } });
        await tx.creditAccount.delete({ where: { id: account.id } });
      }

      await this.runWithMissingTableTolerance(() =>
        tx.creditAnomalyRecord.deleteMany({ where: { userId } }),
      );
      await tx.membershipSubscriptionChange.deleteMany({ where: { userId } });
      await tx.userMembershipSubscription.deleteMany({ where: { userId } });
      await tx.membershipEntitlementSnapshot.deleteMany({ where: { userId } });
      await tx.apiUsageRecord.deleteMany({ where: { userId } });
      await tx.globalImageHistory.deleteMany({ where: { userId } });

      await tx.invitationRedemption.deleteMany({
        where: {
          OR: [{ inviteeUserId: userId }, { inviterUserId: userId }],
        },
      });
      await tx.invitationCode.updateMany({
        where: { inviterUserId: userId },
        data: { inviterUserId: null },
      });

      await tx.paymentOrder.deleteMany({ where: { userId } });
      await tx.imageTask.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });

      return {
        success: true,
        deletedUserId: userId,
      };
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

  async getLoginNotice(): Promise<LoginNoticeView> {
    const setting = await this.getSetting(LOGIN_NOTICE_SETTING_KEY);
    const buttonQrSetting = await this.getSetting(LOGIN_NOTICE_BUTTON_QRCODE_SETTING_KEY);
    const parsed = this.parseLoginNoticeValue(setting?.value);
    const content = parsed.content.trim();

    return {
      enabled: parsed.enabled && content.length > 0,
      content: parsed.content,
      contentHtml: parsed.contentHtml,
      mediaType: parsed.mediaType,
      mediaUrl: parsed.mediaUrl,
      posterUrl: parsed.posterUrl,
      primaryButtonText: parsed.primaryButtonText,
      primaryButtonUrl: parsed.primaryButtonUrl,
      secondaryButtonText: parsed.secondaryButtonText,
      secondaryButtonUrl: parsed.secondaryButtonUrl,
      secondaryButtonQrUrl: this.sanitizeLoginNoticeUrl(buttonQrSetting?.value) || parsed.secondaryButtonQrUrl,
      updatedAt: setting?.updatedAt ? setting.updatedAt.toISOString() : null,
    };
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
   * 获取付费用户列表（支持金额/注册时间/支付时间排序）
   */
  async getPaidUsers(options: {
    page?: number;
    pageSize?: number;
    search?: string;
    sortBy?: 'amount' | 'registeredAt' | 'paidAt';
    sortOrder?: 'asc' | 'desc';
  } = {}) {
    const { page = 1, pageSize = 10, search } = options;
    const sortBy = options.sortBy ?? 'amount';
    const sortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc';
    const direction = sortOrder === 'asc' ? 1 : -1;

    const compareWithDirection = (a: number, b: number) => {
      if (a === b) return 0;
      return a > b ? direction : -direction;
    };

    const compareNullableDate = (a: Date | null, b: Date | null) => {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return compareWithDirection(a.getTime(), b.getTime());
    };

    // 先获取所有有支付记录的用户及其总支付金额
    const paidUsersQuery = await this.prisma.paymentOrder.groupBy({
      by: ['userId'],
      where: {
        status: 'paid',
      },
      _sum: {
        amount: true,
      },
      _max: {
        paidAt: true,
        createdAt: true,
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
        noWatermark: true,
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
          lastPaidAt: p._max.paidAt ?? p._max.createdAt ?? null,
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
        noWatermark: user.noWatermark,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        creditBalance: user.creditAccount?.balance || 0,
        totalSpent: user.creditAccount?.totalSpent || 0,
        totalEarned: user.creditAccount?.totalEarned || 0,
        totalPaid: paymentMap.get(user.id)?.totalPaid || 0,
        orderCount: paymentMap.get(user.id)?.orderCount || 0,
        lastPaidAt: paymentMap.get(user.id)?.lastPaidAt || null,
      }))
      .sort((a, b) => {
        if (sortBy === 'registeredAt') {
          const byRegisteredAt = compareWithDirection(
            a.createdAt.getTime(),
            b.createdAt.getTime(),
          );
          if (byRegisteredAt !== 0) return byRegisteredAt;
        } else if (sortBy === 'paidAt') {
          const byPaidAt = compareNullableDate(a.lastPaidAt, b.lastPaidAt);
          if (byPaidAt !== 0) return byPaidAt;
        } else {
          const byAmount = compareWithDirection(a.totalPaid, b.totalPaid);
          if (byAmount !== 0) return byAmount;
        }

        // 保持结果稳定，避免分页时同值抖动
        return a.id.localeCompare(b.id);
      });

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

  async getOrders(options: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
    paymentMethod?: string;
    orderType?: string;
    startDate?: Date;
    endDate?: Date;
  } = {}) {
    const { page = 1, pageSize = 20, search, status, paymentMethod, orderType, startDate, endDate } = options;

    const where: any = {};

    if (status && status !== 'all') where.status = status;
    if (paymentMethod && paymentMethod !== 'all') where.paymentMethod = paymentMethod;
    if (orderType && orderType !== 'all') where.orderType = orderType;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    if (search) {
      const matchingUsers = await this.prisma.user.findMany({
        where: {
          OR: [
            { phone: { contains: search } },
            { email: { contains: search } },
            { name: { contains: search } },
          ],
        },
        select: { id: true },
      });
      const matchingUserIds = matchingUsers.map((u) => u.id);
      where.OR = [
        { orderNo: { contains: search } },
        { tradeNo: { contains: search } },
        ...(matchingUserIds.length > 0 ? [{ userId: { in: matchingUserIds } }] : []),
      ];
    }

    const [total, orders] = await Promise.all([
      this.prisma.paymentOrder.count({ where }),
      this.prisma.paymentOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const userIds = [...new Set(orders.map((o) => o.userId))];
    const users = userIds.length > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, phone: true, email: true, name: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      orders: orders.map((o) => {
        const u = userMap.get(o.userId);
        return {
          id: o.id,
          orderNo: o.orderNo,
          userId: o.userId,
          userPhone: u?.phone ?? null,
          userEmail: u?.email ?? null,
          userName: u?.name ?? null,
          orderType: o.orderType,
          amount: Number(o.amount),
          credits: o.credits,
          paymentMethod: o.paymentMethod,
          status: o.status,
          tradeNo: o.tradeNo,
          paidAt: o.paidAt,
          expiredAt: o.expiredAt,
          createdAt: o.createdAt,
        };
      }),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  // ── 团队管理 ────────────────────────────────────────────────

  async adminListTeams(options: { search?: string; page?: number; pageSize?: number } = {}) {
    const { search, page = 1, pageSize = 20 } = options;
    const where: any = { isPersonal: false };
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const [teams, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        where,
        include: {
          owner: { select: { id: true, name: true, phone: true } },
          _count: { select: { memberships: true } },
          creditAccount: { select: { balance: true, frozenBalance: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.team.count({ where }),
    ]);

    return {
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        ownerId: t.ownerId,
        ownerName: t.owner?.name || t.owner?.phone || t.ownerId,
        memberCount: t._count.memberships,
        maxSeats: t.maxSeats,
        status: t.status,
        availableCredits: (t.creditAccount?.balance ?? 0) - (t.creditAccount?.frozenBalance ?? 0),
        totalCredits: t.creditAccount?.balance ?? 0,
        createdAt: t.createdAt,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async adminUpdateTeamSeats(teamId: string, maxSeats: number) {
    if (maxSeats < 1) throw new Error('席位数不能小于 1');
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    if (team.isPersonal) throw new Error('不能修改个人团队席位');
    const memberCount = await this.prisma.teamMembership.count({ where: { teamId } });
    if (maxSeats < memberCount) throw new Error(`当前已有 ${memberCount} 名成员，席位数不能小于此值`);
    return this.prisma.team.update({ where: { id: teamId }, data: { maxSeats } });
  }

  async adminUpdateTeamStatus(teamId: string, status: string) {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    if (team.isPersonal) throw new Error('不能修改个人团队状态');
    return this.prisma.team.update({ where: { id: teamId }, data: { status } });
  }

  async adminDeleteTeam(teamId: string) {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    if (team.isPersonal) throw new Error('不能删除个人团队');
    await this.prisma.$transaction([
      this.prisma.teamMembership.deleteMany({ where: { teamId } }),
      this.prisma.teamInvite.deleteMany({ where: { teamId } }),
      this.prisma.teamProjectShare.deleteMany({ where: { teamId } }),
      this.prisma.teamSubscription.deleteMany({ where: { teamId } }),
      this.prisma.team.delete({ where: { id: teamId } }),
    ]);
    return { deleted: true };
  }

  async adminGetTeamCreditHistory(teamId: string, page = 1, pageSize = 30) {
    const acc = await this.prisma.teamCreditAccount.findFirst({ where: { teamId } });
    if (!acc) return { records: [], pagination: { page, pageSize, total: 0, totalPages: 0 } };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.teamCreditLedger.findMany({
        where: { teamAccId: acc.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.teamCreditLedger.count({ where: { teamAccId: acc.id } }),
    ]);
    return { records, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async adminAddTeamCredits(teamId: string, amount: number, description: string, adminId: string) {
    if (amount <= 0) throw new Error('amount must be > 0');
    const acc = await this.prisma.teamCreditAccount.findFirstOrThrow({ where: { teamId } });
    await this.prisma.$transaction([
      this.prisma.teamCreditAccount.update({
        where: { id: acc.id },
        data: { balance: { increment: amount }, totalEarned: { increment: amount } },
      }),
      this.prisma.teamCreditLedger.create({
        data: {
          teamAccId: acc.id,
          entryType: 'admin_add',
          amount,
          taskId: `admin_add_${adminId}_${Date.now()}`,
          note: description || `管理员手动增加 ${amount} 积分`,
        },
      }),
    ]);
    void this.teamCreditsPublisher?.publish({
      teamId,
      reason: 'admin_adjust',
      delta: amount,
      actorUserId: adminId,
    });
    return { teamId, addedCredits: amount };
  }

  async adminDeductTeamCredits(teamId: string, amount: number, description: string, adminId: string) {
    if (amount <= 0) throw new Error('amount must be > 0');
    const acc = await this.prisma.teamCreditAccount.findFirstOrThrow({ where: { teamId } });
    const available = acc.balance - acc.frozenBalance;
    if (amount > available) throw new Error(`余额不足，可用积分 ${available}`);
    await this.prisma.$transaction([
      this.prisma.teamCreditAccount.update({
        where: { id: acc.id },
        data: { balance: { decrement: amount }, totalSpent: { increment: amount } },
      }),
      this.prisma.teamCreditLedger.create({
        data: {
          teamAccId: acc.id,
          entryType: 'admin_deduct',
          amount: -amount,
          taskId: `admin_deduct_${adminId}_${Date.now()}`,
          note: description || `管理员手动扣除 ${amount} 积分`,
        },
      }),
    ]);
    void this.teamCreditsPublisher?.publish({
      teamId,
      reason: 'admin_adjust',
      delta: -amount,
      actorUserId: adminId,
    });
    return { teamId, deductedCredits: amount };
  }
}
