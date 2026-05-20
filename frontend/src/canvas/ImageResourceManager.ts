// frontend/src/canvas/ImageResourceManager.ts
//
// Optimizations vs naive new Image() approach:
//   1. LRU cache (128 MB cap) — HTMLImageElement instances reused across nodes
//   2. Request dedup — concurrent acquire() for same URL share one in-flight load
//   3. AbortController — load cancelled automatically when last owner releases before completion
//   4. Concurrency limiter (MAX_CONCURRENT=6) — prevents browser from queuing dozens of
//      parallel requests, keeps bandwidth focused on visible images
//   5. Viewport-aware deferral — non-critical loads wait until pan/zoom stops
//   6. img.decode() — pixel decode happens off the main thread (browser ImageDecoder),
//      no jank when image first paints; better than onload for canvas use

export type LoadPriority = 'critical' | 'visible' | 'prefetch'

interface CachedEntry {
  htmlImage: HTMLImageElement
  url: string
  owners: Set<string>
  sizeBytes: number
  lastAccessAt: number
}

interface PendingEntry {
  promise: Promise<HTMLImageElement>
  pendingOwners: Set<string>
  abortController: AbortController
}

interface DeferredLoad {
  url: string
  ownerId: string
  priority: LoadPriority
  resolve: (img: HTMLImageElement) => void
  reject: (err: unknown) => void
}

// Adaptive cache cap: 25 % of reported device memory, clamped [64 MB, 256 MB].
// navigator.deviceMemory is in GB (powers-of-two approximation); defaults to 4 GB.
const MAX_BYTES = (() => {
  const gb = typeof navigator !== 'undefined'
    ? ((navigator as { deviceMemory?: number }).deviceMemory ?? 4)
    : 4
  return Math.max(64, Math.min(256, gb * 1024 * 0.25)) * 1024 * 1024
})()
const MAX_CONCURRENT = 6

const scheduleIdle = (cb: IdleRequestCallback, opts?: IdleRequestOptions): number =>
  typeof requestIdleCallback !== 'undefined'
    ? requestIdleCallback(cb, opts)
    : (setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0) as unknown as number)

class ImageResourceManager {
  private static _instance: ImageResourceManager | null = null

  private cache = new Map<string, CachedEntry>()
  private pending = new Map<string, PendingEntry>()
  private deferred: DeferredLoad[] = []
  private isViewportMoving = false
  private totalBytes = 0

  private activeCount = 0
  private waitQueue: Array<() => void> = []

  private constructor() {}

  static getInstance(): ImageResourceManager {
    if (!ImageResourceManager._instance) {
      ImageResourceManager._instance = new ImageResourceManager()
    }
    return ImageResourceManager._instance
  }

  async acquire(
    url: string,
    priority: LoadPriority,
    ownerId: string
  ): Promise<HTMLImageElement> {
    const cached = this.cache.get(url)
    if (cached) {
      cached.owners.add(ownerId)
      cached.lastAccessAt = Date.now()
      return cached.htmlImage
    }

    if (this.isViewportMoving && priority !== 'critical') {
      return new Promise<HTMLImageElement>((resolve, reject) => {
        this.deferred.push({ url, ownerId, priority, resolve, reject })
      })
    }

    return this.load(url, ownerId)
  }

  /** 释放 owner 对 url 的引用。若图片仍在加载且已无 owner，立即取消请求。 */
  release(url: string, ownerId: string): void {
    const cached = this.cache.get(url)
    if (cached) {
      cached.owners.delete(ownerId)
      return
    }

    const pending = this.pending.get(url)
    if (pending) {
      pending.pendingOwners.delete(ownerId)
      if (pending.pendingOwners.size === 0) {
        pending.abortController.abort()
        this.pending.delete(url)
      }
      return
    }

    // 还在延迟队列里（视口移动期间尚未触发加载）
    this.deferred = this.deferred.filter(
      (d) => !(d.url === url && d.ownerId === ownerId)
    )
  }

  /** 缩放/平移开始时传 true，结束时传 false。 */
  setViewportMoving(v: boolean): void {
    this.isViewportMoving = v
    if (!v) this.flushDeferred()
  }

