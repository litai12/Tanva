import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ANOMALY_BASE_THRESHOLD = 2000;
const ANOMALY_RED_THRESHOLD = 5000;
const ANOMALY_PURPLE_THRESHOLD = 10000;

export type CreditAnomalySeverity = 'yellow' | 'red' | 'purple';

interface SourceBreakdownItem {
  sourceKey: string;
  sourceLabel: string;
  amount: number;
  count: number;
}

interface DailyAggregate {
  accountId: string;
  userId: string;
  totalAmount: number;
  maxSingleAmount: number;
  transactionCount: number;
  firstTransactionAt: Date;
  lastTransactionAt: Date;
  sourceMap: Map<string, SourceBreakdownItem>;
}

export interface CreditAnomalyRecordView {
  id: string;
  accountId: string;
  userId: string;
  dayStart: Date;
  dayLabel: string;
  totalAmount: number;
  maxSingleAmount: number;
  transactionCount: number;
  severity: CreditAnomalySeverity;
  sourceBreakdown: SourceBreakdownItem[];
  firstTransactionAt: Date;
  lastTransactionAt: Date;
  detectedAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    phone: string;
    email: string | null;
    name: string | null;
  };
}

@Injectable()
export class CreditsAnomalyService {
  private readonly logger = new Logger(CreditsAnomalyService.name);

  constructor(private readonly prisma: PrismaService) {}

  private getDayRange(date: Date): { start: Date; end: Date; dayLabel: string } {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const y = start.getFullYear();
    const m = `${start.getMonth() + 1}`.padStart(2, '0');
    const d = `${start.getDate()}`.padStart(2, '0');

    return {
      start,
      end,
      dayLabel: `${y}-${m}-${d}`,
    };
  }

  private resolveSeverity(totalAmount: number): CreditAnomalySeverity {
    if (totalAmount > ANOMALY_PURPLE_THRESHOLD) return 'purple';
    if (totalAmount > ANOMALY_RED_THRESHOLD) return 'red';
    return 'yellow';
  }

  private classifySource(type: string, description: string): { sourceKey: string; sourceLabel: string } {
    if (type === 'admin_adjust') {
      return { sourceKey: 'admin_adjust', sourceLabel: '后台调整' };
    }
    if (type === 'earn' && description === '充值') {
      return { sourceKey: 'recharge', sourceLabel: '充值到账' };
    }
    if (type === 'refund') {
      return { sourceKey: 'refund', sourceLabel: '失败退款' };
    }
    if (type === 'daily_reward' || type === 'CHECK_IN') {
      return { sourceKey: 'daily_reward', sourceLabel: '签到奖励' };
    }
    if (type === 'REFERRAL_REWARD') {
      return { sourceKey: 'referral_reward', sourceLabel: '邀请奖励' };
    }
    if (
      type === 'earn' &&
      (description === '新用户注册赠送积分' || description === '被邀请注册额外赠送积分')
    ) {
      return { sourceKey: 'new_user_bonus', sourceLabel: '新用户赠送' };
    }

    return {
      sourceKey: `other:${type}`,
      sourceLabel: `其他来源(${type})`,
    };
  }

