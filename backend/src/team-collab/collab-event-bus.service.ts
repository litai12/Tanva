import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollabEnvelope } from './types';

type RedisClient = any;
type Handler = (envelope: CollabEnvelope) => void;

const CANVAS_PREFIX = 'canvas:project:';

export function channelForProject(projectId: string): string {
  return `${CANVAS_PREFIX}${projectId}`;
}

export function channelForTeam(teamId: string): string {
  return `team:${teamId}`;
}

export function channelForUser(userId: string): string {
  return `user:${userId}`;
}

@Injectable()
export class CollabEventBus implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CollabEventBus.name);
  private publisher: RedisClient | undefined;
  private subscriber: RedisClient | undefined;
  /** Map<rawChannel, Set<handler>> — keyed by the full Redis channel name. */
  private readonly localHandlers = new Map<string, Set<Handler>>();
  private readonly subscribedChannels = new Set<string>();
  private degraded = false;
  private degradedSince = 0;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      this.logger.warn(
        'REDIS_URL not configured. CollabEventBus runs in degraded (in-process only) mode.',
      );
      this.degraded = true;
      this.degradedSince = Date.now();
      return;
    }
    try {
      const IORedis = require('ioredis');
      this.publisher = new IORedis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
      this.subscriber = new IORedis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
      this.subscriber.on('message', (channel: string, raw: string) => {
        const handlers = this.localHandlers.get(channel);
        if (!handlers || handlers.size === 0) return;
        let env: CollabEnvelope;
        try {
          env = JSON.parse(raw) as CollabEnvelope;
        } catch (err) {
          this.logger.warn(`bus: invalid JSON on ${channel}`);
          return;
        }
        for (const h of handlers) {
          try {
            h(env);
          } catch (err) {
            this.logger.warn(`bus handler error: ${(err as Error).message}`);
          }
        }
      });
      this.subscriber.on('error', (err: Error) => {
        if (!this.degraded) {
          this.logger.warn(`Redis subscriber error: ${err.message}; entering degraded mode`);
          this.degraded = true;
          this.degradedSince = Date.now();
        }
      });
      this.publisher.on('error', (err: Error) => {
        if (!this.degraded) {
          this.logger.warn(`Redis publisher error: ${err.message}; entering degraded mode`);
          this.degraded = true;
          this.degradedSince = Date.now();
        }
      });
      this.subscriber.on('ready', () => {
        if (this.degraded) {
          this.logger.log('Redis recovered; exiting degraded mode');
          this.degraded = false;
        }
      });
    } catch (err) {
      this.logger.warn(
        `Failed to init ioredis (${(err as Error).message}). Falling back to degraded mode.`,
      );
      this.degraded = true;
      this.degradedSince = Date.now();
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.subscriber?.quit();
    } catch {}
    try {
      await this.publisher?.quit();
    } catch {}
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  /** Publish to a canvas project channel (legacy convenience). */
  async publish(projectId: string, envelope: CollabEnvelope): Promise<void> {
    return this.publishTo(channelForProject(projectId), envelope);
  }

  /** Subscribe to a canvas project channel (legacy convenience). */
  async subscribe(projectId: string, handler: Handler): Promise<() => void> {
    return this.subscribeTo(channelForProject(projectId), handler);
  }

  /** Publish to an arbitrary Redis channel. */
  async publishTo(channel: string, envelope: CollabEnvelope): Promise<void> {
    const json = JSON.stringify(envelope);
    if (this.publisher && !this.degraded) {
      try {
        await this.publisher.publish(channel, json);
        return;
      } catch (err) {
        this.logger.warn(`publish failed for ${channel}: ${(err as Error).message}`);
        this.degraded = true;
        this.degradedSince = Date.now();
      }
    }
    // Degraded fallback: deliver to in-process handlers directly.
    const handlers = this.localHandlers.get(channel);
    if (!handlers) return;
    for (const h of handlers) {
      try {
        h(envelope);
      } catch (err) {
        this.logger.warn(`fallback handler error: ${(err as Error).message}`);
      }
    }
  }

  /** Subscribe to an arbitrary Redis channel. */
  async subscribeTo(channel: string, handler: Handler): Promise<() => void> {
    let set = this.localHandlers.get(channel);
    if (!set) {
      set = new Set();
      this.localHandlers.set(channel, set);
    }
    set.add(handler);
    if (this.subscriber && !this.subscribedChannels.has(channel)) {
      try {
        await this.subscriber.subscribe(channel);
        this.subscribedChannels.add(channel);
      } catch (err) {
        this.logger.warn(`subscribe failed for ${channel}: ${(err as Error).message}`);
      }
    }
    return () => this.unsubscribeFrom(channel, handler);
  }

  private unsubscribeFrom(channel: string, handler: Handler): void {
    const set = this.localHandlers.get(channel);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      this.localHandlers.delete(channel);
      if (this.subscriber && this.subscribedChannels.has(channel)) {
        this.subscriber.unsubscribe(channel).catch(() => undefined);
        this.subscribedChannels.delete(channel);
      }
    }
  }
}
