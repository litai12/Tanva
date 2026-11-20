import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiResponseStatus } from '../../credits/dto/credits.dto';
import { TenantContextService } from '../../tenancy/tenant-context.service';

export interface ApiUsageStatsRow {
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

/**
 * API 用量按天预聚合（rollup）服务。
 *
 * 设计：历史天数据从 ApiUsageDailyStat 读（小表、已聚合），「昨天+今天」从
 * ApiUsageRecord 明细实时读（≤2 天、走 createdAt 索引）。两段无重叠也无缺口：
 * - 历史段：rollup.day < 昨天
 * - 实时段：createdAt >= 昨天 00:00
 * 因此即使每日滚动任务在 00:15 才把昨天落库，昨天的数据始终能从明细实时覆盖。
 *
 * 去重用户数与 topN 全部在 SQL 端完成（COUNT DISTINCT / ROW_NUMBER），不再把
 * 「每用户一行」materialize 进 Node 堆。
 */
@Injectable()
export class ApiUsageRollupService {
  private readonly logger = new Logger(ApiUsageRollupService.name);
  private rollupRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private localDayStart(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private dayStr(date: Date): string {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, '0');
    const d = `${date.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * 把指定本地自然日的明细聚合进 rollup（先删该天再插，保证幂等且与明细一致）。
   * 返回写入的聚合行数。
   */
  async rollupDay(date: Date): Promise<number> {
    const start = this.localDayStart(date);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const day = this.dayStr(start);

    // ALLOW_RAW_NO_TENANT: 日聚合是平台级维护任务；userId 为全局 UUID，查询时再按租户过滤。
    const [, inserted] = await this.tenantContext.runAsPlatform(() =>
      this.prisma.$transaction([
        // ALLOW_RAW_NO_TENANT: 平台级日聚合按全局唯一 userId 重建指定日期数据。
        this.prisma.$executeRaw`DELETE FROM "ApiUsageDailyStat" WHERE "day" = ${day}::date`,
        // ALLOW_RAW_NO_TENANT: 平台级日聚合按全局唯一 userId 汇总，读取时执行租户过滤。
        this.prisma.$executeRaw`
          INSERT INTO "ApiUsageDailyStat" (
            "id", "day", "userId", "serviceType", "serviceName", "provider", "responseStatus",
            "totalCalls", "totalCredits", "inputTokens", "outputTokens", "sumProcessTime", "procTimeCount", "updatedAt"
          )
          SELECT
            gen_random_uuid()::text,
            ${day}::date,
            "userId", "serviceType", "serviceName", "provider", "responseStatus",
            COUNT(*)::int,
            COALESCE(SUM("creditsUsed"), 0)::int,
            COALESCE(SUM("inputTokens"), 0)::bigint,
            COALESCE(SUM("outputTokens"), 0)::bigint,
            COALESCE(SUM("processingTime"), 0)::bigint,
            COUNT("processingTime")::int,
            NOW()
          FROM "ApiUsageRecord"
          WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
          GROUP BY "userId", "serviceType", "serviceName", "provider", "responseStatus"
        `,
      ]),
    );

    return Number(inserted) || 0;
  }

  /**
   * 回填 [fromDate, toDate] 之间的每个本地自然日（含端点）。供一次性脚本调用。
   */
  async backfillRange(fromDate: Date, toDate: Date): Promise<{ days: number; rows: number }> {
    let cursor = this.localDayStart(fromDate);
    const last = this.localDayStart(toDate);
    let days = 0;
    let rows = 0;
    while (cursor.getTime() <= last.getTime()) {
      rows += await this.rollupDay(cursor);
      days += 1;
      const next = new Date(cursor);
      next.setDate(next.getDate() + 1);
      cursor = next;
    }
    return { days, rows };
  }

  /**
   * 按服务类型聚合统计（替代原 admin 全表 groupBy + 内存聚合）。
   * 历史走 rollup，昨天+今天走明细实时，合并后在 SQL 端出 distinct 用户数与 top5。
   */
  async getServiceStats(options: { startDate?: Date; endDate?: Date } = {}): Promise<ApiUsageStatsRow[]> {
    const now = new Date();
    const todayStart = this.localDayStart(now);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const effectiveEnd = options.endDate ?? now;
    // rollup 历史段的天范围
    const startDayStr = options.startDate ? this.dayStr(this.localDayStart(options.startDate)) : '1970-01-01';
    const endDayStr = this.dayStr(this.localDayStart(effectiveEnd));
    const yDayStr = this.dayStr(yesterdayStart);
    // 实时段时间戳边界：下界取 max(请求起点, 昨天 00:00)
    const liveLower =
      options.startDate && options.startDate.getTime() > yesterdayStart.getTime()
        ? options.startDate
        : yesterdayStart;
    const liveUpper = effectiveEnd;

    const SUCCESS = ApiResponseStatus.SUCCESS;
    const FAILED = ApiResponseStatus.FAILED;
    const platformMode = this.tenantContext.isPlatformMode();
    const tenantId = this.tenantContext.getTenantId();
    const historyTenantFilter = platformMode
      ? Prisma.empty
      : Prisma.sql`AND EXISTS (
          SELECT 1 FROM "User" tenant_user
          WHERE tenant_user."id" = daily."userId"
            AND tenant_user."tenantId" = ${tenantId}
        )`;
    const liveTenantFilter = platformMode
      ? Prisma.empty
      : Prisma.sql`AND live."tenantId" = ${tenantId}`;

    // 历史(rollup, day < 昨天) ∪ 实时(明细, createdAt >= 昨天 00:00)
    const combined = Prisma.sql`
      WITH combined AS (
        SELECT daily."userId", daily."serviceType", daily."serviceName", daily."provider", daily."responseStatus",
               daily."totalCalls" AS calls, daily."totalCredits" AS credits
        FROM "ApiUsageDailyStat" daily
        WHERE daily."day" >= ${startDayStr}::date AND daily."day" <= ${endDayStr}::date AND daily."day" < ${yDayStr}::date
          ${historyTenantFilter}
        UNION ALL
        SELECT live."userId", live."serviceType", live."serviceName", live."provider", live."responseStatus",
               1 AS calls, live."creditsUsed" AS credits
        FROM "ApiUsageRecord" live
        WHERE live."createdAt" >= ${liveLower} AND live."createdAt" <= ${liveUpper}
          ${liveTenantFilter}
      )
    `;

    // ALLOW_RAW_NO_TENANT: combined 已在租户态注入历史与实时两段过滤，平台态有意跨租户。
    const serviceRows = await this.prisma.$queryRaw<
      Array<{
        serviceType: string;
        serviceName: string;
        provider: string;
        totalCalls: bigint;
        successfulCalls: bigint;
        failedCalls: bigint;
        totalCreditsUsed: bigint;
        userCount: bigint;
      }>
    >(Prisma.sql`
      ${combined}
      SELECT
        "serviceType",
        MIN("serviceName") AS "serviceName",
        MIN("provider") AS "provider",
        COALESCE(SUM(calls), 0)::bigint AS "totalCalls",
        COALESCE(SUM(calls) FILTER (WHERE "responseStatus" = ${SUCCESS}), 0)::bigint AS "successfulCalls",
        COALESCE(SUM(calls) FILTER (WHERE "responseStatus" = ${FAILED}), 0)::bigint AS "failedCalls",
        COALESCE(SUM(credits), 0)::bigint AS "totalCreditsUsed",
        COUNT(DISTINCT "userId")::bigint AS "userCount"
      FROM combined
      GROUP BY "serviceType"
      ORDER BY "totalCalls" DESC
    `);

    if (serviceRows.length === 0) return [];

    // ALLOW_RAW_NO_TENANT: combined 已在租户态注入历史与实时两段过滤，平台态有意跨租户。
    const topRows = await this.prisma.$queryRaw<
      Array<{ serviceType: string; userId: string; callCount: bigint }>
    >(Prisma.sql`
      ${combined},
      ranked AS (
        SELECT "serviceType", "userId",
               SUM(calls)::bigint AS "callCount",
               ROW_NUMBER() OVER (PARTITION BY "serviceType" ORDER BY SUM(calls) DESC) AS rn
        FROM combined
        GROUP BY "serviceType", "userId"
      )
      SELECT "serviceType", "userId", "callCount"
      FROM ranked
      WHERE rn <= 5
      ORDER BY "serviceType", "callCount" DESC
    `);

    const topUserIds = [...new Set(topRows.map((r) => r.userId))];
    const users = topUserIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: topUserIds } },
          select: { id: true, name: true, phone: true, email: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const topByService = new Map<string, ApiUsageStatsRow['topUsers']>();
    for (const r of topRows) {
      const list = topByService.get(r.serviceType) ?? [];
      const u = userMap.get(r.userId);
      list.push({
        userId: r.userId,
        userName: u?.name || null,
        userPhone: u?.phone || '',
        userEmail: u?.email || null,
        callCount: Number(r.callCount),
      });
      topByService.set(r.serviceType, list);
    }

    return serviceRows.map((row) => ({
      serviceType: row.serviceType,
      serviceName: row.serviceName,
      provider: row.provider,
      totalCalls: Number(row.totalCalls),
      successfulCalls: Number(row.successfulCalls),
      failedCalls: Number(row.failedCalls),
      totalCreditsUsed: Number(row.totalCreditsUsed),
      userCount: Number(row.userCount),
      topUsers: topByService.get(row.serviceType) ?? [],
    }));
  }

  /**
   * 每日 00:15 把刚结束的「昨天」滚动落库。
   */
  @Cron('0 15 0 * * *')
  async handleDailyRollup() {
    if (this.rollupRunning) {
      this.logger.warn('跳过 API 用量日滚动：上一次任务尚未完成');
      return;
    }
    this.rollupRunning = true;
    try {
      const yesterday = new Date(this.localDayStart(new Date()));
      yesterday.setDate(yesterday.getDate() - 1);
      const rows = await this.rollupDay(yesterday);
      this.logger.log(`API 用量日滚动完成: day=${this.dayStr(yesterday)}, grainRows=${rows}`);
    } catch (error) {
      this.logger.error('API 用量日滚动失败:', error);
    } finally {
      this.rollupRunning = false;
    }
  }
}