  private parseSourceBreakdown(value: Prisma.JsonValue): SourceBreakdownItem[] {
    if (!Array.isArray(value)) return [];

    return value
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const raw = item as Record<string, unknown>;
        const sourceKey = typeof raw.sourceKey === 'string' ? raw.sourceKey : null;
        const sourceLabel = typeof raw.sourceLabel === 'string' ? raw.sourceLabel : null;
        const amount = typeof raw.amount === 'number' ? raw.amount : null;
        const count = typeof raw.count === 'number' ? raw.count : null;

        if (!sourceKey || !sourceLabel || amount === null || count === null) return null;

        return {
          sourceKey,
          sourceLabel,
          amount,
          count,
        };
      })
      .filter((item): item is SourceBreakdownItem => Boolean(item));
  }

  async detectDailyCreditAnomalies(date: Date = new Date()): Promise<{
    dayLabel: string;
    scannedTransactions: number;
    scannedUsers: number;
    upsertedRecords: number;
  }> {
    const { start, end, dayLabel } = this.getDayRange(date);

    const transactions = await this.prisma.creditTransaction.findMany({
      where: {
        amount: { gt: 0 },
        createdAt: {
          gte: start,
          lt: end,
        },
      },
      select: {
        accountId: true,
        type: true,
        amount: true,
        description: true,
        createdAt: true,
        account: {
          select: {
            userId: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (transactions.length === 0) {
      return {
        dayLabel,
        scannedTransactions: 0,
        scannedUsers: 0,
        upsertedRecords: 0,
      };
    }

    const aggregates = new Map<string, DailyAggregate>();

    for (const tx of transactions) {
      const key = tx.accountId;
      const source = this.classifySource(tx.type, tx.description);

      let aggregate = aggregates.get(key);
      if (!aggregate) {
        aggregate = {
          accountId: tx.accountId,
          userId: tx.account.userId,
          totalAmount: 0,
          maxSingleAmount: 0,
          transactionCount: 0,
          firstTransactionAt: tx.createdAt,
          lastTransactionAt: tx.createdAt,
          sourceMap: new Map<string, SourceBreakdownItem>(),
        };
        aggregates.set(key, aggregate);
      }

      aggregate.totalAmount += tx.amount;
      aggregate.transactionCount += 1;
      aggregate.maxSingleAmount = Math.max(aggregate.maxSingleAmount, tx.amount);

      if (tx.createdAt < aggregate.firstTransactionAt) {
        aggregate.firstTransactionAt = tx.createdAt;
      }
      if (tx.createdAt > aggregate.lastTransactionAt) {
        aggregate.lastTransactionAt = tx.createdAt;
      }

      const existingSource = aggregate.sourceMap.get(source.sourceKey);
      if (existingSource) {
        existingSource.amount += tx.amount;
        existingSource.count += 1;
      } else {
        aggregate.sourceMap.set(source.sourceKey, {
          sourceKey: source.sourceKey,
          sourceLabel: source.sourceLabel,
          amount: tx.amount,
          count: 1,
        });
      }
    }

    const anomalyAggregates = Array.from(aggregates.values()).filter(
      (item) => item.totalAmount > ANOMALY_BASE_THRESHOLD,
    );

    if (anomalyAggregates.length === 0) {
      return {
        dayLabel,
        scannedTransactions: transactions.length,
        scannedUsers: aggregates.size,
        upsertedRecords: 0,
      };
    }

    await this.prisma.$transaction(
      anomalyAggregates.map((item: DailyAggregate) => {
        const sourceBreakdown = Array.from(item.sourceMap.values()).sort((a, b) => b.amount - a.amount);
        const severity = this.resolveSeverity(item.totalAmount);

        return this.prisma.creditAnomalyRecord.upsert({
          where: {
            accountId_dayStart: {
              accountId: item.accountId,
              dayStart: start,
            },
          },
          create: {
            accountId: item.accountId,
            userId: item.userId,
            dayStart: start,
            dayLabel,
            totalAmount: item.totalAmount,
            maxSingleAmount: item.maxSingleAmount,
            transactionCount: item.transactionCount,
            sourceBreakdown: sourceBreakdown as unknown as Prisma.JsonArray,
            severity,
            firstTransactionAt: item.firstTransactionAt,
            lastTransactionAt: item.lastTransactionAt,
          },
          update: {
            userId: item.userId,
            dayLabel,
            totalAmount: item.totalAmount,
            maxSingleAmount: item.maxSingleAmount,
            transactionCount: item.transactionCount,
            sourceBreakdown: sourceBreakdown as unknown as Prisma.JsonArray,
            severity,
            firstTransactionAt: item.firstTransactionAt,
            lastTransactionAt: item.lastTransactionAt,
          },
        });
      }),
    );

    return {
      dayLabel,
      scannedTransactions: transactions.length,
      scannedUsers: aggregates.size,
      upsertedRecords: anomalyAggregates.length,
    };
  }

  async getCreditAnomalyRecords(options: {
    page?: number;
    pageSize?: number;
    search?: string;
    userId?: string;
    severity?: CreditAnomalySeverity;
    startDate?: Date;
    endDate?: Date;
  } = {}): Promise<{ records: CreditAnomalyRecordView[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const {
      page = 1,
      pageSize = 20,
      search,
      userId,
      severity,
      startDate,
      endDate,
    } = options;

    const now = new Date();
    const todayRange = this.getDayRange(now);
    const normalizedStartDate = startDate ?? todayRange.start;
    const normalizedEndDate = endDate ?? todayRange.end;

    try {
      await this.detectDailyCreditAnomalies(now);
    } catch (error) {
      this.logger.error(`积分异常检测执行失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    const where: Prisma.CreditAnomalyRecordWhereInput = {
      dayStart: {
        gte: normalizedStartDate,
        lt: normalizedEndDate,
      },
    };

    if (severity) {
      where.severity = severity;
    }

    if (userId) {
      where.userId = userId;
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

      const matchedUserIds = matchedUsers.map((user) => user.id);
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

      where.userId = { in: matchedUserIds };
    }

    const [records, total] = await Promise.all([
      this.prisma.creditAnomalyRecord.findMany({
        where,
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
        orderBy: [
          { dayStart: 'desc' },
          { totalAmount: 'desc' },
          { updatedAt: 'desc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.creditAnomalyRecord.count({ where }),
    ]);

    const normalizedRecords: CreditAnomalyRecordView[] = records.map((record: any) => ({
      id: record.id,
      accountId: record.accountId,
      userId: record.userId,
      dayStart: record.dayStart,
      dayLabel: record.dayLabel,
      totalAmount: record.totalAmount,
      maxSingleAmount: record.maxSingleAmount,
      transactionCount: record.transactionCount,
      severity: record.severity as CreditAnomalySeverity,
      sourceBreakdown: this.parseSourceBreakdown(record.sourceBreakdown),
      firstTransactionAt: record.firstTransactionAt,
      lastTransactionAt: record.lastTransactionAt,
      detectedAt: record.detectedAt,
      updatedAt: record.updatedAt,
      user: {
        id: record.user.id,
        phone: record.user.phone,
        email: record.user.email,
        name: record.user.name,
      },
    }));

    return {
      records: normalizedRecords,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }
}
