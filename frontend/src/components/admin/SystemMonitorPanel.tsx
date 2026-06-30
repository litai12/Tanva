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

/** 把快照整理成「可读摘要 + 原始 JSON」的诊断报告，便于粘贴排查。 */
function buildDiagnosticReport(snap: SystemMonitorSnapshot): string {
  const { process: p, queue: q, redis: r, os: o, tasks } = snap;
  const m = p.memory;
  const pct = (a: number, b: number) =>
    b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—";
  const L: string[] = [];
  L.push(`# Tanva 系统监控诊断快照`);
  L.push(
    `采集时间: ${new Date(snap.timestamp).toLocaleString("zh-CN", { hour12: false })}` +
      `  | PID ${p.pid} | Node ${p.nodeVersion} | 运行 ${formatDuration(p.uptimeSec)}` +
      (snap.warmingUp ? " | (预热中)" : ""),
  );
  L.push(``);
  L.push(`## 进程内存（V8 堆 OOM 重点）`);
  L.push(
    `heapUsed/堆上限: ${formatBytes(m.heapUsed)} / ${formatBytes(m.heapSizeLimit)} (${pct(m.heapUsed, m.heapSizeLimit)})`,
  );
  L.push(`heapTotal: ${formatBytes(m.heapTotal)}`);
  L.push(
    `RSS/重启阈值: ${formatBytes(m.rss)} / ${formatBytes(m.rssRestartLimit)} (${pct(m.rss, m.rssRestartLimit)})`,
  );
  L.push(`external: ${formatBytes(m.external)} | arrayBuffers: ${formatBytes(m.arrayBuffers)}`);
  L.push(`RSS−heapTotal(native/堆外): ${formatBytes(Math.max(0, m.rss - m.heapTotal))}`);
  L.push(``);
  L.push(`## CPU / 事件循环 / 系统`);
  L.push(`进程CPU: ${p.cpuPercent}% (相对单核, 共 ${o.cpuCount} 核)`);
  L.push(
    `事件循环延迟: P50 ${p.eventLoop.p50Ms}ms | P99 ${p.eventLoop.p99Ms}ms | max ${p.eventLoop.maxMs}ms`,
  );
  L.push(`系统负载(1/5/15m): ${o.loadavg.map((n) => n.toFixed(2)).join(" / ")}`);
  L.push(
    `系统内存: 可用 ${formatBytes(o.freemem)} / 共 ${formatBytes(o.totalmem)}` +
      (o.cgroupMemoryLimit ? ` | cgroup 限制 ${formatBytes(o.cgroupMemoryLimit)}` : ""),
  );
  L.push(``);
  L.push(`## 任务队列 (${q.name})`);
  L.push(
    `active ${q.counts.active}/${q.config.maxConcurrent} | waiting ${q.counts.waiting} | ` +
      `delayed ${q.counts.delayed} | failed ${q.counts.failed} | paused ${q.counts.paused} | completed ${q.counts.completed}`,
  );
  L.push(``);
  L.push(`## Redis`);
  if (r.connected) {
    L.push(`已连接 ${r.version} | 运行 ${formatDuration(r.uptimeSec)}`);
    L.push(
      `内存: 已用 ${formatBytes(r.usedMemory)} | 峰值 ${formatBytes(r.usedMemoryPeak)} | RSS ${formatBytes(r.usedMemoryRss)} | 碎片率 ${r.memFragmentationRatio}`,
    );
    L.push(
      `ops/sec ${r.instantaneousOpsPerSec} | 客户端 ${r.connectedClients}(阻塞 ${r.blockedClients}) | keys ${r.dbsize} | 淘汰/过期 ${r.evictedKeys}/${r.expiredKeys}`,
    );
  } else {
    L.push(`未连接 ⚠️`);
  }
  L.push(``);
  L.push(`## 任务积压 & 错误 Top10`);
  if (tasks) {
    L.push(
      `当前积压(排队+处理中): ${tasks.backlogTotal} | ` +
        `图片 排队${tasks.image.queued}/处理${tasks.image.processing} 近${tasks.windowHours}h成功${tasks.image.succeeded24h}/失败${tasks.image.failed24h} | ` +
        `视频 排队${tasks.video.queued}/处理${tasks.video.processing} 近${tasks.windowHours}h成功${tasks.video.succeeded24h}/失败${tasks.video.failed24h}`,
    );
    if (tasks.topErrors.length === 0) {
      L.push(`近 ${tasks.windowHours}h 无失败任务`);
    } else {
      tasks.topErrors.forEach((e, i) => {
        L.push(`${i + 1}. [${e.source === "image" ? "图片" : "视频"}] ×${e.count}  ${e.message}`);
      });
    }
  } else {
    L.push(`(采集中)`);
  }
  L.push(``);
  L.push(`## 原始快照 JSON`);
  L.push("```json");
  L.push(JSON.stringify(snap, null, 2));
  L.push("```");
  return L.join("\n");
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
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
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, [load]);

  const handleCopy = useCallback(async () => {
    if (!snap) return;
    const ok = await copyToClipboard(buildDiagnosticReport(snap));
    setCopyState(ok ? "ok" : "fail");
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyState("idle"), 2000);
  }, [snap]);

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

  const { process: proc, queue, redis, os, history, tasks } = snap;
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
      <div className='flex items-center justify-between gap-3'>
        <div className='text-base font-semibold text-gray-800'>系统监控</div>
        <div className='flex items-center gap-3'>
          <div className='text-xs text-gray-400 text-right'>
            每 15 秒刷新 · PID {proc.pid} · Node {proc.nodeVersion} · 运行{" "}
            {formatDuration(proc.uptimeSec)}
            {snap.warmingUp ? " · 采集预热中…" : ""}
            {error ? <span className='text-red-500'> · {error}</span> : ""}
          </div>
          <button
            type='button'
            onClick={() => void handleCopy()}
            title='复制当前快照（含队列/Redis/内存/任务积压/错误Top10 + 原始JSON），可直接粘贴给开发排查'
            className={`whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium transition ${
              copyState === "ok"
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : copyState === "fail"
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {copyState === "ok"
              ? "✓ 已复制"
              : copyState === "fail"
                ? "复制失败"
                : "📋 复制诊断快照"}
          </button>
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

      {/* 任务积压 & 错误 Top10 */}
      <SectionTitle>
        任务积压 &amp; 错误 Top {tasks ? tasks.topErrors.length || 10 : 10}
        {tasks ? (
          <span className='ml-2 font-normal text-gray-400'>
            近 {tasks.windowHours}h · {new Date(tasks.updatedAt).toLocaleTimeString("zh-CN", { hour12: false })} 采集
          </span>
        ) : null}
      </SectionTitle>
      {tasks ? (
        <>
          <div className='grid grid-cols-2 md:grid-cols-5 gap-3'>
            <MiniStat
              title='当前积压（排队+处理中）'
              value={formatNumber(tasks.backlogTotal)}
              subtitle='图片 + 视频'
              level={
                tasks.backlogTotal >= 500
                  ? "critical"
                  : tasks.backlogTotal >= 100
                    ? "warning"
                    : "ok"
              }
            />
            <MiniStat
              title='图片：排队 / 处理中'
              value={`${formatNumber(tasks.image.queued)} / ${formatNumber(tasks.image.processing)}`}
            />
            <MiniStat
              title='视频：排队 / 处理中'
              value={`${formatNumber(tasks.video.queued)} / ${formatNumber(tasks.video.processing)}`}
            />
            <MiniStat
              title={`图片 ${tasks.windowHours}h：成功 / 失败`}
              value={`${formatNumber(tasks.image.succeeded24h)} / ${formatNumber(tasks.image.failed24h)}`}
              level={tasks.image.failed24h > 0 ? "warning" : "ok"}
            />
            <MiniStat
              title={`视频 ${tasks.windowHours}h：成功 / 失败`}
              value={`${formatNumber(tasks.video.succeeded24h)} / ${formatNumber(tasks.video.failed24h)}`}
              level={tasks.video.failed24h > 0 ? "warning" : "ok"}
            />
          </div>
          <div className='bg-white rounded-lg border shadow-sm overflow-hidden'>
            <div className='px-4 py-2 text-xs font-medium text-gray-600 border-b bg-gray-50'>
              失败错误 Top {tasks.topErrors.length}（近 {tasks.windowHours} 小时）
            </div>
            {tasks.topErrors.length === 0 ? (
              <div className='px-4 py-4 text-sm text-gray-400'>近期无失败任务 🎉</div>
            ) : (
              <table className='w-full text-sm'>
                <thead>
                  <tr className='text-left text-xs text-gray-400 border-b'>
                    <th className='px-4 py-2 w-12'>#</th>
                    <th className='px-4 py-2 w-16'>来源</th>
                    <th className='px-4 py-2 w-20 text-right'>次数</th>
                    <th className='px-4 py-2'>错误信息</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.topErrors.map((e, i) => (
                    <tr key={i} className='border-b last:border-0 align-top'>
                      <td className='px-4 py-2 text-gray-400'>{i + 1}</td>
                      <td className='px-4 py-2'>
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-[11px] ${
                            e.source === "image"
                              ? "bg-sky-100 text-sky-700"
                              : "bg-violet-100 text-violet-700"
                          }`}
                        >
                          {e.source === "image" ? "图片" : "视频"}
                        </span>
                      </td>
                      <td className='px-4 py-2 text-right font-semibold text-red-600'>
                        {formatNumber(e.count)}
                      </td>
                      <td className='px-4 py-2 text-gray-700 break-all'>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className='bg-white rounded-lg border p-4 shadow-sm text-sm text-gray-400'>
          任务统计采集中…（每 30 秒刷新）
        </div>
      )}

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
