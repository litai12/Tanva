// frontend/src/canvas/ImageResourceManager.ts

export type LoadPriority = 'critical' | 'visible' | 'prefetch'

interface CachedEntry {
  htmlImage: HTMLImageElement
  url: string
  owners: Set<string>
  sizeBytes: number
  lastAccessAt: number
}

interface DeferredLoad {
  url: string
  ownerId: string
  resolve: (img: HTMLImageElement) => void
  reject: (err: Error) => void
}

class ImageResourceManager {
  private static _instance: ImageResourceManager | null = null

  private cache = new Map<string, CachedEntry>()
  private pending = new Map<string, Promise<HTMLImageElement>>()
  private deferred: DeferredLoad[] = []
  private isViewportMoving = false
  private totalBytes = 0
  private readonly MAX_BYTES = 128 * 1024 * 1024 // 128 MB

  private constructor() {}

  static getInstance(): ImageResourceManager {
    if (!ImageResourceManager._instance) {
      ImageResourceManager._instance = new ImageResourceManager()
    }
    return ImageResourceManager._instance
  }

  /** 申请图片资源。已缓存则立即返回；viewport 移动中且非 critical 则延迟。 */
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
        this.deferred.push({ url, ownerId, resolve, reject })
      })
    }

    return this.load(url, ownerId)
  }

  /** 释放某 owner 对 url 的引用；owners 归零后进入 LRU 候选。 */
  release(url: string, ownerId: string): void {
    const entry = this.cache.get(url)
    if (entry) entry.owners.delete(ownerId)
  }

  /** 缩放/平移开始时调用 true，结束时调用 false。 */
  setViewportMoving(v: boolean): void {
    this.isViewportMoving = v
    if (!v) this.flushDeferred()
  }

  private async load(url: string, ownerId: string): Promise<HTMLImageElement> {
    const inflight = this.pending.get(url)
    if (inflight) {
      const img = await inflight
      const entry = this.cache.get(url)
      if (entry) entry.owners.add(ownerId)
      return img
    }

    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const sizeBytes = img.naturalWidth * img.naturalHeight * 4
        const entry: CachedEntry = {
          htmlImage: img,
          url,
          owners: new Set([ownerId]),
          sizeBytes,
          lastAccessAt: Date.now(),
        }
        this.cache.set(url, entry)
        this.totalBytes += sizeBytes
        this.pending.delete(url)
        this.evictLRU()
        resolve(img)
      }
      img.onerror = () => {
        this.pending.delete(url)
        reject(new Error(`ImageResourceManager: failed to load ${url}`))
      }
      img.src = url
    })

    this.pending.set(url, promise)
    return promise
  }

  private flushDeferred(): void {
    const queue = this.deferred.splice(0)
    for (const item of queue) {
      this.load(item.url, item.ownerId).then(item.resolve).catch(item.reject)
    }
  }

  private evictLRU(): void {
    if (this.totalBytes <= this.MAX_BYTES) return
    const candidates = Array.from(this.cache.values())
      .filter((e) => e.owners.size === 0)
      .sort((a, b) => a.lastAccessAt - b.lastAccessAt)
    for (const entry of candidates) {
      if (this.totalBytes <= this.MAX_BYTES) break
      this.totalBytes -= entry.sizeBytes
      this.cache.delete(entry.url)
    }
  }
}

export { ImageResourceManager }
