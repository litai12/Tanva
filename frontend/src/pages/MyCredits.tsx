import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, TrendingDown, Activity, Zap, Calendar, RefreshCw, AlertTriangle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  claimDailyReward,
  getDailyRewardStatus,
  getExpiringCredits,
  getCheckInCalendar,
  getMyApiUsage,
  getMyCredits,
  getMyTransactions,
  type DailyRewardStatus,
  type ExpiringCreditsInfo,
  type CheckInCalendar,
  type UserCreditsInfo,
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

// 简单的线性图表组件
const SimpleLineChart: React.FC<{
  data: { date: string; value: number }[];
  color?: string;
  height?: number;
}> = ({ data, color = '#3b82f6', height = 120 }) => {
  if (data.length === 0) return <div className="py-8 text-xs text-center text-slate-400">暂无数据</div>;

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

// 服务类型中文映射
const SERVICE_TYPE_LABELS: Record<string, string> = {
  'gemini-3-pro-image': 'Gemini 3 Pro 生图',
  'gemini-2.5-image': 'Gemini 2.5 生图',
  'gemini-image-edit': '图像编辑',
  'gemini-image-blend': '图像融合',
  'gemini-image-analyze': '图像分析',
  'gemini-text': '文字对话',
  'gemini-paperjs': 'Paper.js 生成',
  'midjourney-imagine': 'Midjourney 生图',
  'midjourney-variation': 'Midjourney 变体',
  'background-removal': '背景移除',
  'expand-image': '图像扩展',
  'convert-2d-to-3d': '2D转3D',
  'sora-sd': 'Sora 普清视频',
  'sora-hd': 'Sora 高清视频',
};

const MyCredits: React.FC = () => {
  const navigate = useNavigate();
  const [credits, setCredits] = useState<UserCreditsInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [apiUsage, setApiUsage] = useState<ApiUsageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dailyRewardStatus, setDailyRewardStatus] = useState<DailyRewardStatus | null>(null);
  const [dailyRewardLoading, setDailyRewardLoading] = useState(false);
  const [dailyRewardClaiming, setDailyRewardClaiming] = useState(false);
  const [expiringCredits, setExpiringCredits] = useState<ExpiringCreditsInfo | null>(null);
  const [checkInCalendar, setCheckInCalendar] = useState<CheckInCalendar | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'usage'>('overview');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async (showLoading: boolean = true) => {
    if (showLoading) setLoading(true);
    try {
      const [creditsData, transactionsData, usageData, expiringData, calendarData] = await Promise.all([
        getMyCredits(),
        getMyTransactions({ pageSize: 100 }),
        // API 最多支持 100 条，超过会导致 400，进而使积分信息也拿不到
        getMyApiUsage({ pageSize: 100 }),
        getExpiringCredits(),
        getCheckInCalendar(),
      ]);
      setCredits(creditsData);
      setTransactions(transactionsData.transactions || []);
      setApiUsage(usageData.records || []);
      setExpiringCredits(expiringData);
      setCheckInCalendar(calendarData);
    } catch (error) {
      console.error('Failed to load credits data:', error);
    } finally {
      if (showLoading) setLoading(false);
    }

    setDailyRewardLoading(true);
    try {
      const status = await getDailyRewardStatus();
      setDailyRewardStatus(status);
    } catch (error) {
      console.warn('Failed to load daily reward status:', error);
    } finally {
      setDailyRewardLoading(false);
    }
  };

  const handleClaimDailyReward = async () => {
    if (dailyRewardClaiming) return;
    setDailyRewardClaiming(true);
    try {
      const result = await claimDailyReward();
      if (result.success) {
        alert('领取成功：已发放每日登录奖励');
      } else if (result.alreadyClaimed) {
        alert('今日奖励已领取');
      } else {
        alert('领取失败，请稍后重试');
      }
    } catch (error: any) {
      console.error('Failed to claim daily reward:', error);
      alert(error?.message || '领取失败，请稍后重试');
    } finally {
      setDailyRewardClaiming(false);
      loadData(false);
    }
  };

  // 计算每日消耗趋势（最近14天）
  const dailyUsageData = useMemo(() => {
    const days = 14;
    const now = new Date();
    const dailyMap = new Map<string, number>();

    // 初始化最近14天
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const key = `${date.getMonth() + 1}/${date.getDate()}`;
      dailyMap.set(key, 0);
    }

    // 统计消耗
    transactions
      .filter(t => t.type === 'spend')
      .forEach(t => {
        const date = new Date(t.createdAt);
        const key = `${date.getMonth() + 1}/${date.getDate()}`;
        if (dailyMap.has(key)) {
          dailyMap.set(key, (dailyMap.get(key) || 0) + Math.abs(t.amount));
        }
      });

    return Array.from(dailyMap.entries()).map(([date, value]) => ({ date, value }));
  }, [transactions]);

  // 按服务类型统计
  const usageByService = useMemo(() => {
    const serviceMap = new Map<string, { count: number; credits: number }>();

    apiUsage.forEach(record => {
      const key = record.serviceType;
      const existing = serviceMap.get(key) || { count: 0, credits: 0 };
      serviceMap.set(key, {
        count: existing.count + 1,
        credits: existing.credits + record.creditsUsed,
      });
    });

    return Array.from(serviceMap.entries())
      .map(([serviceType, stats]) => ({
        serviceType,
        serviceName: SERVICE_TYPE_LABELS[serviceType] || serviceType,
        ...stats,
      }))
      .sort((a, b) => b.credits - a.credits);
  }, [apiUsage]);

  // 今日消耗
  const todaySpent = useMemo(() => {
    const today = new Date().toDateString();
    return transactions
      .filter(t => t.type === 'spend' && new Date(t.createdAt).toDateString() === today)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [transactions]);

  // 最近7天消耗
  const weekSpent = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return transactions
      .filter(t => t.type === 'spend' && new Date(t.createdAt) >= weekAgo)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [transactions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="text-slate-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur-xl border-slate-200/60">
        <div className="flex items-center justify-between max-w-4xl px-4 py-4 mx-auto">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(-1)}
              className="p-0 rounded-full h-9 w-9"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-lg font-semibold text-slate-800">我的积分</h1>
          </div>
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

      <div className="max-w-4xl px-4 py-6 mx-auto space-y-6">
        {/* 积分概览卡片 */}
        <div className="p-6 text-white shadow-xl bg-gradient-to-br from-blue-500 to-indigo-600 rounded-3xl">
          <div className="flex items-start justify-between">
            <div>
              <div className="mb-1 text-sm text-blue-100 select-none">可用积分</div>
              <div className="text-5xl font-bold">{credits?.balance || 0}</div>
            </div>
            <div className="flex flex-col items-end gap-3">
              <div className="p-3 bg-white/20 rounded-2xl">
                <Zap className="w-8 h-8" />
              </div>
              <Button
                variant="outline"
                size="md"
                className={cn(
                  "h-9 px-4 rounded-full border-white/30 bg-white/15 text-white hover:bg-white/25",
                  dailyRewardStatus?.canClaim === false && "opacity-80"
                )}
                disabled={
                  dailyRewardLoading ||
                  dailyRewardClaiming ||
                  dailyRewardStatus?.canClaim === false
                }
                onClick={handleClaimDailyReward}
                title={dailyRewardStatus?.lastClaimAt ? `上次领取：${new Date(dailyRewardStatus.lastClaimAt).toLocaleString('zh-CN')}` : undefined}
              >
                {dailyRewardLoading
                  ? '加载中...'
                  : dailyRewardClaiming
                    ? '领取中...'
                    : dailyRewardStatus?.canClaim === false
                      ? '今日已领'
                      : '领取奖励'}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className="p-3 bg-white/10 rounded-xl">
              <div className="text-xs text-blue-100">累计获得</div>
              <div className="text-xl font-semibold">+{credits?.totalEarned || 0}</div>
            </div>
            <div className="p-3 bg-white/10 rounded-xl">
              <div className="text-xs text-blue-100">累计消耗</div>
              <div className="text-xl font-semibold">-{credits?.totalSpent || 0}</div>
            </div>
            <div className="p-3 bg-white/10 rounded-xl">
              <div className="text-xs text-blue-100">今日消耗</div>
              <div className="text-xl font-semibold">-{todaySpent}</div>
            </div>
          </div>
        </div>

        {/* 7天签到日历 */}
        {checkInCalendar && (
          <div className="p-5 bg-white shadow-sm rounded-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-slate-700">连续签到</h3>
              <span className="text-sm text-slate-500">
                已连续签到 {checkInCalendar.consecutiveDays} 天
              </span>
            </div>
            <div className="grid grid-cols-7 gap-2">
              {checkInCalendar.calendarDays.map((day) => (
                <div
                  key={day.day}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded-xl transition-all relative",
                    day.checked
                      ? day.day === 7 ? "bg-amber-100 border border-amber-300" : "bg-emerald-100 border border-emerald-300"
                      : day.isToday
                        ? "bg-blue-50 border-2 border-blue-400 border-dashed"
                        : day.missed
                          ? "bg-red-50 border border-red-200"
                          : day.day === 7 ? "bg-amber-50 border border-amber-200" : "bg-slate-50 border border-slate-200"
                  )}
                >
                  {day.day === 7 && (
                    <span className="absolute -top-1 -right-1 px-1 py-0.5 text-[10px] bg-amber-500 text-white rounded-full">
                      +500
                    </span>
                  )}
                  <span className={cn(
                    "text-xs font-medium",
                    day.checked
                      ? day.day === 7 ? "text-amber-700" : "text-emerald-700"
                      : day.isToday ? "text-blue-600"
                      : day.missed ? "text-red-400"
                      : day.day === 7 ? "text-amber-600" : "text-slate-400"
                  )}>
                    第{day.day}天
                  </span>
                  <div className={cn(
                    "w-6 h-6 mt-1 rounded-full flex items-center justify-center",
                    day.checked
                      ? day.day === 7 ? "bg-amber-500" : "bg-emerald-500"
                      : day.isToday
                        ? "bg-blue-100"
                        : day.missed
                          ? "bg-red-100"
                          : day.day === 7 ? "bg-amber-100" : "bg-slate-100"
                  )}>
                    {day.checked ? (
                      <Check className="w-4 h-4 text-white" />
                    ) : day.isToday ? (
                      <span className="text-xs text-blue-500">今</span>
                    ) : day.missed ? (
                      <span className="text-xs text-red-400">×</span>
                    ) : day.day === 7 ? (
                      <Zap className="w-3 h-3 text-amber-500" />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {!checkInCalendar.todayCheckedIn && (
              <div className="mt-4 text-center">
                <Button
                  size="sm"
                  className="px-6 text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600"
                  disabled={dailyRewardClaiming}
                  onClick={handleClaimDailyReward}
                >
                  {dailyRewardClaiming ? '签到中...' : '立即签到'}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* 过期积分提示 - 仅普通用户显示 */}
        {expiringCredits && !expiringCredits.isPaidUser && expiringCredits.totalExpiring > 0 && (
          <div className="flex items-start gap-3 p-4 border bg-amber-50 border-amber-200 rounded-2xl">
            <AlertTriangle className="flex-shrink-0 w-5 h-5 mt-0.5 text-amber-500" />
            <div className="flex-1">
              <div className="text-sm font-medium text-amber-800">
                您有 {expiringCredits.totalExpiring} 积分即将过期
              </div>
              <div className="mt-1 text-xs text-amber-600">
                签到获得的积分将在7天后过期，请尽快使用。充值成为付费用户后，签到积分将永久保留。
              </div>
              {expiringCredits.expiringDetails.length > 0 && (
                <div className="mt-2 space-y-1">
                  {expiringCredits.expiringDetails.slice(0, 3).map((detail, idx) => (
                    <div key={idx} className="text-xs text-amber-700">
                      {detail.amount} 积分将于 {new Date(detail.expiresAt).toLocaleDateString('zh-CN')} 过期
                    </div>
                  ))}
                  {expiringCredits.expiringDetails.length > 3 && (
                    <div className="text-xs text-amber-600">
                      还有 {expiringCredits.expiringDetails.length - 3} 笔即将过期...
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 付费用户标识 */}
        {expiringCredits?.isPaidUser && (
          <div className="flex items-center gap-2 p-3 border bg-emerald-50 border-emerald-200 rounded-xl">
            <Zap className="w-4 h-4 text-emerald-500" />
            <span className="text-sm text-emerald-700">付费用户 - 签到积分永久有效</span>
          </div>
        )}

        {/* Tab 切换 */}
        <div className="flex gap-2 bg-white rounded-2xl p-1.5 shadow-sm">
          {[
            { id: 'overview', label: '概览', icon: Activity },
            { id: 'transactions', label: '交易记录', icon: TrendingUp },
            { id: 'usage', label: 'API 使用', icon: Calendar },
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
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

        {/* 概览 Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* 消耗趋势图 */}
            <div className="p-5 bg-white shadow-sm rounded-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium text-slate-700">消耗趋势（最近14天）</h3>
                <div className="text-xs text-slate-500">最近7天消耗：{weekSpent} 积分</div>
              </div>
              <SimpleLineChart data={dailyUsageData} color="#3b82f6" height={140} />
            </div>

            {/* 服务使用统计 */}
            <div className="p-5 bg-white shadow-sm rounded-2xl">
              <h3 className="mb-4 font-medium text-slate-700">服务使用统计</h3>
              {usageByService.length === 0 ? (
                <div className="py-8 text-sm text-center text-slate-400">暂无使用记录</div>
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
                            {service.count} 次 / {service.credits} 积分
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

        {/* 交易记录 Tab */}
        {activeTab === 'transactions' && (
          <div className="overflow-hidden bg-white shadow-sm rounded-2xl">
            <div className="p-4 border-b border-slate-100">
              <h3 className="font-medium text-slate-700">交易记录</h3>
            </div>
            {transactions.length === 0 ? (
              <div className="py-12 text-sm text-center text-slate-400">暂无交易记录</div>
            ) : (
              <div className="max-h-[520px] overflow-y-auto divide-y divide-slate-100">
                {transactions.slice(0, 50).map(tx => {
                  const isPositive = tx.amount > 0;
                  return (
                    <div key={tx.id} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center",
                          isPositive ? "bg-green-100" : "bg-orange-100"
                        )}>
                          {isPositive ? (
                            <TrendingUp className="w-4 h-4 text-green-600" />
                          ) : (
                            <TrendingDown className="w-4 h-4 text-orange-600" />
                          )}
                        </div>
                        <div>
                          <div className="text-sm text-slate-700">{tx.description}</div>
                          <div className="text-xs text-slate-400">
                            {new Date(tx.createdAt).toLocaleString('zh-CN')}
                          </div>
                        </div>
                      </div>
                      <div className={cn(
                        "font-medium",
                        isPositive ? "text-green-600" : "text-orange-600"
                      )}>
                        {isPositive ? '+' : ''}{tx.amount}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* API 使用 Tab */}
        {activeTab === 'usage' && (
          <div className="overflow-hidden bg-white shadow-sm rounded-2xl">
            <div className="p-4 border-b border-slate-100">
              <h3 className="font-medium text-slate-700">API 调用记录</h3>
            </div>
            {apiUsage.length === 0 ? (
              <div className="py-12 text-sm text-center text-slate-400">暂无调用记录</div>
            ) : (
              <div className="max-h-[520px] overflow-y-auto divide-y divide-slate-100">
                {apiUsage.slice(0, 50).map(record => (
                  <div key={record.id} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-slate-700">
                        {SERVICE_TYPE_LABELS[record.serviceType] || record.serviceName}
                      </span>
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded-full",
                        record.responseStatus === 'success'
                          ? "bg-green-100 text-green-700"
                          : record.responseStatus === 'failed'
                          ? "bg-red-100 text-red-700"
                          : "bg-yellow-100 text-yellow-700"
                      )}>
                        {record.responseStatus === 'success' ? '成功' :
                         record.responseStatus === 'failed' ? '失败' : '处理中'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>{new Date(record.createdAt).toLocaleString('zh-CN')}</span>
                      {record.responseStatus === 'failed' ? (
                        <span className="text-green-600">已退还 {record.creditsUsed} 积分</span>
                      ) : (
                        <span className="text-orange-600">-{record.creditsUsed} 积分</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyCredits;