  private async load(url: string, ownerId: string): Promise<HTMLImageElement> {
    // 同 URL 的并发请求合并到同一个 in-flight promise
    const inflight = this.pending.get(url)
    if (inflight) {
      inflight.pendingOwners.add(ownerId)
      const img = await inflight.promise
      // 加载完成后补充 owner（以防缓存条目已创建）
      this.cache.get(url)?.owners.add(ownerId)
      return img
    }

    const abortController = new AbortController()

    // 用 definite assignment 避免 null 初始化 trick
    let pendingEntry!: PendingEntry

    const promise = this.withConcurrencyLimit(() =>
      this.fetchAndDecode(url, abortController.signal)
    )
      .then((img) => {
        const sizeBytes = img.naturalWidth * img.naturalHeight * 4
        this.cache.set(url, {
          htmlImage: img,
          url,
          owners: new Set(pendingEntry.pendingOwners),
          sizeBytes,
          lastAccessAt: Date.now(),
        })
        this.totalBytes += sizeBytes
        this.pending.delete(url)
        this.evictLRU()
        return img
      })
      .catch((err: unknown) => {
        this.pending.delete(url)
        throw err
      })

    pendingEntry = { promise, pendingOwners: new Set([ownerId]), abortController }
    this.pending.set(url, pendingEntry)
    return promise
  }

  /** 并发限制：同时下载数不超过 MAX_CONCURRENT，多余请求排队等待。 */
  private async withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= MAX_CONCURRENT) {
      await new Promise<void>((resolve) => this.waitQueue.push(resolve))
    }
    this.activeCount++
    try {
      return await fn()
    } finally {
      this.activeCount--
      this.waitQueue.shift()?.()
    }
  }

  /**
   * 通过 fetch() + img.decode() 加载图片。
   *
   * fetch() 提供 AbortController 支持；img.decode() 将像素解码推到浏览器的
   * ImageDecoder 线程（Chrome/Safari 均在非主线程完成），主线程无阻塞。
   * 相比 img.onload 方案，首次绘制时不会出现主线程解码卡顿。
   *
   * 若 fetch 因 CORS 失败，降级到 img.src 直接加载（<img> 走 no-cors 路径）。
   */
  private async fetchAndDecode(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return this.decodeViaImg(url, signal)
    }

    try {
      const res = await fetch(url, { signal, credentials: 'same-origin' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

      const objectUrl = URL.createObjectURL(blob)
      try {
        return await this.decodeViaImg(objectUrl, signal)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') throw err
      // 降级：CORS 受限但 <img> 可以直接加载的场景
      return this.decodeViaImg(url, signal)
    }
  }

  private decodeViaImg(src: string, signal: AbortSignal): Promise<HTMLImageElement> {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      const img = new Image()
      if (!src.startsWith('data:') && !src.startsWith('blob:')) {
        img.crossOrigin = 'anonymous'
      }
      const onAbort = () => {
        img.src = ''
        reject(new DOMException('Aborted', 'AbortError'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      img.src = src
      void img.decode().then(
        () => {
          signal.removeEventListener('abort', onAbort)
          resolve(img)
        },
        (decodeErr: unknown) => {
          signal.removeEventListener('abort', onAbort)
          reject(
            signal.aborted
              ? new DOMException('Aborted', 'AbortError')
              : new Error(`ImageResourceManager: decode failed for ${src}: ${String(decodeErr)}`)
          )
        }
      )
    })
  }

  private flushDeferred(): void {
    const queue = this.deferred.splice(0)
    for (const item of queue) {
      if (item.priority === 'prefetch') {
        // prefetch 级别：让浏览器空闲时再开始，不抢占首帧渲染
        scheduleIdle(() => {
          this.acquire(item.url, item.priority, item.ownerId)
            .then(item.resolve)
            .catch(item.reject)
        }, { timeout: 2000 })
      } else {
        // visible / critical：视口停止后立即开始
        this.acquire(item.url, item.priority, item.ownerId)
          .then(item.resolve)
          .catch(item.reject)
      }
    }
  }

  private evictLRU(): void {
    if (this.totalBytes <= MAX_BYTES) return
    const candidates = Array.from(this.cache.values())
      .filter((e) => e.owners.size === 0)
      .sort((a, b) => a.lastAccessAt - b.lastAccessAt)
    for (const entry of candidates) {
      if (this.totalBytes <= MAX_BYTES) break
      this.totalBytes -= entry.sizeBytes
      this.cache.delete(entry.url)
    }
  }
}

export { ImageResourceManager }
