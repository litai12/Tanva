import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { ApiResponseStatus, TransactionType } from '../credits/dto/credits.dto';
import { TeamCreditsPublisher } from '../team-collab/team-credits-publisher.service';
import { CreditsService } from '../credits/credits.service';
import { TeamCoreService } from '../team-core/team-core.service';
import { TEAM_PERMANENT_SEATS } from '../payment/dto/payment.dto';

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

interface ApiUsageModelNode {
  key: string;
  name: string;
}

interface ApiUsageModelTopUser {
  userId: string;
  userName: string | null;
  userPhone: string;
  userEmail: string | null;
  callCount: number;
  successfulCalls: number;
  failedCalls: number;
  pendingCalls: number;
  totalCreditsUsed: number;
}

interface ApiUsageModelChannelStats {
  channel: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  pendingCalls: number;
  totalCreditsUsed: number;
  userCount: number;
}

export interface ApiUsageModelStats {
  modelNode: string;
  modelName: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  pendingCalls: number;
  successRate: number;
  totalCreditsUsed: number;
  userCount: number;
  serviceTypes: string[];
  providers: string[];
  models: string[];
  channels: ApiUsageModelChannelStats[];
  topUsers: ApiUsageModelTopUser[];
}

export interface ApiUsageModelStatsResponse {
  items: ApiUsageModelStats[];
  summary: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    pendingCalls: number;
    totalCreditsUsed: number;
    uniqueUsers: number;
  };
  modelNodes: ApiUsageModelNode[];
  channels: string[];
}

export interface ApiUsageFilterOption {
  value: string;
  label: string;
  source: 'credit-transactions' | 'usage';
  count?: number;
}

export interface ApiUsageFilterOptions {
  providers: ApiUsageFilterOption[];
  models: ApiUsageFilterOption[];
  sources: string[];
}

export type CreditChangeSource = 'recharge' | 'admin_add' | 'admin_deduct';

export const LOGIN_NOTICE_SETTING_KEY = 'login_notice';
export const LOGIN_NOTICE_BUTTON_QRCODE_SETTING_KEY = 'login_notice_button_qrcode';
export const CONTEST_REGISTRATION_QRCODE_SETTING_KEY = 'contest_registration_qrcode';

const API_USAGE_MODEL_NODES: ApiUsageModelNode[] = [
  { key: 'banana', name: 'NANO BANANA GEMINI IMAGE GENERATION / EDIT / BLEND' },
  { key: 'banana-analyze', name: 'NANO BANANA GEMINI IMAGE ANALYSIS' },
  { key: 'gpt2', name: 'GPT-IMAGE-2 IMAGE GENERATION' },
  { key: 'seedream', name: 'DOUBAO SEEDREAM 5.0 IMAGE GENERATION' },
  { key: 'midjourney', name: 'MIDJOURNEY V7 / V8 / NIJI 7 IMAGE GENERATION' },
  { key: 'chat', name: 'GEMINI AI TEXT CHAT' },
  { key: 'prompt', name: 'GEMINI PROMPT OPTIMIZE / STORYBOARD TEXT' },
  { key: 'seedance', name: 'SEEDANCE 1.5 / SEEDANCE 2.0 / SEED 2.0 VIDEO' },
  { key: 'kling', name: 'KLING 2.6 / KLING 3.0 / KLING O1-O3 VIDEO' },
  { key: 'vidu', name: 'VIDU Q2 / VIDU Q3 VIDEO' },
  { key: 'wan', name: 'WAN 2.6 / WAN 2.7 VIDEO' },
  { key: 'happyhorse', name: 'HAPPYHORSE 1.0 R2V VIDEO' },
  { key: 'omni', name: 'OMNI FLASH EXT VIDEO' },
  { key: 'video-analyze', name: 'GEMINI VIDEO ANALYSIS' },
  { key: '3d', name: 'SEED3D / 2D-TO-3D MODEL GENERATION' },
  { key: 'audio', name: 'MINIMAX / TENCENT AUDIO GENERATION' },
  { key: 'other', name: 'OTHER AI SERVICES' },
];

