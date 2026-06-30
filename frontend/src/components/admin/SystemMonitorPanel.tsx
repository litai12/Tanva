import { useEffect, useRef, useState, useCallback } from "react";
import {
  getSystemMonitor,
  type SystemMonitorSnapshot,
  type SystemMonitorTrendPoint,
} from "@/services/adminApi";

const REFRESH_MS = 15_000;

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const v = bytes / 1024 ** i;
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("zh-CN").format(n);
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}秒`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}分钟`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时${m % 60}分`;
  const d = Math.floor(h / 24);
  return `${d}天${h % 24}小时`;
}

type Level = "ok" | "warning" | "critical";

const LEVEL_BAR: Record<Level, string> = {
  ok: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-red-500",
};
const LEVEL_TEXT: Record<Level, string> = {
  ok: "text-emerald-600",
  warning: "text-amber-600",
  critical: "text-red-600",
};

function levelByRatio(ratio: number): Level {
  if (ratio >= 0.9) return "critical";
  if (ratio >= 0.8) return "warning";
  return "ok";
}

function UsageBar({
  label,
  used,
  total,
  hint,
}: {
  label: string;
  used: number;
  total: number;
  hint?: string;
}) {
  const ratio = total > 0 ? used / total : 0;
  const level = levelByRatio(ratio);
  const pct = Math.min(100, Math.round(ratio * 100));
  return (
    <div className='bg-white rounded-lg border p-4 shadow-sm'>
      <div className='flex items-baseline justify-between'>
        <div className='text-sm text-gray-500'>{label}</div>
        <div className={`text-sm font-semibold ${LEVEL_TEXT[level]}`}>{pct}%</div>
      </div>
      <div className='mt-2 h-2 w-full rounded-full bg-gray-100 overflow-hidden'>
        <div
          className={`h-full rounded-full transition-all ${LEVEL_BAR[level]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className='mt-1.5 text-xs text-gray-400'>
        {formatBytes(used)} / {total > 0 ? formatBytes(total) : "—"}
        {hint ? ` · ${hint}` : ""}
      </div>
    </div>
  );
}

function MiniStat({
  title,
  value,
  subtitle,
  level,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  level?: Level;
}) {
  return (
    <div className='bg-white rounded-lg border p-3 shadow-sm'>
      <div className='text-xs text-gray-500'>{title}</div>
      <div
        className={`text-xl font-bold mt-0.5 ${level ? LEVEL_TEXT[level] : "text-gray-900"}`}
      >
        {value}
      </div>
      {subtitle && <div className='text-[11px] text-gray-400 mt-0.5'>{subtitle}</div>}
    </div>
  );
}

