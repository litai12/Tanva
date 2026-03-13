import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Dot,
} from "recharts";
import {
  getHealthHistory,
  type HealthHistoryResult,
  type HealthDataPoint,
} from "@/services/adminApi";

// 每个 provider 对应的折线颜色
const PROVIDER_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6",
  "#ef4444", "#06b6d4", "#f97316", "#84cc16",
  "#ec4899", "#6366f1",
];

type TimeRange = "24h" | "7d" | "30d";

// ─── 自定义 Tooltip ───────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl text-xs max-w-xs">
      <p className="text-gray-400 mb-2">{label}</p>
      {payload.map((entry: any) => {
        const seriesKey = String(entry.dataKey).replace("latency_", "");
        const point: HealthDataPoint = entry.payload[`_raw_${seriesKey}`];
        const nodeLabel = entry.payload[`_label_${seriesKey}`] || entry.name || seriesKey;
        const isOffline = point?.status === "offline";
        return (
          <div key={entry.dataKey} className="mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
              <span className="text-gray-300 font-medium">{nodeLabel}</span>
              {isOffline ? (
                <span className="ml-auto text-red-400 font-semibold">Offline</span>
              ) : (
                <span className="ml-auto text-green-400">{entry.value != null ? `${entry.value} ms` : "-"}</span>
              )}
            </div>
            {isOffline && point?.errorDetail && (
              <p className="text-red-300 mt-0.5 pl-3.5 break-words">{point.errorDetail}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 自定义离线红点 ───────────────────────────────────────────
function OfflineDot(props: any) {
  const { cx, cy, payload, dataKey } = props;
  const seriesKey = String(dataKey).replace("latency_", "");
  const raw: HealthDataPoint = payload[`_raw_${seriesKey}`];
  if (!raw || raw.status !== "offline") return null;
  return (
    <circle
      cx={cx}
      cy={cy ?? 10}
      r={5}
      fill="#ef4444"
      stroke="#fff"
      strokeWidth={1.5}
    />
  );
}

// ─── 数据转换：把 series 转成 recharts 需要的扁平数组 ─────────
function buildChartData(history: HealthHistoryResult) {
  // 收集所有时间戳（取并集）
  const tsSet = new Set<string>();
  for (const s of history.series) {
    for (const p of s.points) tsSet.add(p.timestamp);
  }
  const timestamps = Array.from(tsSet).sort();

  return timestamps.map((ts) => {
    const row: Record<string, any> = { ts };
    for (const s of history.series) {
      const seriesKey = s.nodeKey || s.configId;
      const point = s.points.find((p) => p.timestamp === ts);
      // offline 时用 null 让折线断开，但把原始数据挂在 _raw_ 上供 Tooltip/Dot 读取
      row[`latency_${seriesKey}`] = point?.status === "offline" ? null : (point?.latencyMs ?? null);
      row[`_raw_${seriesKey}`] = point ?? null;
      row[`_label_${seriesKey}`] = s.label;
    }
    return row;
  });
}

function formatTs(ts: string, bucketMinutes: number) {
  const d = new Date(ts);
  if (bucketMinutes < 60) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  if (bucketMinutes < 1440) {
    return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

// ─── 主组件 ──────────────────────────────────────────────────
export function ApiHealthChart() {
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");
  const [history, setHistory] = useState<HealthHistoryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    getHealthHistory(timeRange)
      .then(setHistory)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [timeRange]);

  const chartData = history ? buildChartData(history) : [];
  const seriesRows = history?.series ?? [];
  const hasData = chartData.length > 0;

  return (
    <div className="bg-white rounded-lg border shadow-sm p-5 space-y-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">节点稳定性趋势</h3>
          <p className="text-xs text-gray-400 mt-0.5">响应延迟 (ms) · 红点表示离线，悬浮查看错误详情</p>
        </div>
        <div className="flex gap-1">
          {(["24h", "7d", "30d"] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`px-3 py-1 text-xs rounded font-medium transition border ${
                timeRange === r
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* 图表区域 */}
      <div className="h-64 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-10">
            <span className="text-xs text-gray-400">加载中...</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-red-400">{error}</span>
          </div>
        )}
        {!loading && !error && !hasData && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-gray-400">暂无历史数据，执行一次检测后将开始记录</span>
          </div>
        )}
        {hasData && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="ts"
                tickFormatter={(v) => formatTs(v, history!.bucketMinutes)}
                tick={{ fontSize: 10, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={{ stroke: "#e5e7eb" }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${v}ms`}
                width={52}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                formatter={(value) => (
                  <span className="text-xs text-gray-600">{String(value)}</span>
                )}
              />
              {seriesRows.map((series, idx) => {
                const seriesKey = series.nodeKey || series.configId;
                return (
                  <Line
                    key={seriesKey}
                    type="monotone"
                    dataKey={`latency_${seriesKey}`}
                    name={series.label}
                    stroke={PROVIDER_COLORS[idx % PROVIDER_COLORS.length]}
                    strokeWidth={1.5}
                    dot={<OfflineDot />}
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
