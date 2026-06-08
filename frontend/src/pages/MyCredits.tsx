import React, { useState, useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown, Activity, RefreshCw, AlertTriangle, Crown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { formatCreditBillingRemark } from '@/utils/creditBillingRemark';
import {
  getExpiringCredits,
  getMyApiUsage,
  getMyCredits,
  getMembershipCurrent,
  getMyTransactions,
  getMembershipOrders,
  type ExpiringCreditsInfo,
  type MembershipCurrentResponse,
  type UserCreditsInfo,
  type MembershipOrderRecord,
  type PaymentStatus,
} from '@/services/adminApi';
import { cn } from '@/lib/utils';

interface Transaction {
  id: string;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
  businessType?: string | null;
  membershipPlanId?: string | null;
  apiUsageId?: string | null;
  serviceType?: string | null;
  channel?: string | null;
  provider?: string | null;
  model?: string | null;
  outputImageCount?: number | null;
  parallelGroupId?: string | null;
  parallelGroupIndex?: number | null;
  parallelGroupTotal?: number | null;
  billingRemark?: string | null;
  apiResponseStatus?: string | null;
  processingTime?: number | null;
  recordKind?: 'credit' | 'membershipOrder';
  paymentAmount?: number | null;
  paymentMethod?: string | null;
  paymentStatus?: PaymentStatus | null;
  orderNo?: string | null;
  planCode?: string | null;
  planName?: string | null;
}

interface ApiUsageRecord {
  id: string;
  serviceType: string;
  serviceName: string;
  provider: string;
  creditsUsed: number;
  responseStatus: string;
  createdAt: string;
}

const SimpleLineChart: React.FC<{
  data: { date: string; value: number }[];
  emptyText: string;
  color?: string;
  height?: number;
}> = ({ data, emptyText, color = '#3b82f6', height = 120 }) => {
  if (data.length === 0) {
    return <div className="py-8 text-xs text-center text-slate-400">{emptyText}</div>;
  }

  const maxValue = Math.max(...data.map(d => d.value), 1);
  const minValue = Math.min(...data.map(d => d.value), 0);
  const range = maxValue - minValue || 1;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1 || 1)) * 100;
    const y = 100 - ((d.value - minValue) / range) * 100;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="relative" style={{ height }}>
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2"
          points={points}
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          fill={`${color}20`}
          stroke="none"
          points={`0,100 ${points} 100,100`}
        />
      </svg>
      <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[10px] text-slate-400">
        {data.length > 0 && (
          <>
            <span>{data[0]?.date}</span>
            <span>{data[data.length - 1]?.date}</span>
          </>
        )}
      </div>
    </div>
  );
};