function Sparkline({
  points,
  pick,
  color,
  label,
  format,
}: {
  points: SystemMonitorTrendPoint[];
  pick: (p: SystemMonitorTrendPoint) => number;
  color: string;
  label: string;
  format: (n: number) => string;
}) {
  const W = 240;
  const H = 44;
  const values = points.map(pick);
  const last = values.length ? values[values.length - 1] : 0;
  const max = Math.max(1, ...values);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const n = values.length;
  const path =
    n > 1
      ? values
          .map((v, i) => {
            const x = (i / (n - 1)) * W;
            const y = H - ((v - min) / span) * H;
            return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ")
      : "";
  return (
    <div className='bg-white rounded-lg border p-3 shadow-sm'>
      <div className='flex items-baseline justify-between'>
        <div className='text-xs text-gray-500'>{label}</div>
        <div className='text-sm font-semibold text-gray-800'>{format(last)}</div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio='none'
        className='mt-2 w-full'
        style={{ height: H }}
      >
        {n > 1 ? (
          <>
            <path
              d={`${path} L${W},${H} L0,${H} Z`}
              fill={color}
              fillOpacity={0.1}
            />
            <path d={path} fill='none' stroke={color} strokeWidth={1.5} />
          </>
        ) : (
          <text x={4} y={H / 2} fontSize={10} fill='#9ca3af'>
            采集中…
          </text>
        )}
      </svg>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className='text-sm font-medium text-gray-700 mb-2 mt-1'>{children}</div>
  );
}

export default function SystemMonitorPanel() {
  const [snap, setSnap] = useState<SystemMonitorSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getSystemMonitor();
      setSnap(data);
      setError(null);
    } catch {
      setError("监控数据获取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    timerRef.current = setInterval(() => void load(), REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  if (loading && !snap) {
    return (
      <div className='bg-white rounded-lg border p-6 shadow-sm text-center text-gray-500'>
        系统监控加载中…
      </div>
    );
  }
  if (!snap) {
    return (
      <div className='bg-white rounded-lg border p-6 shadow-sm text-center text-red-500'>
        {error || "系统监控加载失败"}
      </div>
    );
  }

  const { process: proc, queue, redis, os, history } = snap;
  const mem = proc.memory;
  const heapRatio = mem.heapSizeLimit > 0 ? mem.heapUsed / mem.heapSizeLimit : 0;
  const activeRatio =
    queue.config.maxConcurrent > 0
      ? queue.counts.active / queue.config.maxConcurrent
      : 0;
  const cpuLevel: Level =
    proc.cpuPercent >= 90 ? "critical" : proc.cpuPercent >= 70 ? "warning" : "ok";
  const eldLevel: Level =
    proc.eventLoop.p99Ms >= 500
      ? "critical"
      : proc.eventLoop.p99Ms >= 100
        ? "warning"
        : "ok";
  const fragLevel: Level =
    redis.memFragmentationRatio >= 1.5
      ? "warning"
      : redis.memFragmentationRatio > 0 && redis.memFragmentationRatio < 1
        ? "warning"
        : "ok";
  const hitRate =
    redis.keyspaceHits + redis.keyspaceMisses > 0
      ? (redis.keyspaceHits / (redis.keyspaceHits + redis.keyspaceMisses)) * 100
      : null;

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between'>
        <div className='text-base font-semibold text-gray-800'>系统监控</div>
        <div className='text-xs text-gray-400'>
          每 15 秒刷新 · PID {proc.pid} · Node {proc.nodeVersion} · 运行{" "}
          {formatDuration(proc.uptimeSec)}
          {snap.warmingUp ? " · 采集预热中…" : ""}
          {error ? <span className='text-red-500'> · {error}</span> : ""}
        </div>
      </div>

      {/* 内存（OOM 排查重点） */}
      <SectionTitle>进程内存（V8 堆 OOM 排查重点）</SectionTitle>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
        <UsageBar
          label='V8 堆内存（heapUsed / 堆上限）'
          used={mem.heapUsed}
          total={mem.heapSizeLimit}
          hint={`heapTotal ${formatBytes(mem.heapTotal)}`}
        />
        <UsageBar
          label='进程 RSS（/ PM2 重启阈值）'
          used={mem.rss}
          total={mem.rssRestartLimit}
          hint='超阈值 PM2 会自动重启'
        />
      </div>
      <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
        <MiniStat title='external（堆外）' value={formatBytes(mem.external)} />
        <MiniStat title='arrayBuffers（二进制）' value={formatBytes(mem.arrayBuffers)} />
        <MiniStat
          title='RSS − heapTotal'
          value={formatBytes(Math.max(0, mem.rss - mem.heapTotal))}
          subtitle='native/堆外占用'
        />
        <MiniStat
          title='堆使用率'
          value={`${(heapRatio * 100).toFixed(1)}%`}
          level={levelByRatio(heapRatio)}
        />
      </div>

      {/* 趋势（约 10 分钟） */}
      <SectionTitle>趋势（约 10 分钟）</SectionTitle>
      <div className='grid grid-cols-1 md:grid-cols-3 gap-3'>
        <Sparkline
          points={history}
          pick={(p) => p.rss}
          color='#6366f1'
          label='RSS'
          format={formatBytes}
        />
        <Sparkline
          points={history}
          pick={(p) => p.heapUsed}
          color='#0ea5e9'
          label='heapUsed'
          format={formatBytes}
        />
        <Sparkline
          points={history}
          pick={(p) => p.externalBytes}
          color='#f59e0b'
          label='external + arrayBuffers'
          format={formatBytes}
        />
        <Sparkline
          points={history}
          pick={(p) => p.active}
          color='#10b981'
          label='队列并发 active'
          format={(n) => formatNumber(Math.round(n))}
        />
        <Sparkline
          points={history}
          pick={(p) => p.eventLoopP99Ms}
          color='#ef4444'
          label='事件循环延迟 P99 (ms)'
          format={(n) => `${n.toFixed(1)} ms`}
        />
      </div>

      {/* CPU / 系统 */}
      <SectionTitle>CPU 与系统负载</SectionTitle>
      <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
        <MiniStat
          title='进程 CPU'
          value={`${proc.cpuPercent.toFixed(1)}%`}
          subtitle={`相对单核 · 共 ${os.cpuCount} 核`}
          level={cpuLevel}
        />
        <MiniStat
          title='事件循环 P99'
          value={`${proc.eventLoop.p99Ms.toFixed(1)} ms`}
          subtitle={`P50 ${proc.eventLoop.p50Ms.toFixed(1)} · max ${proc.eventLoop.maxMs.toFixed(0)}`}
          level={eldLevel}
        />
        <MiniStat
          title='系统负载 (1/5/15m)'
          value={os.loadavg.map((n) => n.toFixed(2)).join(" / ")}
        />
        <MiniStat
          title='系统内存可用'
          value={formatBytes(os.freemem)}
          subtitle={`共 ${formatBytes(os.totalmem)}${
            os.cgroupMemoryLimit
              ? ` · cgroup ${formatBytes(os.cgroupMemoryLimit)}`
              : ""
          }`}
        />
      </div>

      {/* 任务队列 */}
      <SectionTitle>任务队列（{queue.name}）</SectionTitle>
      <div className='grid grid-cols-3 md:grid-cols-6 gap-3'>
        <MiniStat
          title='active（执行中）'
          value={formatNumber(queue.counts.active)}
          subtitle={`并发上限 ${queue.config.maxConcurrent}`}
          level={levelByRatio(activeRatio)}
        />
        <MiniStat title='waiting（等待）' value={formatNumber(queue.counts.waiting)} />
        <MiniStat title='delayed（延迟）' value={formatNumber(queue.counts.delayed)} />
        <MiniStat
          title='failed（失败）'
          value={formatNumber(queue.counts.failed)}
          level={queue.counts.failed > 0 ? "warning" : "ok"}
        />
        <MiniStat title='paused（暂停）' value={formatNumber(queue.counts.paused)} />
        <MiniStat
          title='completed（累计）'
          value={formatNumber(queue.counts.completed)}
        />
      </div>

      {/* Redis */}
      <SectionTitle>
        Redis 负载{" "}
        <span className={redis.connected ? "text-emerald-600" : "text-red-500"}>
          ● {redis.connected ? `已连接 ${redis.version}` : "未连接"}
        </span>
      </SectionTitle>
      <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
        <MiniStat
          title='已用内存'
          value={formatBytes(redis.usedMemory)}
          subtitle={`峰值 ${formatBytes(redis.usedMemoryPeak)} · RSS ${formatBytes(redis.usedMemoryRss)}`}
        />
        <MiniStat
          title='内存碎片率'
          value={redis.memFragmentationRatio.toFixed(2)}
          level={fragLevel}
        />
        <MiniStat
          title='ops/sec'
          value={formatNumber(redis.instantaneousOpsPerSec)}
        />
        <MiniStat
          title='客户端连接'
          value={formatNumber(redis.connectedClients)}
          subtitle={`阻塞 ${redis.blockedClients}`}
          level={redis.blockedClients > 0 ? "warning" : "ok"}
        />
        <MiniStat title='key 总数' value={formatNumber(redis.dbsize)} />
        <MiniStat
          title='命中率'
          value={hitRate === null ? "—" : `${hitRate.toFixed(1)}%`}
        />
        <MiniStat
          title='淘汰 / 过期 key'
          value={`${formatNumber(redis.evictedKeys)} / ${formatNumber(redis.expiredKeys)}`}
        />
        <MiniStat
          title='Redis 运行时长'
          value={redis.connected ? formatDuration(redis.uptimeSec) : "—"}
        />
      </div>
    </div>
  );
}
