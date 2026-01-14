export type AsyncTask<T> = () => Promise<T>;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

const defer = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

export const createAsyncLimiter = (concurrency: number) => {
  const limit = Number.isFinite(concurrency) ? Math.max(1, concurrency) : 1;
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (activeCount >= limit) return;
    const run = queue.shift();
    if (!run) return;
    run();
  };

  const run = async <T>(task: AsyncTask<T>): Promise<T> => {
    const { promise, resolve, reject } = defer<T>();
    const start = () => {
      activeCount += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          activeCount -= 1;
          next();
        });
    };
    if (activeCount < limit) {
      start();
    } else {
      queue.push(start);
    }
    return promise;
  };

  const pendingCount = () => queue.length;
  const active = () => activeCount;

  return {
    run,
    active,
    pendingCount,
  };
};

export async function mapWithLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limiter = createAsyncLimiter(concurrency);
  const tasks = items.map((item, index) => limiter.run(() => mapper(item, index)));
  return Promise.all(tasks);
}

