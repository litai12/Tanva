/**
 * 图片URL缓存服务
 * 用于避免重复的远程URL转换和上传操作
 * 解决性能问题：每次操作都会重新处理同一张图片
 */

interface CacheEntry {
  url: string;
  timestamp: number;
  dataUrl?: string; // 可选的 dataUrl 缓存
}

// 缓存过期时间：30分钟
const CACHE_TTL_MS = 30 * 60 * 1000;

// 最大缓存条目数
const MAX_CACHE_SIZE = 100;

class ImageUrlCacheService {
  private cache: Map<string, CacheEntry> = new Map();

  /**
   * 生成缓存键
   * 基于图片ID和项目ID生成唯一键
   */
  private getCacheKey(imageId: string, projectId?: string | null): string {
    return projectId ? `${projectId}:${imageId}` : imageId;
  }

  /**
   * 检查缓存是否有效（未过期）
   */
  private isValid(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp < CACHE_TTL_MS;
  }

  /**
   * 清理过期和超出大小限制的缓存
   */
  private cleanup(): void {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());

    // 删除过期条目
    entries.forEach(([key, entry]) => {
      if (now - entry.timestamp >= CACHE_TTL_MS) {
        this.cache.delete(key);
      }
    });

    // 如果仍然超出大小限制，删除最旧的条目
    if (this.cache.size > MAX_CACHE_SIZE) {
      const sortedEntries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);

      const toDelete = sortedEntries.slice(0, this.cache.size - MAX_CACHE_SIZE);
      toDelete.forEach(([key]) => this.cache.delete(key));
    }
  }

  /**
   * 获取缓存的远程URL
   * @param imageId 图片ID
   * @param projectId 项目ID（可选）
   * @returns 缓存的URL，如果未命中或过期则返回 null
   */
  getCachedUrl(imageId: string, projectId?: string | null): string | null {
    const key = this.getCacheKey(imageId, projectId);
    const entry = this.cache.get(key);

    if (entry && this.isValid(entry)) {
      console.log(`📦 [ImageUrlCache] 命中缓存: ${imageId}`);
      return entry.url;
    }

    if (entry) {
      // 过期了，删除
      this.cache.delete(key);
    }

    return null;
  }

  /**
   * 设置URL缓存
   * @param imageId 图片ID
   * @param url 远程URL
   * @param projectId 项目ID（可选）
   * @param dataUrl 可选的 dataUrl
   */
  setCachedUrl(imageId: string, url: string, projectId?: string | null, dataUrl?: string): void {
    const key = this.getCacheKey(imageId, projectId);

    this.cache.set(key, {
      url,
      timestamp: Date.now(),
      dataUrl,
    });

    console.log(`💾 [ImageUrlCache] 缓存URL: ${imageId} -> ${url.substring(0, 50)}...`);

    // 定期清理
    if (this.cache.size > MAX_CACHE_SIZE * 0.9) {
      this.cleanup();
    }
  }

  /**
   * 获取缓存的 dataUrl
   */
  getCachedDataUrl(imageId: string, projectId?: string | null): string | null {
    const key = this.getCacheKey(imageId, projectId);
    const entry = this.cache.get(key);

    if (entry && this.isValid(entry) && entry.dataUrl) {
      console.log(`📦 [ImageUrlCache] 命中 dataUrl 缓存: ${imageId}`);
      return entry.dataUrl;
    }

    return null;
  }

  /**
   * 更新缓存的 dataUrl
   */
  updateDataUrl(imageId: string, dataUrl: string, projectId?: string | null): void {
    const key = this.getCacheKey(imageId, projectId);
    const entry = this.cache.get(key);

    if (entry) {
      entry.dataUrl = dataUrl;
      entry.timestamp = Date.now(); // 刷新时间戳
    }
  }

  /**
   * 删除特定图片的缓存
   */
  invalidate(imageId: string, projectId?: string | null): void {
    const key = this.getCacheKey(imageId, projectId);
    this.cache.delete(key);
    console.log(`🗑️ [ImageUrlCache] 删除缓存: ${imageId}`);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
    console.log(`🗑️ [ImageUrlCache] 清空所有缓存`);
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// 导出单例
export const imageUrlCache = new ImageUrlCacheService();
export default imageUrlCache;
