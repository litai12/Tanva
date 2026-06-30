import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { monitorEventLoopDelay, type IntervalHistogram } from 'perf_hooks';
import { readFileSync } from 'fs';
import * as os from 'os';
import * as v8 from 'v8';

/**
 * 系统监控采集器（驻留后台采样 + 快照缓存）
 *
 * 设计要点（见 2026-06-30 codex 评审）：
 * - 不在 HTTP 请求链路里实时采样（避免每次请求多 100ms、多管理员并发采样）。
 *   改为 onModuleInit 起一个定时器每 SAMPLE_INTERVAL_MS 采一次，接口只读最近快照。
 * - 保留约 10 分钟的趋势环形缓冲，OOM 排查靠趋势而非单点。
 * - 自建只读 BullMQ Queue('image-tasks') 仅查 getJobCounts，不消费/不改 job 状态；
 *   queue name + 默认 prefix('bull') 必须与生产侧一致，否则会读到空队列。
 * - 自建独立 ioredis 跑 INFO，OnModuleDestroy 关闭所有连接。
 */

const SAMPLE_INTERVAL_MS = 5_000;
const HISTORY_MAX_POINTS = 120; // 120 × 5s ≈ 10 分钟

// 与 worker / queue 侧保持一致的配置读取（仅展示，不改行为）
const IMAGE_TASK_MAX_CONCURRENT = Number(
  process.env.IMAGE_TASK_MAX_CONCURRENT ?? 200,
);
const QUEUE_HIGH_WATERMARK = Number(
  process.env.IMAGE_TASK_QUEUE_HIGH ?? 200_000_000,
);
const QUEUE_LOW_WATERMARK = Number(
  process.env.IMAGE_TASK_QUEUE_LOW ?? 100_000_000,
);
// PM2 max_memory_restart（ecosystem.config.js 固定 4096M），用于 RSS 占比预警。
const RSS_RESTART_LIMIT_BYTES =
  Number(process.env.PM2_MAX_MEMORY_RESTART_MB ?? 4096) * 1024 * 1024;

export interface SystemMonitorTrendPoint {
  t: number; // epoch ms
  rss: number;
  heapUsed: number;
  externalBytes: number; // external + arrayBuffers
  active: number; // 队列 active 数
  eventLoopP99Ms: number;
}

export interface SystemMonitorSnapshot {
  timestamp: number;
  warmingUp: boolean;
  process: {
    pid: number;
    nodeVersion: string;
    uptimeSec: number;
    cpuPercent: number; // 相对单核（可 >100% 若有 native 线程）
    memory: {
      rss: number;
      heapUsed: number;
      heapTotal: number;
      heapSizeLimit: number; // V8 堆上限（--max-old-space-size）
      totalAvailableSize: number;
      external: number;
      arrayBuffers: number;
      rssRestartLimit: number; // PM2 重启阈值
    };
    eventLoop: {
      p50Ms: number;
      p99Ms: number;
      maxMs: number;
    };
  };
  queue: {
    name: string;
    counts: {
      waiting: number;
      active: number;
      delayed: number;
      failed: number;
      completed: number;
      paused: number;
    };
    config: {
      maxConcurrent: number;
      highWatermark: number;
      lowWatermark: number;
    };
  };
  redis: {
    connected: boolean;
    usedMemory: number;
    usedMemoryRss: number;
    usedMemoryPeak: number;
    memFragmentationRatio: number;
    connectedClients: number;
    blockedClients: number;
    instantaneousOpsPerSec: number;
    keyspaceHits: number;
    keyspaceMisses: number;
    evictedKeys: number;
    expiredKeys: number;
    dbsize: number;
    uptimeSec: number;
    version: string;
  };
  os: {
    loadavg: number[];
    cpuCount: number;
    totalmem: number;
    freemem: number;
    cgroupMemoryLimit?: number;
    cgroupMemoryCurrent?: number;
  };
  history: SystemMonitorTrendPoint[];
}

