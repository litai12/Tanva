import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollabEnvelope, isPersistedEvent } from './types';

type RedisClient = any;

const STREAM_PREFIX = 'canvas:log:';
const SEQ_PREFIX = 'canvas:seq:';
const STREAM_MAXLEN = 500;

function streamKey(projectId: string): string {
  return `${STREAM_PREFIX}${projectId}`;
}

function seqKey(projectId: string): string {
  return `${SEQ_PREFIX}${projectId}`;
}

@Injectable()
export class CollabEventLog implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CollabEventLog.name);
  private client: RedisClient | undefined;
  private degraded = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      this.degraded = true;
      this.logger.warn('REDIS_URL not configured; event log disabled');
      return;
    }
    try {
      const IORedis = require('ioredis');
      this.client = new IORedis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
      this.client.on('error', (err: Error) => {
        if (!this.degraded) {
          this.logger.warn(`Redis log client error: ${err.message}; degrading`);
          this.degraded = true;
        }
      });
      this.client.on('ready', () => {
        if (this.degraded) {
          this.logger.log('Redis log recovered');
          this.degraded = false;
        }
      });
    } catch (err) {
      this.logger.warn(`ioredis init failed: ${(err as Error).message}`);
      this.degraded = true;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client?.quit();
    } catch {}
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  async nextSeq(projectId: string): Promise<number> {
    if (!this.client || this.degraded) {
      return Date.now();
    }
    try {
      const v = await this.client.incr(seqKey(projectId));
      return Number(v);
    } catch (err) {
      this.logger.warn(`INCR seq failed for ${projectId}: ${(err as Error).message}`);
      return Date.now();
    }
  }

  async append(projectId: string, envelope: CollabEnvelope): Promise<void> {
    if (!isPersistedEvent(envelope.type)) return;
    if (!this.client || this.degraded) return;
    try {
      await this.client.xadd(
        streamKey(projectId),
        'MAXLEN',
        '~',
        String(STREAM_MAXLEN),
        '*',
        'seq',
        String(envelope.seq ?? 0),
        'data',
        JSON.stringify(envelope),
      );
    } catch (err) {
      this.logger.warn(`XADD failed for ${projectId}: ${(err as Error).message}`);
    }
  }

  async readAfter(
    projectId: string,
    afterSeq: number,
    limit = 200,
  ): Promise<{ envelopes: CollabEnvelope[]; truncated: boolean }> {
    if (!this.client || this.degraded) return { envelopes: [], truncated: false };
    try {
      const rows: any[] = await this.client.xrange(
        streamKey(projectId),
        '-',
        '+',
        'COUNT',
        String(limit + 1),
      );
      const envelopes: CollabEnvelope[] = [];
      for (const row of rows) {
        const fields = row?.[1] as string[] | undefined;
        if (!fields) continue;
        const dataIdx = fields.indexOf('data');
        if (dataIdx < 0) continue;
        const raw = fields[dataIdx + 1];
        try {
          const env = JSON.parse(raw) as CollabEnvelope;
          if (typeof env.seq === 'number' && env.seq > afterSeq) {
            envelopes.push(env);
          }
        } catch {}
      }
      const truncated = envelopes.length > limit;
      return { envelopes: truncated ? envelopes.slice(0, limit) : envelopes, truncated };
    } catch (err) {
      this.logger.warn(`XRANGE failed for ${projectId}: ${(err as Error).message}`);
      return { envelopes: [], truncated: false };
    }
  }
}
