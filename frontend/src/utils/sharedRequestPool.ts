type SharedRequestPoolOptions = {
  maxConcurrent: number;
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
};

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type QueuedTask = {
  run: () => Promise<void>;
};

export class SharedRequestPool<T> {
  private readonly options: SharedRequestPoolOptions;
  private readonly cache = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly queue: QueuedTask[] = [];
  private activeCount = 0;

  constructor(options: SharedRequestPoolOptions) {
    if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
      throw new Error("maxConcurrent must be a positive integer");
    }
    if (!Number.isFinite(options.ttlMs) || options.ttlMs < 0) {
      throw new Error("ttlMs must be a non-negative number");
    }
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new Error("maxEntries must be a positive integer");
    }
    this.options = options;
  }

  request(key: string, factory: () => Promise<T>): Promise<T> {
    const now = this.getNow();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      return Promise.resolve(cached.value);
    }
    if (cached) this.cache.delete(key);

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const request = new Promise<T>((resolve, reject) => {
      this.queue.push({
        run: async () => {
          try {
            const value = await factory();
            this.remember(key, value);
            resolve(value);
          } catch (error) {
            reject(error);
          }
        },
      });
      this.pump();
    }).finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, request);
    return request;
  }

  private pump(): void {
    while (
      this.activeCount < this.options.maxConcurrent &&
      this.queue.length > 0
    ) {
      const task = this.queue.shift();
      if (!task) return;
      this.activeCount += 1;
      void task.run().finally(() => {
        this.activeCount -= 1;
        this.pump();
      });
    }
  }

  private remember(key: string, value: T): void {
    const now = this.getNow();
    for (const [cachedKey, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(cachedKey);
    }
    this.cache.delete(key);
    this.cache.set(key, {
      expiresAt: now + this.options.ttlMs,
      value,
    });
    while (this.cache.size > this.options.maxEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }

  private getNow(): number {
    return this.options.now?.() ?? Date.now();
  }
}