const MyCredits: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [credits, setCredits] = useState<UserCreditsInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [membershipOrders, setMembershipOrders] = useState<MembershipOrderRecord[]>([]);
  const [apiUsage, setApiUsage] = useState<ApiUsageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expiringCredits, setExpiringCredits] = useState<ExpiringCreditsInfo | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions'>('overview');
  const [membershipCurrent, setMembershipCurrent] = useState<MembershipCurrentResponse | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const handleRefreshCredits = () => {
      loadData(false);
    };

    window.addEventListener('refresh-credits', handleRefreshCredits);
    return () => {
      window.removeEventListener('refresh-credits', handleRefreshCredits);
    };
  }, []);

  const loadData = async (showLoading: boolean = true) => {
    if (showLoading) setLoading(true);
    try {
      const [creditsData, transactionsData, usageData, expiringData, membershipOrdersData] = await Promise.all([
        getMyCredits(),
        getMyTransactions({ pageSize: 100 }),
        getMyApiUsage({ pageSize: 100 }).catch((error) => {
          console.warn('Failed to load API overview stats:', error);
          return { records: [] as ApiUsageRecord[] };
        }),
        getExpiringCredits(),
        getMembershipOrders({ page: 1, pageSize: 100, includeRecharge: false }).catch((error) => {
          console.warn('Failed to load membership orders:', error);
          return { items: [] as MembershipOrderRecord[], page: 1, pageSize: 100, total: 0 };
        }),
      ]);
      setCredits(creditsData);
      setTransactions(transactionsData.transactions || []);
      setMembershipOrders(membershipOrdersData.items || []);
      setApiUsage(usageData.records || []);
      setExpiringCredits(expiringData);
      const membershipData = await getMembershipCurrent().catch((error) => {
        console.warn('Failed to load membership current:', error);
        return null;
      });
      setMembershipCurrent(membershipData);
    } catch (error) {
      console.error('Failed to load credits data:', error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const currentLocale = i18n.resolvedLanguage?.toLowerCase().startsWith('en')
    ? 'en-US'
    : 'zh-CN';

  const getTransactionStatusMeta = (
    status: string | null | undefined,
    hasApiUsage: boolean
  ): { label: string; className: string } | null => {
    let normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
    if (!normalized && hasApiUsage) {
      normalized = 'pending';
    }

    if (!normalized) return null;

    if (normalized === 'success') {
      return {
        label: t('creditsPage.usage.status.success'),
        className: 'bg-green-100 text-green-700 border border-green-200',
      };
    }

    if (normalized === 'failed') {
      return {
        label: t('creditsPage.usage.status.failed'),
        className: 'bg-red-100 text-red-700 border border-red-200',
      };
    }

    return {
      label: t('creditsPage.usage.status.pending'),
      className: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
    };
  };

  const getPaymentStatusMeta = (
    status: PaymentStatus | null | undefined
  ): { label: string; className: string } | null => {
    const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
    if (!normalized) return null;

    if (normalized === 'paid') {
      return {
        label: t('creditsPage.transactions.paymentStatus.paid'),
        className: 'bg-green-100 text-green-700 border border-green-200',
      };
    }

    if (normalized === 'pending') {
      return {
        label: t('creditsPage.transactions.paymentStatus.pending'),
        className: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
      };
    }

    if (normalized === 'failed') {
      return {
        label: t('creditsPage.transactions.paymentStatus.failed'),
        className: 'bg-red-100 text-red-700 border border-red-200',
      };
    }

    return {
      label: t(`creditsPage.transactions.paymentStatus.${normalized}`, {
        defaultValue: normalized,
      }),
      className: 'bg-slate-100 text-slate-600 border border-slate-200',
    };
  };

  const getPaymentMethodLabel = (method: string | null | undefined) => {
    const normalized = typeof method === 'string' ? method.trim().toLowerCase() : '';
    if (!normalized) return t('creditsPage.transactions.notAvailable');
    return t(`creditsPage.transactions.paymentMethods.${normalized}`, {
      defaultValue: method,
    });
  };

  const formatMoney = (value: number | null | undefined) => {
    const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return amount.toLocaleString(currentLocale, {
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    });
  };

  const filteredTransactions = useMemo(() => {
    const vip69Pattern = /vip[\s_-]*69/i;
    return transactions.filter((tx) => {
      const businessType = typeof tx.businessType === 'string' ? tx.businessType.trim().toLowerCase() : '';
      const normalizedDescription = (tx.description ?? '').trim();
      if (!normalizedDescription) {
        return true;
      }
      const isVip69DailyGift =
        (businessType === 'membership_daily_gift' || normalizedDescription.includes('每日赠送积分')) &&
        vip69Pattern.test(normalizedDescription);
      return !isVip69DailyGift;
    });
  }, [transactions]);

  const paidMembershipOrderRecords = useMemo<Transaction[]>(() => {
    return membershipOrders
      .filter((order) => order.orderType === 'membership' && order.status === 'paid')
      .map((order) => {
        const planName = (order.planName || order.planCode || '').trim() || t('creditsPage.transactions.membershipOrder');
        return {
          id: `membership-order:${order.orderId}`,
          type: 'membership_order',
          amount: 0,
          balanceBefore: 0,
          balanceAfter: 0,
          description: planName,
          createdAt: order.paidAt || order.createdAt,
          businessType: 'membership_order',
          recordKind: 'membershipOrder',
          paymentAmount: order.amount,
          paymentMethod: order.paymentMethod,
          paymentStatus: order.status,
          orderNo: order.orderNo,
          planCode: order.planCode,
          planName,
        };
      });
  }, [membershipOrders, t]);

  const combinedTransactions = useMemo(() => {
    return [
      ...filteredTransactions.map((tx) => ({ ...tx, recordKind: tx.recordKind ?? ('credit' as const) })),
      ...paidMembershipOrderRecords,
    ].sort((a, b) => {
      const aTime = Date.parse(a.createdAt);
      const bTime = Date.parse(b.createdAt);
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  }, [filteredTransactions, paidMembershipOrderRecords]);

  const displayTransactions = useMemo(() => {
    const MAX_AUTO_GROUP_COUNT = 8;
    const NO_AUTO_GROUP_SERVICE_TYPES = new Set(['gemini-text', 'gemini-prompt-optimize']);
    const normalizeOutputCount = (value: unknown): number => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) return 1;
      return Math.max(1, Math.floor(numeric));
    };
    const normalizeParallelExpectedTotal = (value: unknown): number | null => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 1) return null;
      return Math.max(2, Math.floor(numeric));
    };

    const grouped: Array<
      Transaction & { __groupKey: string; __groupTailTs: number }
    > = [];

    for (const tx of combinedTransactions) {
      const createdAtTs = Number.isFinite(Date.parse(tx.createdAt))
        ? Date.parse(tx.createdAt)
        : 0;
      const normalizedCount = normalizeOutputCount(tx.outputImageCount);
      const explicitParallelGroupId =
        typeof tx.parallelGroupId === 'string' ? tx.parallelGroupId.trim() : '';
      const normalizedServiceType =
        typeof tx.serviceType === 'string' ? tx.serviceType.trim().toLowerCase() : '';
      const shouldSkipAutoGroup = NO_AUTO_GROUP_SERVICE_TYPES.has(normalizedServiceType);
      const expectedParallelTotal =
        normalizeParallelExpectedTotal(tx.parallelGroupTotal) ?? MAX_AUTO_GROUP_COUNT;
      const groupKey = [
        explicitParallelGroupId ? `parallel:${explicitParallelGroupId}` : tx.type,
        (tx.description || '').trim(),
        tx.channel || '',
        tx.provider || '',
        tx.model || '',
        tx.billingRemark || '',
      ].join('||');

      const canAutoGroup =
        tx.amount < 0 &&
        !shouldSkipAutoGroup &&
        explicitParallelGroupId.length > 0;

      if (canAutoGroup && explicitParallelGroupId.length > 0) {
        const existed = grouped.find((item) => item.__groupKey === groupKey);
        const existedCount = existed ? normalizeOutputCount(existed.outputImageCount) : 1;
        if (existed && existedCount < expectedParallelTotal) {
          existed.amount += tx.amount;
          existed.balanceAfter = Math.min(existed.balanceAfter, tx.balanceAfter);
          existed.outputImageCount =
            normalizeOutputCount(existed.outputImageCount) + normalizedCount;
          existed.parallelGroupTotal = Math.max(
            normalizeOutputCount(existed.parallelGroupTotal),
            normalizeOutputCount(tx.parallelGroupTotal),
          );
          existed.__groupTailTs = Math.max(existed.__groupTailTs, createdAtTs || existed.__groupTailTs);
          existed.id = `${existed.id}|${tx.id}`;
          if (typeof tx.processingTime === 'number' && Number.isFinite(tx.processingTime)) {
            const current = Number(existed.processingTime);
            existed.processingTime =
              Number.isFinite(current) && current >= 0
                ? Math.max(current, tx.processingTime)
                : tx.processingTime;
          }
          continue;
        }
      }

      grouped.push({
        ...tx,
        outputImageCount: normalizedCount,
        __groupKey: groupKey,
        __groupTailTs: createdAtTs,
      });
    }

    return grouped.map(({ __groupTailTs, __groupKey, ...tx }) => tx);
  }, [combinedTransactions]);

  const dailyUsageData = useMemo(() => {
    const days = 14;
    const now = new Date();
    const dailyMap = new Map<string, { spend: number; refund: number }>();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const key = `${date.getMonth() + 1}/${date.getDate()}`;
      dailyMap.set(key, { spend: 0, refund: 0 });
    }

    transactions
      .filter(t => t.type === 'spend' || t.type === 'refund')
      .forEach(t => {
        const date = new Date(t.createdAt);
        const key = `${date.getMonth() + 1}/${date.getDate()}`;
        const existing = dailyMap.get(key);
        if (existing) {
          if (t.type === 'spend') {
            existing.spend += Math.abs(t.amount);
          } else if (t.type === 'refund') {
            existing.refund += Math.abs(t.amount);
          }
          dailyMap.set(key, existing);
        }
      });

    return Array.from(dailyMap.entries()).map(([date, value]) => ({
      date,
      value: Math.max(0, value.spend - value.refund),
    }));
  }, [transactions]);

  const usageByService = useMemo(() => {
    // 鎸?serviceName 鍒嗙粍锛堝悗绔凡鎸?Sora 妯″瀷鍖哄垎锛夛紝浠ユ纭睍绀?Sora 鏍囧噯鐗?vs Pro 鐗?
    const serviceMap = new Map<string, { count: number; credits: number }>();

    apiUsage.forEach(record => {
      const key = record.serviceName || record.serviceType;
      const existing = serviceMap.get(key) || { count: 0, credits: 0 };
      serviceMap.set(key, {
        count: existing.count + 1,
        credits: existing.credits + record.creditsUsed,
      });
    });

    return Array.from(serviceMap.entries())
      .map(([serviceName, stats]) => ({
        serviceType: serviceName,
        serviceName,
        ...stats,
      }))
      .sort((a, b) => b.credits - a.credits);
  }, [apiUsage]);

  // 浠婃棩娑堣€?
  const todaySpent = useMemo(() => {
    const today = new Date().toDateString();
    const todaySpend = transactions
      .filter(t => t.type === 'spend' && new Date(t.createdAt).toDateString() === today)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const todayRefund = transactions
      .filter(t => t.type === 'refund' && new Date(t.createdAt).toDateString() === today)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    return Math.max(0, todaySpend - todayRefund);
  }, [transactions]);

  const weekSpent = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekSpend = transactions
      .filter(t => t.type === 'spend' && new Date(t.createdAt) >= weekAgo)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const weekRefund = transactions
      .filter(t => t.type === 'refund' && new Date(t.createdAt) >= weekAgo)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    return Math.max(0, weekSpend - weekRefund);
  }, [transactions]);

  const latestGenerationTime = useMemo(() => {
    const latestSpendTx = transactions
      .filter(t => t.type === 'spend')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    return latestSpendTx?.createdAt ?? null;
  }, [transactions]);

  if (loading) {
    return (
        <div className="flex h-screen items-center justify-center overflow-y-auto bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="text-slate-500">{t('creditsPage.loading')}</div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur-xl border-slate-200/60">
        <div className="flex items-center justify-between max-w-4xl px-4 py-4 mx-auto">
          <div className="flex items-center">
            <h1 className="text-lg font-semibold text-slate-800">
              {t('creditsPage.title')}
            </h1>
          </div>
          <div className="flex items-center gap-1.5">
            <LanguageSwitcher style='simple' compact />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadData()}
              className="p-0 rounded-full h-9 w-9"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl px-4 py-5 mx-auto space-y-4">
        {/* 绉垎姒傝鍗＄墖 */}
        <div className="p-6 text-white shadow-xl bg-gradient-to-br from-blue-500 to-indigo-600 rounded-3xl">
          <div>
            <div className="mb-1 text-sm text-blue-100 select-none">
              {t('creditsPage.summary.available')}
            </div>
            <div className="text-5xl font-bold">{credits?.balance || 0}</div>
          </div>
          <div className="mt-4 text-xs text-blue-100/90 leading-relaxed">
            {membershipCurrent?.plan?.name ? (
              <span className="block sm:inline">当前：{membershipCurrent.plan.name}</span>
            ) : null}
            {membershipCurrent?.entitlement?.membershipStatus === 'active' &&
            membershipCurrent?.entitlement?.currentPeriodEndAt ? (
              <span className="block sm:mt-0 sm:inline sm:before:content-['路_'] sm:before:mx-1">
                会员到期：{new Date(membershipCurrent.entitlement.currentPeriodEndAt).toLocaleDateString(currentLocale)}
              </span>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className="p-3 bg-white/10 rounded-xl">
              <div className="text-xs text-blue-100">{t('creditsPage.summary.earned')}</div>
              <div className="text-xl font-semibold">+{credits?.totalEarned || 0}</div>
            </div>
            <div className="p-3 bg-white/10 rounded-xl">
              <div className="text-xs text-blue-100">{t('creditsPage.summary.spent')}</div>
              <div className="text-xl font-semibold">-{credits?.totalSpent || 0}</div>
            </div>
            <div className="p-3 bg-white/10 rounded-xl">
              <div className="text-xs text-blue-100">{t('creditsPage.summary.todaySpent')}</div>
              <div className="text-xl font-semibold">-{todaySpent}</div>
            </div>
          </div>
          <div className="mt-4 text-xs text-blue-100/90">
            {t('creditsPage.summary.latestGenerationTime')}?
            {latestGenerationTime
              ? ` ${new Date(latestGenerationTime).toLocaleString(currentLocale)}`
              : ` ${t('creditsPage.summary.noGenerationYet')}`}
          </div>
        </div>

        {/* 杩囨湡绉垎鎻愮ず - 浠呮櫘閫氱敤鎴锋樉绀?*/}
        {expiringCredits && !expiringCredits.isPaidUser && expiringCredits.totalExpiring > 0 && (
          <div className="flex items-start gap-3 p-4 border bg-amber-50 border-amber-200 rounded-2xl">
            <AlertTriangle className="flex-shrink-0 w-5 h-5 mt-0.5 text-amber-500" />
            <div className="flex-1">
              <div className="text-sm font-medium text-amber-800">
                {t('creditsPage.expiring.title', { total: expiringCredits.totalExpiring })}
              </div>
              <div className="mt-1 text-xs text-amber-600">
                {t('creditsPage.expiring.desc')}
              </div>
              {expiringCredits.expiringDetails.length > 0 && (
                <div className="mt-2 space-y-1">
                  {expiringCredits.expiringDetails.slice(0, 3).map((detail, idx) => (
                    <div key={idx} className="text-xs text-amber-700">
                      {t('creditsPage.expiring.detail', {
                        amount: detail.amount,
                        date: new Date(detail.expiresAt).toLocaleDateString(currentLocale),
                      })}
                    </div>
                  ))}
                  {expiringCredits.expiringDetails.length > 3 && (
                    <div className="text-xs text-amber-600">
                      {t('creditsPage.expiring.more', {
                        count: expiringCredits.expiringDetails.length - 3,
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-2 bg-white rounded-2xl p-1.5 shadow-sm">
          {[
            { id: 'overview', label: t('creditsPage.tabs.overview'), icon: Activity },
            { id: 'transactions', label: t('creditsPage.tabs.transactions'), icon: TrendingUp },
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as 'overview' | 'transactions')}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all",
                  activeTab === tab.id
                    ? "bg-gray-800 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="p-5 bg-white shadow-sm rounded-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium text-slate-700">{t('creditsPage.overview.trendTitle')}</h3>
                <div className="text-xs text-slate-500">
                  {t('creditsPage.overview.trendWeekSpent', { value: weekSpent })}
                </div>
              </div>
              <SimpleLineChart
                data={dailyUsageData}
                emptyText={t('creditsPage.chartNoData')}
                color="#3b82f6"
                height={140}
              />
            </div>

            <div className="p-5 bg-white shadow-sm rounded-2xl">
              <h3 className="mb-4 font-medium text-slate-700">{t('creditsPage.overview.serviceStatsTitle')}</h3>
              {usageByService.length === 0 ? (
                <div className="py-8 text-sm text-center text-slate-400">{t('creditsPage.overview.noUsage')}</div>
              ) : (
                <div className="space-y-3 max-h-[280px] overflow-y-auto">
                  {usageByService.map(service => {
                    const maxCredits = usageByService[0]?.credits || 1;
                    const percentage = (service.credits / maxCredits) * 100;
                    return (
                      <div key={service.serviceType}>
                        <div className="flex items-center justify-between mb-1 text-sm">
                          <span className="text-slate-600">{service.serviceName}</span>
                          <span className="text-slate-500">
                            {t('creditsPage.overview.usageItem', {
                              count: service.count,
                              credits: service.credits,
                            })}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full transition-all rounded-full bg-gradient-to-r from-blue-400 to-blue-600"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'transactions' && (
          <div className="overflow-hidden bg-white shadow-sm rounded-2xl">
            {displayTransactions.length === 0 ? (
              <div className="py-12 text-sm text-center text-slate-400">{t('creditsPage.transactions.empty')}</div>
            ) : (
              <div className="max-h-[560px] overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr className="text-xs font-medium text-slate-500">
                      <th className="px-4 py-3 text-left">{t('creditsPage.transactions.columns.item')}</th>
                      <th className="px-4 py-3 text-left">{t('creditsPage.transactions.columns.status')}</th>
                      <th className="px-4 py-3 text-right">{t('creditsPage.transactions.columns.amount')}</th>
                      <th className="px-4 py-3 text-right">{t('creditsPage.transactions.columns.remaining')}</th>
                      <th className="px-4 py-3 text-left">{t('creditsPage.transactions.columns.generatedAt')}</th>
                      <th className="px-4 py-3 text-left">{t('creditsPage.transactions.columns.duration')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayTransactions.slice(0, 50).map(tx => {
                      const isMembershipOrder = tx.recordKind === 'membershipOrder';
                      const isPositive = tx.amount > 0;
                      const durationSeconds = typeof tx.processingTime === 'number'
                        ? Math.max(0, Math.round(tx.processingTime / 1000))
                        : null;
                      const statusMeta = isMembershipOrder
                        ? getPaymentStatusMeta(tx.paymentStatus)
                        : getTransactionStatusMeta(tx.apiResponseStatus, Boolean(tx.apiUsageId));
                      const modelLabel = typeof tx.model === 'string' && tx.model.trim().length > 0
                        ? tx.model.trim()
                        : t('creditsPage.transactions.notAvailable');
                                            const routeLabel = tx.channel === 'tencent'
                        ? '尊享路线'
                        : tx.channel === 'apimart'
                        ? '普通路线'
                        : tx.channel === '147'
                        ? '官方路线'
                        : null;
                      const billingRemark = formatCreditBillingRemark(tx.billingRemark);
                      const outputCount =
                        typeof tx.outputImageCount === 'number' && Number.isFinite(tx.outputImageCount)
                          ? Math.max(1, Math.floor(tx.outputImageCount))
                          : null;
                      const countPrefix = tx.parallelGroupId ? '批次' : '触发数量';

                      return (
                        <tr key={tx.id} className="hover:bg-slate-50/60">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className={cn(
                                "w-7 h-7 rounded-full flex items-center justify-center",
                                isMembershipOrder ? "bg-violet-100" : isPositive ? "bg-green-100" : "bg-orange-100"
                              )}>
                                {isMembershipOrder ? (
                                  <Crown className="w-3.5 h-3.5 text-violet-600" />
                                ) : isPositive ? (
                                  <TrendingUp className="w-3.5 h-3.5 text-green-600" />
                                ) : (
                                  <TrendingDown className="w-3.5 h-3.5 text-orange-600" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium text-slate-700 truncate max-w-[240px]">{tx.description}</div>
                                {isMembershipOrder ? (
                                  <div className="mt-0.5 text-xs leading-4 text-slate-500 max-w-[280px] break-words">
                                    {t('creditsPage.transactions.membershipOrder')} 路 {getPaymentMethodLabel(tx.paymentMethod)}
                                    {tx.orderNo ? ` 路 ${tx.orderNo}` : ''}
                                  </div>
                                ) : (
                                  <div className="mt-0.5 text-xs leading-4 text-slate-500 max-w-[280px] break-words">
                                    {outputCount && outputCount > 1 ? `${countPrefix}：x${outputCount} · ` : ''}{routeLabel ? `渠道：${routeLabel} · ` : ''}{t('creditsPage.transactions.model', { model: modelLabel })}
                                  </div>
                                )}
                                {!isMembershipOrder && billingRemark && (
                                  <div className="mt-0.5 text-[11px] leading-4 text-slate-400 max-w-[280px] break-words">
                                    {billingRemark}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                            {statusMeta ? (
                              <span className={cn(
                                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                                statusMeta.className
                              )}>
                                {statusMeta.label}
                              </span>
                            ) : (
                              t('creditsPage.transactions.notAvailable')
                            )}
                          </td>
                          <td className={cn(
                            "px-4 py-3 text-right font-semibold",
                            isMembershipOrder ? "text-violet-600" : isPositive ? "text-green-600" : "text-orange-600"
                          )}>
                            {isMembershipOrder
                              ? `-楼${formatMoney(tx.paymentAmount)}`
                              : `${isPositive ? '+' : ''}${tx.amount}`}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-blue-600 whitespace-nowrap">
                            {isMembershipOrder ? t('creditsPage.transactions.notAvailable') : tx.balanceAfter}
                          </td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                            {new Date(tx.createdAt).toLocaleString(currentLocale)}
                          </td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                            {!isMembershipOrder && durationSeconds !== null
                              ? `${durationSeconds}${t('creditsPage.transactions.durationUnit')}`
                              : t('creditsPage.transactions.notAvailable')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
};

export default MyCredits;