@Injectable()
export class SystemMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemMonitorService.name);

  private queue: Queue | null = null;
  private redis: Redis | null = null;
  private eld: IntervalHistogram | null = null;
  private timer: NodeJS.Timeout | null = null;

  private lastCpu = process.cpuUsage();
  private lastHrtimeNs = process.hrtime.bigint();

  private snapshot: SystemMonitorSnapshot | null = null;
  private history: SystemMonitorTrendPoint[] = [];

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const url =
      this.config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379';

    try {
      // 只读 Queue：仅用于 getJobCounts，不绑定 worker / processor。
      this.queue = new Queue('image-tasks', { connection: { url } });
      // 独立连接跑 INFO；监控不应因 Redis 抖动而阻塞或刷错误日志风暴。
      this.redis = new Redis(url, {
        maxRetriesPerRequest: null,
        enableOfflineQueue: false,
        lazyConnect: false,
      });
      this.redis.on('error', () => {
        /* 静默：采样时按 connected:false 处理，避免日志风暴 */
      });
    } catch (err) {
      this.logger.error('监控采集器初始化连接失败', err as Error);
    }

    // 事件循环延迟直方图（低开销，常驻）
    this.eld = monitorEventLoopDelay({ resolution: 20 });
    this.eld.enable();

    // 立即采一次，随后周期采样
    await this.sample();
    this.timer = setInterval(() => {
      void this.sample();
    }, SAMPLE_INTERVAL_MS);
    // 不阻止进程退出
    this.timer.unref?.();

    this.logger.log(
      `系统监控采集器已启动 — 采样间隔 ${SAMPLE_INTERVAL_MS}ms，趋势保留 ${HISTORY_MAX_POINTS} 点`,
    );
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      this.eld?.disable();
    } catch {
      /* ignore */
    }
    try {
      await this.queue?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.redis?.quit();
    } catch {
      try {
        this.redis?.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  getSnapshot(): SystemMonitorSnapshot {
    if (this.snapshot) return this.snapshot;
    // 采样器尚未产出第一帧时的占位
    return {
      timestamp: Date.now(),
      warmingUp: true,
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        uptimeSec: Math.round(process.uptime()),
        cpuPercent: 0,
        memory: {
          rss: 0,
          heapUsed: 0,
          heapTotal: 0,
          heapSizeLimit: 0,
          totalAvailableSize: 0,
          external: 0,
          arrayBuffers: 0,
          rssRestartLimit: RSS_RESTART_LIMIT_BYTES,
        },
        eventLoop: { p50Ms: 0, p99Ms: 0, maxMs: 0 },
      },
      queue: {
        name: 'image-tasks',
        counts: {
          waiting: 0,
          active: 0,
          delayed: 0,
          failed: 0,
          completed: 0,
          paused: 0,
        },
        config: {
          maxConcurrent: IMAGE_TASK_MAX_CONCURRENT,
          highWatermark: QUEUE_HIGH_WATERMARK,
          lowWatermark: QUEUE_LOW_WATERMARK,
        },
      },
      redis: this.emptyRedis(),
      os: {
        loadavg: os.loadavg(),
        cpuCount: os.cpus().length,
        totalmem: os.totalmem(),
        freemem: os.freemem(),
      },
      history: [],
    };
  }

  // ── 采样 ─────────────────────────────────────────────────────────────────

  private async sample(): Promise<void> {
    try {
      const now = Date.now();

      // CPU%：相对上次采样窗口的 user+system 占用比例
      const cpuDelta = process.cpuUsage(this.lastCpu); // microseconds
      const hrNow = process.hrtime.bigint();
      const elapsedUs = Number(hrNow - this.lastHrtimeNs) / 1_000;
      this.lastCpu = process.cpuUsage();
      this.lastHrtimeNs = hrNow;
      const cpuPercent =
        elapsedUs > 0
          ? ((cpuDelta.user + cpuDelta.system) / elapsedUs) * 100
          : 0;

      // 内存 / V8 堆
      const mem = process.memoryUsage();
      const heap = v8.getHeapStatistics();

      // 事件循环延迟（纳秒 → 毫秒），读后 reset 让下个窗口独立
      const eld = this.eld;
      const eventLoop = {
        p50Ms: eld ? eld.percentile(50) / 1e6 : 0,
        p99Ms: eld ? eld.percentile(99) / 1e6 : 0,
        maxMs: eld ? eld.max / 1e6 : 0,
      };
      eld?.reset();

      // 队列计数（只读）
      let counts = {
        waiting: 0,
        active: 0,
        delayed: 0,
        failed: 0,
        completed: 0,
        paused: 0,
      };
      if (this.queue) {
        try {
          const c = await this.queue.getJobCounts(
            'waiting',
            'active',
            'delayed',
            'failed',
            'completed',
            'paused',
          );
          counts = {
            waiting: c.waiting ?? 0,
            active: c.active ?? 0,
            delayed: c.delayed ?? 0,
            failed: c.failed ?? 0,
            completed: c.completed ?? 0,
            paused: c.paused ?? 0,
          };
        } catch (err) {
          this.logger.debug(`队列计数读取失败: ${(err as Error).message}`);
        }
      }

      // Redis INFO
      const redis = await this.sampleRedis();

      // OS / cgroup
      const cgroup = this.readCgroupMemory();

      const snapshot: SystemMonitorSnapshot = {
        timestamp: now,
        warmingUp: false,
        process: {
          pid: process.pid,
          nodeVersion: process.version,
          uptimeSec: Math.round(process.uptime()),
          cpuPercent: Number(cpuPercent.toFixed(1)),
          memory: {
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            heapSizeLimit: heap.heap_size_limit,
            totalAvailableSize: heap.total_available_size,
            external: mem.external,
            arrayBuffers: (mem as any).arrayBuffers ?? 0,
            rssRestartLimit: RSS_RESTART_LIMIT_BYTES,
          },
          eventLoop: {
            p50Ms: Number(eventLoop.p50Ms.toFixed(2)),
            p99Ms: Number(eventLoop.p99Ms.toFixed(2)),
            maxMs: Number(eventLoop.maxMs.toFixed(2)),
          },
        },
        queue: {
          name: 'image-tasks',
          counts,
          config: {
            maxConcurrent: IMAGE_TASK_MAX_CONCURRENT,
            highWatermark: QUEUE_HIGH_WATERMARK,
            lowWatermark: QUEUE_LOW_WATERMARK,
          },
        },
        redis,
        os: {
          loadavg: os.loadavg(),
          cpuCount: os.cpus().length,
          totalmem: os.totalmem(),
          freemem: os.freemem(),
          cgroupMemoryLimit: cgroup.limit,
          cgroupMemoryCurrent: cgroup.current,
        },
        history: [],
      };

      // 追加趋势点
      this.history.push({
        t: now,
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        externalBytes: mem.external + ((mem as any).arrayBuffers ?? 0),
        active: counts.active,
        eventLoopP99Ms: snapshot.process.eventLoop.p99Ms,
      });
      if (this.history.length > HISTORY_MAX_POINTS) {
        this.history.splice(0, this.history.length - HISTORY_MAX_POINTS);
      }
      snapshot.history = this.history;
      this.snapshot = snapshot;
    } catch (err) {
      this.logger.warn(`系统监控采样失败: ${(err as Error).message}`);
    }
  }

  private async sampleRedis(): Promise<SystemMonitorSnapshot['redis']> {
    if (!this.redis || this.redis.status !== 'ready') {
      return this.emptyRedis();
    }
    try {
      const [info, dbsizeRaw] = await Promise.all([
        this.redis.info(),
        this.redis.dbsize().catch(() => 0),
      ]);
      const m = this.parseRedisInfo(info);
      const num = (k: string) => Number(m[k] ?? 0) || 0;
      return {
        connected: true,
        usedMemory: num('used_memory'),
        usedMemoryRss: num('used_memory_rss'),
        usedMemoryPeak: num('used_memory_peak'),
        memFragmentationRatio: num('mem_fragmentation_ratio'),
        connectedClients: num('connected_clients'),
        blockedClients: num('blocked_clients'),
        instantaneousOpsPerSec: num('instantaneous_ops_per_sec'),
        keyspaceHits: num('keyspace_hits'),
        keyspaceMisses: num('keyspace_misses'),
        evictedKeys: num('evicted_keys'),
        expiredKeys: num('expired_keys'),
        dbsize: Number(dbsizeRaw) || 0,
        uptimeSec: num('uptime_in_seconds'),
        version: m['redis_version'] ?? '',
      };
    } catch (err) {
      this.logger.debug(`Redis INFO 读取失败: ${(err as Error).message}`);
      return this.emptyRedis();
    }
  }

  private emptyRedis(): SystemMonitorSnapshot['redis'] {
    return {
      connected: false,
      usedMemory: 0,
      usedMemoryRss: 0,
      usedMemoryPeak: 0,
      memFragmentationRatio: 0,
      connectedClients: 0,
      blockedClients: 0,
      instantaneousOpsPerSec: 0,
      keyspaceHits: 0,
      keyspaceMisses: 0,
      evictedKeys: 0,
      expiredKeys: 0,
      dbsize: 0,
      uptimeSec: 0,
      version: '',
    };
  }

  private parseRedisInfo(info: string): Record<string, string> {
    const map: Record<string, string> = {};
    for (const line of info.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf(':');
      if (idx <= 0) continue;
      map[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
    }
    return map;
  }

  /** 容器内存限制（cgroup v2 优先，回退 v1）；非容器环境读不到则返回 undefined。 */
  private readCgroupMemory(): { limit?: number; current?: number } {
    const tryRead = (path: string): number | undefined => {
      try {
        const raw = readFileSync(path, 'utf8').trim();
        if (raw === 'max') return undefined;
        const n = Number(raw);
        // 部分系统未限制时为极大值，视为无限制
        if (!Number.isFinite(n) || n <= 0 || n > 1024 ** 5) return undefined;
        return n;
      } catch {
        return undefined;
      }
    };
    // cgroup v2
    const v2Limit = tryRead('/sys/fs/cgroup/memory.max');
    const v2Current = tryRead('/sys/fs/cgroup/memory.current');
    if (v2Limit !== undefined || v2Current !== undefined) {
      return { limit: v2Limit, current: v2Current };
    }
    // cgroup v1
    const v1Limit = tryRead('/sys/fs/cgroup/memory/memory.limit_in_bytes');
    const v1Current = tryRead('/sys/fs/cgroup/memory/memory.usage_in_bytes');
    return { limit: v1Limit, current: v1Current };
  }
}