const API_USAGE_MODEL_NODE_MAP = new Map(API_USAGE_MODEL_NODES.map((item) => [item.key, item]));

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

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private addFilterOption(
    map: Map<string, ApiUsageFilterOption>,
    value: unknown,
    source: ApiUsageFilterOption['source'],
    label?: unknown,
    count?: number,
  ) {
    const normalizedValue = this.asNonEmptyString(value);
    if (!normalizedValue) return;
    const key = normalizedValue.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.count = (existing.count || 0) + (count || 0);
      if (existing.source === 'usage' && source !== 'usage') existing.source = source;
      return;
    }
    map.set(key, {
      value: normalizedValue,
      label: this.asNonEmptyString(label) || normalizedValue,
      source,
      ...(count ? { count } : {}),
    });
  }

  private sortFilterOptions(map: Map<string, ApiUsageFilterOption>) {
    return [...map.values()].sort((a, b) => {
      const byCount = (b.count || 0) - (a.count || 0);
      if (byCount !== 0) return byCount;
      return a.label.localeCompare(b.label);
    });
  }

  private getRequestChannelFromParams(params: unknown): string | null {
    const objectValue = this.asJsonObject(params);
    if (!objectValue) return null;
    return (
      this.asNonEmptyString(objectValue.channel) ||
      this.asNonEmptyString(objectValue.executionChannel) ||
      this.asNonEmptyString(objectValue.providerChannel) ||
      this.asNonEmptyString(objectValue.platformKey) ||
      this.asNonEmptyString(objectValue.vendorKey) ||
      this.asNonEmptyString(objectValue.channelHint) ||
      this.asNonEmptyString(objectValue.routedProvider)
    );
  }

  private includesAny(haystack: string, needles: string[]): boolean {
    return needles.some((needle) => haystack.includes(needle));
  }

  private resolveApiUsageModelNode(params: {
    serviceType?: string | null;
    provider?: string | null;
    model?: string | null;
    requestParams?: Prisma.JsonValue | Record<string, unknown> | null;
  }): ApiUsageModelNode {
    const serviceType = (this.asNonEmptyString(params.serviceType) || '').toLowerCase();
    const provider = (this.asNonEmptyString(params.provider) || '').toLowerCase();
    const model = (this.asNonEmptyString(params.model) || '').toLowerCase();
    const requestParams = this.asJsonObject(params.requestParams) || {};
    const managedModelKey = (this.asNonEmptyString(requestParams.managedModelKey) || '').toLowerCase();
    const modelKey = (this.asNonEmptyString(requestParams.modelKey) || '').toLowerCase();
    const seedanceModel = (this.asNonEmptyString(requestParams.seedanceModel) || '').toLowerCase();
    const viduModel = (
      this.asNonEmptyString(requestParams.viduModelVariant) ||
      this.asNonEmptyString(requestParams.viduModel) ||
      ''
    ).toLowerCase();
    const requestModel = (this.asNonEmptyString(requestParams.model) || '').toLowerCase();
    const search = [
      serviceType,
      provider,
      model,
      managedModelKey,
      modelKey,
      seedanceModel,
      viduModel,
      requestModel,
    ]
      .filter(Boolean)
      .join(' ');

    let key = 'other';

    if (managedModelKey === 'omni-flash-ext' || model === 'omni-flash-ext') {
      key = 'omni';
    } else if (serviceType === 'convert-2d-to-3d' || this.includesAny(search, ['seed3d', 'seed-3d'])) {
      key = '3d';
    } else if (
      serviceType === 'gemini-text' &&
      this.includesAny(search, ['storyboard', 'shot-split', 'prompt-split'])
    ) {
      key = 'prompt';
    } else if (serviceType === 'gemini-text') {
      key = 'chat';
    } else if (serviceType === 'gemini-prompt-optimize') {
      key = 'prompt';
    } else if (serviceType === 'gemini-video-analyze') {
      key = 'video-analyze';
    } else if (
      this.includesAny(serviceType, [
        'gemini-image-analyze',
        'gemini-2.5-image-analyze',
        'gemini-3.1-image-analyze',
      ])
    ) {
      key = 'banana-analyze';
    } else if (serviceType === 'gpt-image-2' || this.includesAny(search, ['gpt-image-2'])) {
      key = 'gpt2';
    } else if (
      serviceType === 'doubao-seedream-5-0-260128' ||
      this.includesAny(search, ['seedream', 'doubao-seedream'])
    ) {
      key = 'seedream';
    } else if (serviceType.startsWith('midjourney') || this.includesAny(search, ['midjourney', 'niji'])) {
      key = 'midjourney';
    } else if (
      this.includesAny(serviceType, [
        'gemini-2.5-image',
        'gemini-3-pro-image',
        'gemini-3.1-image',
        'gemini-image-edit',
        'gemini-3.1-image-edit',
        'gemini-2.5-image-edit',
        'gemini-image-blend',
        'gemini-3.1-image-blend',
        'gemini-2.5-image-blend',
      ])
    ) {
      key = 'banana';
    } else if (serviceType.includes('kling') || search.includes('kling')) {
      key = 'kling';
    } else if (serviceType.includes('vidu') || this.includesAny(search, ['vidu', 'q2', 'q3'])) {
      key = 'vidu';
    } else if (serviceType.includes('wan') || this.includesAny(search, ['wan2.6', 'wan2.7', 'wan-2.7'])) {
      key = 'wan';
    } else if (serviceType.includes('happyhorse') || search.includes('happyhorse')) {
      key = 'happyhorse';
    } else if (
      serviceType === 'doubao-video' ||
      this.includesAny(search, [
        'seedance',
        'seed-2.0',
        'seed-2-0',
        'doubao-seedance',
        'doubao-seed-2-0',
      ])
    ) {
      key = 'seedance';
    } else if (
      this.includesAny(serviceType, ['minimax-speech', 'minimax-music', 'tencent-speech']) ||
      this.includesAny(search, ['speech', 'music', 'audio'])
    ) {
      key = 'audio';
    }

    return API_USAGE_MODEL_NODE_MAP.get(key) || API_USAGE_MODEL_NODE_MAP.get('other')!;
  }

  private normalizeApiUsageChannel(params: {
    provider?: string | null;
    requestParams?: Prisma.JsonValue | Record<string, unknown> | null;
  }): string {
    const requestParams = this.asJsonObject(params.requestParams) || {};
    const raw =
      this.getRequestChannelFromParams(requestParams) ||
      this.asNonEmptyString(params.provider) ||
      'UNKNOWN';
    const normalized = raw.toLowerCase();

    if (normalized === 'legacy' || normalized.includes('147')) return '147';
    if (normalized.includes('apimart')) return 'APIMART';
    if (normalized === 'tencent_vod' || normalized.includes('tencent-vod')) return 'TENCENT VOD';
    if (normalized === 'tencent' || normalized.includes('tencent')) return 'TENCENT';
    if (normalized.includes('doubao') || normalized.includes('ark') || normalized.includes('seedance')) return 'DOUBAO / ARK';
    if (normalized.includes('dashscope') || normalized.includes('wan') || normalized.includes('happyhorse')) return 'DASHSCOPE';
    if (normalized.includes('kling')) return 'KLING';
    if (normalized.includes('vidu')) return 'VIDU';
    if (normalized.includes('midjourney')) return 'MIDJOURNEY';
    if (normalized.includes('seedream') || normalized.includes('watcha')) return 'SEEDREAM';
    if (normalized.includes('new_api') || normalized.includes('new-api')) return 'NEW API';
    return raw.toUpperCase();
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
      if (this.isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  private isMissingTableError(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
    if (error.code === 'P2021') return true;

    const meta = error.meta as Record<string, unknown> | null | undefined;
    const rawCode = typeof meta?.code === 'string' ? meta.code : '';
    if (error.code === 'P2010' && rawCode === '42P01') return true;

    const message = `${error.message} ${typeof meta?.message === 'string' ? meta.message : ''}`.toLowerCase();
    return message.includes('does not exist') && message.includes('relation');
  }

  /**
   * 获取管理后台统计数据
   */
  private assertSqlIdentifier(identifier: string) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
      throw new Error(`Invalid SQL identifier: ${identifier}`);
    }
  }

  private async tableColumnExists(
    tx: Prisma.TransactionClient,
    tableName: string,
    columnName: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ${tableName}
          AND column_name = ${columnName}
      ) AS "exists"
    `;
    return rows[0]?.exists === true;
  }

  private async deleteFromTableByColumnIfExists(
    tx: Prisma.TransactionClient,
    tableName: string,
    columnName: string,
    value: string,
  ) {
    this.assertSqlIdentifier(tableName);
    this.assertSqlIdentifier(columnName);

    if (!(await this.tableColumnExists(tx, tableName, columnName))) return;

    await tx.$executeRawUnsafe(`DELETE FROM "${tableName}" WHERE "${columnName}" = $1`, value);
  }

  private async updateTableColumnToNullIfExists(
    tx: Prisma.TransactionClient,
    tableName: string,
    columnName: string,
    value: string,
  ) {
    this.assertSqlIdentifier(tableName);
    this.assertSqlIdentifier(columnName);

    if (!(await this.tableColumnExists(tx, tableName, columnName))) return;

    await tx.$executeRawUnsafe(`UPDATE "${tableName}" SET "${columnName}" = NULL WHERE "${columnName}" = $1`, value);
  }

  private async deleteFromTableByAnyColumnIfExists(
    tx: Prisma.TransactionClient,
    tableName: string,
    columnNames: string[],
    value: string,
  ) {
    this.assertSqlIdentifier(tableName);

    const existingColumns: string[] = [];
    for (const columnName of columnNames) {
      this.assertSqlIdentifier(columnName);
      if (await this.tableColumnExists(tx, tableName, columnName)) {
        existingColumns.push(columnName);
      }
    }

    if (existingColumns.length === 0) return;

    const where = existingColumns.map((columnName) => `"${columnName}" = $1`).join(' OR ');
    await tx.$executeRawUnsafe(`DELETE FROM "${tableName}" WHERE ${where}`, value);
  }

  private async deleteTeamProjectSharesForUserProjectsIfExists(
    tx: Prisma.TransactionClient,
    userId: string,
  ) {
    if (
      !(await this.tableColumnExists(tx, 'TeamProjectShare', 'projectId')) ||
      !(await this.tableColumnExists(tx, 'Project', 'userId'))
    ) {
      return;
    }

    await tx.$executeRawUnsafe(
      `DELETE FROM "TeamProjectShare"
       WHERE "projectId" IN (SELECT "id" FROM "Project" WHERE "userId" = $1)`,
      userId,
    );
  }

  private async deleteOwnedTeamsIfExists(tx: Prisma.TransactionClient, userId: string) {
    if (!(await this.tableColumnExists(tx, 'Team', 'ownerId'))) return;

    const ownedTeams = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "Team" WHERE "ownerId" = $1`,
      userId,
    );

    for (const team of ownedTeams) {
      await this.deleteFromTableByColumnIfExists(tx, 'TeamMembership', 'teamId', team.id);
      await this.deleteFromTableByColumnIfExists(tx, 'TeamInvite', 'teamId', team.id);
      await this.deleteFromTableByColumnIfExists(tx, 'TeamProjectShare', 'teamId', team.id);
      await this.deleteFromTableByColumnIfExists(tx, 'TeamSubscription', 'teamId', team.id);
      await this.deleteFromTableByColumnIfExists(tx, 'TeamSeatPackage', 'teamId', team.id);

      if (await this.tableColumnExists(tx, 'TeamCreditAccount', 'teamId')) {
        const teamCreditAccounts = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT "id" FROM "TeamCreditAccount" WHERE "teamId" = $1`,
          team.id,
        );

        for (const account of teamCreditAccounts) {
          await this.deleteFromTableByColumnIfExists(tx, 'TeamCreditLedger', 'teamAccId', account.id);
          await this.deleteFromTableByColumnIfExists(tx, 'TeamCreditLot', 'teamCreditAccId', account.id);
        }

        await this.deleteFromTableByColumnIfExists(tx, 'TeamCreditAccount', 'teamId', team.id);
      }
    }

    await tx.$executeRawUnsafe(`DELETE FROM "Team" WHERE "ownerId" = $1`, userId);
  }

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
      throw new BadRequestException('手机号格式不正确，请输入有效的11位手机号');
    }
    if (password.length < 8 || password.length > 100) {
      throw new BadRequestException('密码长度必须在8到100位之间');
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/.test(password)) {
      throw new BadRequestException('密码需包含大小写字母和数字');
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

  async getApiUsageModelStats(options: {
    startDate?: Date;
    endDate?: Date;
    modelNode?: string;
    channel?: string;
  } = {}): Promise<ApiUsageModelStatsResponse> {
    const { startDate, endDate } = options;
    const requestedModelNode = this.asNonEmptyString(options.modelNode)?.toLowerCase();
    const requestedChannel = this.asNonEmptyString(options.channel)?.toUpperCase();

    const where: Prisma.ApiUsageRecordWhereInput = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const records = await this.prisma.apiUsageRecord.findMany({
      where,
      select: {
        userId: true,
        serviceType: true,
        provider: true,
        model: true,
        creditsUsed: true,
        responseStatus: true,
        requestParams: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    type MutableStats = ApiUsageModelStats & {
      serviceTypeSet: Set<string>;
      providerSet: Set<string>;
      modelSet: Set<string>;
      userSet: Set<string>;
      channelMap: Map<string, ApiUsageModelChannelStats & { userSet: Set<string> }>;
      topUserMap: Map<string, ApiUsageModelTopUser>;
    };

    const createStats = (node: ApiUsageModelNode): MutableStats => ({
      modelNode: node.key,
      modelName: node.name,
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      pendingCalls: 0,
      successRate: 0,
      totalCreditsUsed: 0,
      userCount: 0,
      serviceTypes: [],
      providers: [],
      models: [],
      channels: [],
      topUsers: [],
      serviceTypeSet: new Set<string>(),
      providerSet: new Set<string>(),
      modelSet: new Set<string>(),
      userSet: new Set<string>(),
      channelMap: new Map<string, ApiUsageModelChannelStats & { userSet: Set<string> }>(),
      topUserMap: new Map<string, ApiUsageModelTopUser>(),
    });

    const statsByNode = new Map<string, MutableStats>();
    const allChannels = new Set<string>();
    const summaryUserIds = new Set<string>();

    records.forEach((record) => {
      const node = this.resolveApiUsageModelNode(record);
      if (requestedModelNode && requestedModelNode !== node.key) return;

      const channel = this.normalizeApiUsageChannel(record);
      allChannels.add(channel);
      if (requestedChannel && requestedChannel !== channel.toUpperCase()) return;

      const isSuccess = record.responseStatus === ApiResponseStatus.SUCCESS;
      const isFailed = record.responseStatus === ApiResponseStatus.FAILED;
      const isPending = record.responseStatus === ApiResponseStatus.PENDING;
      const consumedCredits = isFailed ? 0 : Math.max(0, record.creditsUsed || 0);

      if (!statsByNode.has(node.key)) {
        statsByNode.set(node.key, createStats(node));
      }

      const stats = statsByNode.get(node.key)!;
      stats.totalCalls += 1;
      stats.successfulCalls += isSuccess ? 1 : 0;
      stats.failedCalls += isFailed ? 1 : 0;
      stats.pendingCalls += isPending ? 1 : 0;
      stats.totalCreditsUsed += consumedCredits;
      stats.userSet.add(record.userId);
      summaryUserIds.add(record.userId);

      const serviceType = this.asNonEmptyString(record.serviceType);
      const provider = this.asNonEmptyString(record.provider);
      const model = this.asNonEmptyString(record.model);
      if (serviceType) stats.serviceTypeSet.add(serviceType);
      if (provider) stats.providerSet.add(provider);
      if (model) stats.modelSet.add(model);

      if (!stats.channelMap.has(channel)) {
        stats.channelMap.set(channel, {
          channel,
          totalCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          pendingCalls: 0,
          totalCreditsUsed: 0,
          userCount: 0,
          userSet: new Set<string>(),
        });
      }
      const channelStats = stats.channelMap.get(channel)!;
      channelStats.totalCalls += 1;
      channelStats.successfulCalls += isSuccess ? 1 : 0;
      channelStats.failedCalls += isFailed ? 1 : 0;
      channelStats.pendingCalls += isPending ? 1 : 0;
      channelStats.totalCreditsUsed += consumedCredits;
      channelStats.userSet.add(record.userId);

      if (!stats.topUserMap.has(record.userId)) {
        stats.topUserMap.set(record.userId, {
          userId: record.userId,
          userName: null,
          userPhone: '',
          userEmail: null,
          callCount: 0,
          successfulCalls: 0,
          failedCalls: 0,
          pendingCalls: 0,
          totalCreditsUsed: 0,
        });
      }
      const userStats = stats.topUserMap.get(record.userId)!;
      userStats.callCount += 1;
      userStats.successfulCalls += isSuccess ? 1 : 0;
      userStats.failedCalls += isFailed ? 1 : 0;
      userStats.pendingCalls += isPending ? 1 : 0;
      userStats.totalCreditsUsed += consumedCredits;
    });

    const userIds = Array.from(
      new Set(
        Array.from(statsByNode.values()).flatMap((stats) =>
          Array.from(stats.topUserMap.values())
            .sort((a, b) => b.totalCreditsUsed - a.totalCreditsUsed || b.callCount - a.callCount)
            .slice(0, 10)
            .map((user) => user.userId),
        ),
      ),
    );
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, phone: true, email: true },
        })
      : [];
    const userMap = new Map(users.map((user) => [user.id, user]));

    const items = Array.from(statsByNode.values())
      .map((stats) => {
        const topUsers = Array.from(stats.topUserMap.values())
          .sort((a, b) => b.totalCreditsUsed - a.totalCreditsUsed || b.callCount - a.callCount)
          .slice(0, 10)
          .map((userStats) => {
            const user = userMap.get(userStats.userId);
            return {
              ...userStats,
              userName: user?.name || null,
              userPhone: user?.phone || '',
              userEmail: user?.email || null,
            };
          });

        const channels = Array.from(stats.channelMap.values())
          .map((channelStats) => {
            const { userSet, ...rest } = channelStats;
            return {
              ...rest,
              userCount: userSet.size,
            };
          })
          .sort((a, b) => b.totalCreditsUsed - a.totalCreditsUsed || b.totalCalls - a.totalCalls);

        return {
          modelNode: stats.modelNode,
          modelName: stats.modelName,
          totalCalls: stats.totalCalls,
          successfulCalls: stats.successfulCalls,
          failedCalls: stats.failedCalls,
          pendingCalls: stats.pendingCalls,
          successRate: stats.totalCalls > 0 ? stats.successfulCalls / stats.totalCalls : 0,
          totalCreditsUsed: stats.totalCreditsUsed,
          userCount: stats.userSet.size,
          serviceTypes: Array.from(stats.serviceTypeSet).sort(),
          providers: Array.from(stats.providerSet).sort(),
          models: Array.from(stats.modelSet).sort(),
          channels,
          topUsers,
        };
      })
      .sort((a, b) => b.totalCreditsUsed - a.totalCreditsUsed || b.totalCalls - a.totalCalls);

    return {
      items,
      summary: {
        totalCalls: items.reduce((sum, item) => sum + item.totalCalls, 0),
        successfulCalls: items.reduce((sum, item) => sum + item.successfulCalls, 0),
        failedCalls: items.reduce((sum, item) => sum + item.failedCalls, 0),
        pendingCalls: items.reduce((sum, item) => sum + item.pendingCalls, 0),
        totalCreditsUsed: items.reduce((sum, item) => sum + item.totalCreditsUsed, 0),
        uniqueUsers: summaryUserIds.size,
      },
      modelNodes: API_USAGE_MODEL_NODES.filter((node) => node.key !== 'other'),
      channels: Array.from(allChannels).sort(),
    };
  }

  /**
   * 获取所有 API 使用记录
   */
  async getApiUsageFilterOptions(): Promise<ApiUsageFilterOptions> {
    const providers = new Map<string, ApiUsageFilterOption>();
    const models = new Map<string, ApiUsageFilterOption>();
    const sources = new Set<string>(['credit-transactions']);

    const transactionRows = await this.prisma.creditTransaction.findMany({
      where: {
        apiUsageId: { not: null },
        type: { in: [TransactionType.SPEND, TransactionType.ADJUSTMENT] },
      },
      select: { apiUsageId: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const apiUsageIds = Array.from(
      new Set(
        transactionRows
          .map((row) => row.apiUsageId)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (apiUsageIds.length > 0) {
      const usageRows = await this.prisma.apiUsageRecord.findMany({
        where: { id: { in: apiUsageIds } },
        select: { provider: true, model: true },
      });

      usageRows.forEach((row) => {
        this.addFilterOption(providers, row.provider, 'credit-transactions');
        this.addFilterOption(models, row.model, 'credit-transactions');
      });
    }

    if (providers.size === 0 && models.size === 0) {
      sources.add('usage');
      const recentUsageRows = await this.prisma.apiUsageRecord.findMany({
        select: { provider: true, model: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });
      recentUsageRows.forEach((row) => {
        this.addFilterOption(providers, row.provider, 'usage');
        this.addFilterOption(models, row.model, 'usage');
      });
    }

    return {
      providers: this.sortFilterOptions(providers),
      models: this.sortFilterOptions(models),
      sources: [...sources],
    };
  }

  async getAllApiUsageRecords(options: {
    page?: number;
    pageSize?: number;
    userId?: string;
    userSearch?: string;
    serviceType?: string;
    provider?: string;
    model?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
  } = {}) {
    const { page = 1, pageSize = 10, userId, userSearch, serviceType, provider, model, status, startDate, endDate } = options;

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
    if (model) where.model = { contains: model, mode: 'insensitive' };
    if (status) where.responseStatus = status;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [records, total, summaryAggregate, statusGroups, userGroups] = await Promise.all([
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
      this.prisma.apiUsageRecord.aggregate({
        where,
        _sum: {
          creditsUsed: true,
          inputTokens: true,
          outputTokens: true,
        },
        _avg: {
          processingTime: true,
        },
      }),
      this.prisma.apiUsageRecord.groupBy({
        by: ['responseStatus'],
        where,
        _count: true,
        _sum: {
          creditsUsed: true,
        },
      }),
      this.prisma.apiUsageRecord.groupBy({
        by: ['userId'],
        where,
        _count: true,
      }),
    ]);

    const successfulGroup = statusGroups.find((item) => item.responseStatus === ApiResponseStatus.SUCCESS);
    const pendingGroup = statusGroups.find((item) => item.responseStatus === ApiResponseStatus.PENDING);
    const failedGroup = statusGroups.find((item) => item.responseStatus === ApiResponseStatus.FAILED);
    const successfulCredits = successfulGroup?._sum.creditsUsed || 0;
    const pendingCredits = pendingGroup?._sum.creditsUsed || 0;
    const failedCredits = failedGroup?._sum.creditsUsed || 0;

    return {
      records,
      summary: {
        totalCalls: total,
        successfulCalls: successfulGroup?._count || 0,
        failedCalls: failedGroup?._count || 0,
        pendingCalls: pendingGroup?._count || 0,
        totalCreditsUsed: successfulCredits + pendingCredits,
        successfulCredits,
        pendingCredits,
        refundedCredits: failedCredits,
        rawCreditsRecorded: summaryAggregate._sum.creditsUsed || 0,
        inputTokens: summaryAggregate._sum.inputTokens || 0,
        outputTokens: summaryAggregate._sum.outputTokens || 0,
        uniqueUsers: userGroups.length,
        averageProcessingTime: summaryAggregate._avg.processingTime
          ? Math.round(summaryAggregate._avg.processingTime)
          : null,
      },
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

      await this.updateTableColumnToNullIfExists(tx, 'User', 'invitedById', userId);
      await this.updateTableColumnToNullIfExists(tx, 'WechatLoginSession', 'userId', userId);
      await tx.refreshToken.deleteMany({ where: { userId } });
      await this.deleteFromTableByColumnIfExists(tx, 'UserTemplate', 'userId', userId);
      await this.deleteFromTableByColumnIfExists(tx, 'WorkflowHistory', 'userId', userId);
      await this.deleteTeamProjectSharesForUserProjectsIfExists(tx, userId);
      await tx.project.deleteMany({ where: { userId } });
      await this.deleteFromTableByColumnIfExists(tx, 'GenerationImageReuse', 'userId', userId);
      await this.deleteFromTableByColumnIfExists(tx, 'GenerationImageAsset', 'userId', userId);

      const account = await tx.creditAccount.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (account) {
        await this.deleteFromTableByColumnIfExists(tx, 'CreditAnomalyRecord', 'accountId', account.id);
        await tx.creditTransaction.deleteMany({ where: { accountId: account.id } });
        await tx.creditLot.deleteMany({ where: { accountId: account.id } });
        await tx.creditAccount.delete({ where: { id: account.id } });
      }

      await this.deleteFromTableByColumnIfExists(tx, 'CreditAnomalyRecord', 'userId', userId);
      await this.deleteFromTableByColumnIfExists(tx, 'MembershipSubscriptionChange', 'userId', userId);
      await this.deleteFromTableByColumnIfExists(tx, 'UserMembershipSubscription', 'userId', userId);
      await this.deleteFromTableByColumnIfExists(tx, 'MembershipEntitlementSnapshot', 'userId', userId);
      await this.deleteFromTableByColumnIfExists(tx, 'ApiUsageRecord', 'userId', userId);
      await this.deleteFromTableByColumnIfExists(tx, 'GlobalImageHistory', 'userId', userId);
      await this.deleteFromTableByColumnIfExists(tx, 'BioAuthGroup', 'userId', userId);

      await this.deleteFromTableByAnyColumnIfExists(
        tx,
        'InvitationRedemption',
        ['inviteeUserId', 'inviterUserId'],
        userId,
      );
      await this.updateTableColumnToNullIfExists(tx, 'InvitationCode', 'inviterUserId', userId);

      await this.deleteFromTableByColumnIfExists(tx, 'PaymentOrder', 'userId', userId);
      await this.deleteFromTableByColumnIfExists(tx, 'ImageTask', 'userId', userId);
      await this.deleteFromTableByColumnIfExists(tx, 'VideoTask', 'userId', userId);
      await this.deleteFromTableByColumnIfExists(tx, 'TeamMembership', 'userId', userId);
      await this.deleteFromTableByColumnIfExists(tx, 'TeamProjectShare', 'sharedByUserId', userId);
      await this.deleteOwnedTeamsIfExists(tx, userId);
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

    // 席位容量唯一口径：永久席位 + 有效席位包（含后台 admin 包）。按页聚合，避免 N+1。
    const pkgSums = await this.prisma.teamSeatPackage.groupBy({
      by: ['teamId'],
      where: {
        teamId: { in: teams.map((t) => t.id) },
        status: 'active',
        expiresAt: { gt: new Date() },
      },
      _sum: { seats: true },
    });
    const seatPkgMap = new Map(pkgSums.map((p) => [p.teamId, p._sum.seats ?? 0]));

    return {
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        ownerId: t.ownerId,
        ownerName: t.owner?.name || t.owner?.phone || t.ownerId,
        memberCount: t._count.memberships,
        seatCapacity: TEAM_PERMANENT_SEATS + (seatPkgMap.get(t.id) ?? 0),
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

  /**
   * 后台调整团队席位（单轨）：targetSeats 为期望的「总容量」。
   * 容量 = 永久席位 + 有效席位包，因此管理员的调整落地为一条 cycle='admin' 的永久包：
   *   adminSeats = max(0, target - 永久席位 - 已购(非 admin)有效席位)
   * 已付费席位不可被管理员撤销；upsert 唯一 admin 包，保证仍是单一容量来源。
   */
  async adminUpdateTeamSeats(teamId: string, targetSeats: number) {
    if (!Number.isInteger(targetSeats) || targetSeats < 1) throw new Error('席位数不能小于 1');
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    if (team.isPersonal) throw new Error('不能修改个人团队席位');
    const memberCount = await this.prisma.teamMembership.count({ where: { teamId } });
    if (targetSeats < memberCount) throw new Error(`当前已有 ${memberCount} 名成员，席位数不能小于此值`);

    const now = new Date();
    // 已购(非 admin)有效席位 —— 管理员不能撤销用户已付费的席位
    const purchased = await this.prisma.teamSeatPackage.aggregate({
      where: { teamId, status: 'active', cycle: { not: 'admin' }, expiresAt: { gt: now } },
      _sum: { seats: true },
    });
    const adminSeats = Math.max(0, targetSeats - TEAM_PERMANENT_SEATS - (purchased._sum.seats ?? 0));
    const FAR_FUTURE = new Date('2999-12-31T00:00:00.000Z');

    const existing = await this.prisma.teamSeatPackage.findFirst({
      where: { teamId, cycle: 'admin' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      await this.prisma.teamSeatPackage.update({
        where: { id: existing.id },
        data: { seats: adminSeats, status: adminSeats > 0 ? 'active' : 'expired', expiresAt: FAR_FUTURE },
      });
    } else if (adminSeats > 0) {
      await this.prisma.teamSeatPackage.create({
        data: {
          teamId,
          seats: adminSeats,
          cycle: 'admin',
          credits: 0,
          status: 'active',
          purchasedAt: now,
          expiresAt: FAR_FUTURE,
        },
      });
    }

    const seatCapacity = await this.teamCoreService.getSeatCapacity(teamId);
    return { teamId, seatCapacity };
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
