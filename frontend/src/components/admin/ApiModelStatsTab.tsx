import { Fragment, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getApiUsageModelStats,
  type ApiUsageModelStats,
  type ApiUsageModelStatsResponse,
} from "@/services/adminApi";

type RangeKey = "today" | "yesterday" | "day" | "week" | "custom";

const MAX_LOOKBACK_DAYS = 15;

const inputClass =
  "h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500";

function getMinSelectableDate() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (MAX_LOOKBACK_DAYS - 1));
  return date;
}

function getDayRange(dateText: string) {
  const date = dateText ? new Date(`${dateText}T00:00:00`) : new Date();
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

function getWeekRange(dateText: string) {
  const date = dateText ? new Date(`${dateText}T00:00:00`) : new Date();
  const day = date.getDay() || 7;
  const start = new Date(date);
  start.setDate(start.getDate() - day + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

function formatNumber(value: number) {
  return value.toLocaleString("zh-CN");
}

function formatSuccessRate(stat: Pick<ApiUsageModelStats, "totalCalls" | "successfulCalls">) {
  return stat.totalCalls > 0
    ? `${((stat.successfulCalls / stat.totalCalls) * 100).toFixed(1)}%`
    : "0.0%";
}

export default function ApiModelStatsTab() {
  const [statsResponse, setStatsResponse] = useState<ApiUsageModelStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    range: "today" as RangeKey,
    day: new Date().toISOString().slice(0, 10),
    week: new Date().toISOString().slice(0, 10),
    startDate: "",
    endDate: "",
    modelNode: "",
  });

  const todayText = new Date().toISOString().slice(0, 10);
  const minDateText = getMinSelectableDate().toISOString().slice(0, 10);

  const statsParams = useMemo(() => {
    const params: {
      startDate?: string;
      endDate?: string;
      modelNode?: string;
    } = {};

    if (filters.range === "today") {
      Object.assign(params, getDayRange(new Date().toISOString().slice(0, 10)));
    } else if (filters.range === "yesterday") {
      const date = new Date();
      date.setDate(date.getDate() - 1);
      Object.assign(params, getDayRange(date.toISOString().slice(0, 10)));
    } else if (filters.range === "day") {
      Object.assign(params, getDayRange(filters.day));
    } else if (filters.range === "week") {
      Object.assign(params, getWeekRange(filters.week));
    } else if (filters.range === "custom") {
      if (filters.startDate) params.startDate = new Date(`${filters.startDate}T00:00:00`).toISOString();
      if (filters.endDate) {
        const end = new Date(`${filters.endDate}T00:00:00`);
        end.setDate(end.getDate() + 1);
        params.endDate = end.toISOString();
      }
    }

    const minStart = getMinSelectableDate();
    if (!params.startDate || new Date(params.startDate) < minStart) {
      params.startDate = minStart.toISOString();
    }

    if (filters.modelNode) params.modelNode = filters.modelNode;
    return params;
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    const loadStats = async () => {
      setLoading(true);
      try {
        const result = await getApiUsageModelStats(statsParams);
        if (!cancelled) setStatsResponse(result);
      } catch (error) {
        console.error("加载模型用量统计失败:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadStats();
    return () => {
      cancelled = true;
    };
  }, [statsParams]);

  const stats = statsResponse?.items || [];
  const summary = statsResponse?.summary;
  const modelNodes = statsResponse?.modelNodes || [];

  return (
    <div className='space-y-4'>
      <div className='rounded-lg border bg-white p-4'>
        <div className='flex flex-wrap items-end gap-3'>
          <div>
            <label className='mb-1 block text-xs text-gray-500'>时间范围</label>
            <select
              className={inputClass}
              value={filters.range}
              onChange={(event) =>
                setFilters((current) => ({ ...current, range: event.target.value as RangeKey }))
              }
            >
              <option value='today'>今日</option>
              <option value='yesterday'>昨日</option>
              <option value='day'>指定日期</option>
              <option value='week'>指定周</option>
              <option value='custom'>自定义</option>
            </select>
          </div>

          {filters.range === "day" && (
            <div>
              <label className='mb-1 block text-xs text-gray-500'>日期</label>
              <input
                className={inputClass}
                type='date'
                min={minDateText}
                max={todayText}
                value={filters.day}
                onChange={(event) => setFilters((current) => ({ ...current, day: event.target.value }))}
              />
            </div>
          )}

          {filters.range === "week" && (
            <div>
              <label className='mb-1 block text-xs text-gray-500'>周内任意日期</label>
              <input
                className={inputClass}
                type='date'
                min={minDateText}
                max={todayText}
                value={filters.week}
                onChange={(event) => setFilters((current) => ({ ...current, week: event.target.value }))}
              />
            </div>
          )}

          {filters.range === "custom" && (
            <>
              <div>
                <label className='mb-1 block text-xs text-gray-500'>开始日期</label>
                <input
                  className={inputClass}
                  type='date'
                  min={minDateText}
                  max={todayText}
                  value={filters.startDate}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, startDate: event.target.value }))
                  }
                />
              </div>
              <div>
                <label className='mb-1 block text-xs text-gray-500'>结束日期</label>
                <input
                  className={inputClass}
                  type='date'
                  min={minDateText}
                  max={todayText}
                  value={filters.endDate}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, endDate: event.target.value }))
                  }
                />
              </div>
            </>
          )}

          <div>
            <label className='mb-1 block text-xs text-gray-500'>模型节点</label>
            <select
              className={inputClass}
              value={filters.modelNode}
              onChange={(event) =>
                setFilters((current) => ({ ...current, modelNode: event.target.value }))
              }
            >
              <option value=''>全部模型</option>
              {modelNodes.map((node) => (
                <option key={node.key} value={node.key}>
                  {node.name}
                </option>
              ))}
            </select>
          </div>

        </div>

        {summary && (
          <div className='mt-4 grid grid-cols-2 gap-3 md:grid-cols-6'>
            <SummaryCell label='调用量' value={summary.totalCalls} />
            <SummaryCell label='成功' value={summary.successfulCalls} className='text-green-600' />
            <SummaryCell label='失败' value={summary.failedCalls} className='text-red-600' />
            <SummaryCell label='待完成' value={summary.pendingCalls} className='text-amber-600' />
            <SummaryCell label='消耗积分' value={summary.totalCreditsUsed} />
            <SummaryCell label='用户数' value={summary.uniqueUsers} />
          </div>
        )}
      </div>

      <div className='overflow-hidden rounded-lg border bg-white'>
        <div className='max-h-[1200px] overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-4 py-3 text-left'>模型节点</th>
                <th className='px-4 py-3 text-right'>调用量</th>
                <th className='px-4 py-3 text-right'>成功</th>
                <th className='px-4 py-3 text-right'>失败</th>
                <th className='px-4 py-3 text-right'>待完成</th>
                <th className='px-4 py-3 text-right'>成功率</th>
                <th className='px-4 py-3 text-right'>消耗积分</th>
                <th className='px-4 py-3 text-left'>Top10 用户</th>
                <th className='px-4 py-3 text-left'>明细</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className='px-4 py-8 text-center text-gray-500'>
                    加载中...
                  </td>
                </tr>
              ) : stats.length === 0 ? (
                <tr>
                  <td colSpan={9} className='px-4 py-8 text-center text-gray-500'>
                    暂无数据
                  </td>
                </tr>
              ) : (
                stats.map((stat) => (
                  <Fragment key={stat.modelNode}>
                    <tr className='border-t hover:bg-gray-50'>
                      <td className='px-4 py-3 align-top'>
                        <div className='font-semibold'>{stat.modelName}</div>
                      </td>
                      <td className='px-4 py-3 text-right align-top'>{formatNumber(stat.totalCalls)}</td>
                      <td className='px-4 py-3 text-right align-top text-green-600'>
                        {formatNumber(stat.successfulCalls)}
                      </td>
                      <td className='px-4 py-3 text-right align-top text-red-600'>
                        {formatNumber(stat.failedCalls)}
                      </td>
                      <td className='px-4 py-3 text-right align-top text-amber-600'>
                        {formatNumber(stat.pendingCalls)}
                      </td>
                      <td className='px-4 py-3 text-right align-top'>{formatSuccessRate(stat)}</td>
                      <td className='px-4 py-3 text-right align-top font-semibold'>
                        {formatNumber(stat.totalCreditsUsed)}
                      </td>
                      <td className='px-4 py-3 align-top'>
                        <div className='space-y-1'>
                          {stat.topUsers.slice(0, 3).map((user, index) => (
                            <div key={user.userId} className='text-xs'>
                              <span className='text-gray-400'>{index + 1}.</span>{" "}
                              <span className='font-medium'>
                                {user.userName || user.userPhone || user.userId}
                              </span>
                              <span className='ml-1 text-gray-500'>
                                {formatNumber(user.totalCreditsUsed)} 分
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className='px-4 py-3 align-top'>
                        <Button
                          variant='outline'
                          size='sm'
                          className='min-w-20'
                          onClick={() =>
                            setExpandedNode(expandedNode === stat.modelNode ? null : stat.modelNode)
                          }
                        >
                          {expandedNode === stat.modelNode ? "收起" : "展开"}
                        </Button>
                      </td>
                    </tr>
                    {expandedNode === stat.modelNode && <ModelDetailRows stat={stat} />}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  className = "",
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className='rounded-md bg-gray-50 p-3'>
      <div className='text-xs text-gray-500'>{label}</div>
      <div className={`mt-1 text-lg font-semibold ${className}`}>{formatNumber(value)}</div>
    </div>
  );
}

function ModelDetailRows({ stat }: { stat: ApiUsageModelStats }) {
  return (
    <tr className='border-t bg-gray-50/60'>
      <td colSpan={9} className='px-4 py-4'>
        <div className='grid gap-4 xl:grid-cols-2'>
          <div>
            <div className='mb-2 text-sm font-semibold'>Top10 用户（按消耗积分）</div>
            <div className='overflow-hidden rounded-md border bg-white'>
              <table className='w-full text-xs'>
                <thead className='bg-gray-50'>
                  <tr>
                    <th className='px-3 py-2 text-left'>排名</th>
                    <th className='px-3 py-2 text-left'>用户</th>
                    <th className='px-3 py-2 text-right'>调用</th>
                    <th className='px-3 py-2 text-right'>成功</th>
                    <th className='px-3 py-2 text-right'>失败</th>
                    <th className='px-3 py-2 text-right'>成功率</th>
                    <th className='px-3 py-2 text-right'>消耗积分</th>
                  </tr>
                </thead>
                <tbody>
                  {stat.topUsers.map((user, index) => (
                    <tr key={user.userId} className='border-t'>
                      <td className='px-3 py-2'>{index + 1}</td>
                      <td className='px-3 py-2'>
                        <div className='font-medium'>{user.userName || user.userPhone || user.userId}</div>
                        <div className='text-gray-400'>{user.userEmail || user.userId}</div>
                      </td>
                      <td className='px-3 py-2 text-right'>{formatNumber(user.callCount)}</td>
                      <td className='px-3 py-2 text-right text-green-600'>
                        {formatNumber(user.successfulCalls)}
                      </td>
                      <td className='px-3 py-2 text-right text-red-600'>{formatNumber(user.failedCalls)}</td>
                      <td className='px-3 py-2 text-right'>
                        {formatSuccessRate({
                          totalCalls: user.callCount,
                          successfulCalls: user.successfulCalls,
                        })}
                      </td>
                      <td className='px-3 py-2 text-right font-semibold'>
                        {formatNumber(user.totalCreditsUsed)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className='mb-2 text-sm font-semibold'>渠道明细</div>
            <div className='overflow-hidden rounded-md border bg-white'>
              <table className='w-full text-xs'>
                <thead className='bg-gray-50'>
                  <tr>
                    <th className='px-3 py-2 text-left'>渠道</th>
                    <th className='px-3 py-2 text-right'>调用</th>
                    <th className='px-3 py-2 text-right'>成功</th>
                    <th className='px-3 py-2 text-right'>失败</th>
                    <th className='px-3 py-2 text-right'>用户</th>
                    <th className='px-3 py-2 text-right'>消耗积分</th>
                  </tr>
                </thead>
                <tbody>
                  {stat.channels.map((channel) => (
                    <tr key={channel.channel} className='border-t'>
                      <td className='px-3 py-2 font-medium'>{channel.channel}</td>
                      <td className='px-3 py-2 text-right'>{formatNumber(channel.totalCalls)}</td>
                      <td className='px-3 py-2 text-right text-green-600'>
                        {formatNumber(channel.successfulCalls)}
                      </td>
                      <td className='px-3 py-2 text-right text-red-600'>
                        {formatNumber(channel.failedCalls)}
                      </td>
                      <td className='px-3 py-2 text-right'>{formatNumber(channel.userCount)}</td>
                      <td className='px-3 py-2 text-right font-semibold'>
                        {formatNumber(channel.totalCreditsUsed)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
