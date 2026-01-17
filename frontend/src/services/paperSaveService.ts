import paper from 'paper';
import { useProjectContentStore } from '@/stores/projectContentStore';
import type { ImageAssetSnapshot, ModelAssetSnapshot, TextAssetSnapshot, VideoAssetSnapshot } from '@/types/project';
import type { Model3DData } from '@/services/model3DUploadService';
import { imageUploadService } from '@/services/imageUploadService';
import { saveMonitor } from '@/utils/saveMonitor';
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy';
import {
  isAssetKeyRef,
  isPersistableImageRef,
  isRemoteUrl,
  normalizePersistableImageRef,
  toRenderableImageSrc,
} from '@/utils/imageSource';
import { FLOW_IMAGE_ASSET_PREFIX } from '@/services/flowImageAssetStore';
import { canvasToBlob, canvasToDataUrl, responseToBlob } from '@/utils/imageConcurrency';

class PaperSaveService {
  private saveTimeoutId: number | null = null;
  // 优化：增加保存延迟和间隔，减少内存峰值
  private readonly SAVE_DELAY = 500; // 增加到500ms，更好地收敛多次触发
  private readonly MIN_SAVE_INTERVAL = 2000; // 增加到2秒，减少频繁序列化
  private isInitialized = false;
  private scheduledForProjectId: string | null = null;
  private lastSaveTimestamp = 0;
  private pendingSaveReason: string | null = null;
  private rasterLoadHooked = new WeakSet<object>();
  private persistableImageRefMap: Map<string, string> | null = null;

  private isInlineImageSource(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    return (
      trimmed.startsWith('data:image/') ||
      trimmed.startsWith('blob:') ||
      trimmed.startsWith(FLOW_IMAGE_ASSET_PREFIX)
    );
  }

  /**
   * Paper.js exportJSON 会把 Raster.source 序列化为“当前可渲染的 src”。
   * 运行时为了规避 CORS，我们会把 key/remote URL 包装成 `/api/assets/proxy?...`（开发态还可能带上 `http://localhost:5173`）。
   *
   * 但写入后端的设计 JSON（Project.contentJson）必须只持久化可长期可用的引用（remote URL / OSS key / 同源路径），
   * 因此这里把 `http(s)://.../api/assets/proxy?...` 或 `/api/assets/proxy?...` 统一反解为 key/url，避免把本地域名或 proxy 包装落库。
   */
  private postprocessJsonForPersistence(jsonString: string): string {
    if (!jsonString) return jsonString;
    try {
      // 匹配绝对/相对的 assets proxy URL（以 JSON 字符串中的引号为边界）
      const proxyUrlPattern =
        /(?:https?:\/\/[^"\s]+)?(?:\/api\/assets\/proxy|\/assets\/proxy)\?[^"\s]*/g;

      let processedCount = 0;
      const result = jsonString.replace(proxyUrlPattern, (match) => {
        const normalized = normalizePersistableImageRef(match);
        if (normalized && normalized !== match) {
          processedCount += 1;
          return normalized;
        }
        return match;
      });

      if (processedCount > 0) {
        console.log(
          `[postprocessJsonForPersistence] 已将 ${processedCount} 个 proxy URL 反解为可持久化引用`
        );
      }

      const persistableRefMap = this.persistableImageRefMap;
      if (!persistableRefMap || persistableRefMap.size === 0) {
        return result;
      }

      const hasInlineSource =
        result.includes('blob:') ||
        result.includes('data:image/') ||
        result.includes(FLOW_IMAGE_ASSET_PREFIX);
      if (!hasInlineSource) {
        return result;
      }

      try {
        const parsed = JSON.parse(result);
        let replacedCount = 0;

        const visit = (node: any) => {
          if (!node) return;
          if (Array.isArray(node)) {
            if (node.length >= 2 && node[0] === 'Raster') {
              const props = node[1] as any;
              if (props && typeof props === 'object') {
                const source = typeof props.source === 'string' ? props.source : '';
                if (source && this.isInlineImageSource(source)) {
                  const imageIdRaw =
                    props?.data?.imageId ?? props?.data?.id ?? props?.data?.imageID;
                  const imageId = imageIdRaw !== undefined && imageIdRaw !== null
                    ? String(imageIdRaw)
                    : '';
                  const persisted = imageId ? persistableRefMap.get(imageId) : undefined;
                  if (persisted && isPersistableImageRef(persisted)) {
                    props.source = persisted;
                    replacedCount += 1;
                  }
                }
              }
            }
            node.forEach(visit);
            return;
          }
          if (typeof node === 'object') {
            Object.values(node).forEach(visit);
          }
        };

        visit(parsed);
        if (replacedCount > 0) {
          console.log(
            `[postprocessJsonForPersistence] 已将 ${replacedCount} 个 inline Raster.source 替换为可持久化引用`
          );
        }
        return JSON.stringify(parsed);
      } catch {
        return result;
      }
    } catch (error) {
      console.warn('[PaperSaveService] 反解 proxy URL 失败，使用原始内容:', error);
      return jsonString;
    }
  }

  /**
   * 预处理 Paper.js JSON，将 OSS URL 替换为代理 URL
   * 必须在 importJSON 之前调用，否则图片会使用原始 URL 加载导致 CORS 错误
   */
  private preprocessJsonForProxy(jsonString: string): string {
    if (!jsonString) return jsonString;

    try {
      // 匹配阿里云 OSS URL 的正则（包括 URL 末尾可能的引号前字符）
      // 格式: https://xxx.oss-cn-xxx.aliyuncs.com/...
      // 注意：JSON 中 URL 被双引号包裹，所以用 [^"\s] 来匹配到引号前停止
      const ossUrlPattern = /(https?:\/\/[^"\s]+\.aliyuncs\.com[^"\s]*)/g;

      console.log('[preprocessJsonForProxy] 开始处理，JSON 长度:', jsonString.length);

      let processedCount = 0;
      let skippedCount = 0;
      const result = jsonString.replace(ossUrlPattern, (match) => {
        // 跳过已经是代理 URL 的
        if (match.includes('/api/assets/proxy')) {
          skippedCount++;
          return match;
        }

        const proxied = proxifyRemoteAssetUrl(match);
        if (proxied !== match) {
          processedCount++;
          console.log('[preprocessJsonForProxy] 转换:', match.substring(0, 80), '...');
          return proxied;
        }
        console.log('[preprocessJsonForProxy] 未转换:', match.substring(0, 80));
        return match;
      });

      console.log(`[preprocessJsonForProxy] 完成: 转换=${processedCount}, 跳过=${skippedCount}`);
      if (processedCount > 0) {
        console.log(`🔄 预处理 JSON：已将 ${processedCount} 个 OSS URL 转换为代理 URL`);
      }

      return result;
    } catch (error) {
      console.warn('[PaperSaveService] 预处理 JSON 失败，使用原始内容:', error);
      return jsonString;
    }
  }

  private ensureRasterCrossOriginAndProxySources() {
    try {
      if (!this.isPaperProjectReady()) return;

      const project = paper.project as any;
      const rasterClass = (paper as any).Raster;
      if (!project?.getItems || !rasterClass) return;

      const rasters = project.getItems({ class: rasterClass }) as any[];
      if (!Array.isArray(rasters) || rasters.length === 0) return;

      rasters.forEach((raster) => {
        if (!raster || (typeof raster !== 'object' && typeof raster !== 'function')) return;

        const dataRemoteUrl = typeof raster?.data?.remoteUrl === 'string' ? raster.data.remoteUrl.trim() : '';
        const dataKey = typeof raster?.data?.key === 'string' ? raster.data.key.trim() : '';
        const sourceString = typeof raster.source === 'string' ? raster.source.trim() : '';

        const candidate =
          (dataKey && isPersistableImageRef(dataKey) ? dataKey : '') ||
          (dataRemoteUrl ? normalizePersistableImageRef(dataRemoteUrl) : '') ||
          (sourceString ? normalizePersistableImageRef(sourceString) : '');

        if (!candidate || this.isInlineImageSource(candidate)) return;
        if (!isPersistableImageRef(candidate)) return;

        const renderable = toRenderableImageSrc(candidate);
        if (!renderable) return;
        const shouldProxy = renderable !== candidate;

        const shouldUseAnonymous = (() => {
          if (shouldProxy) return true;
          try {
            const url = new URL(candidate);
            if (typeof window !== 'undefined' && url.hostname === window.location.hostname) return true;
            if (url.hostname.endsWith('.aliyuncs.com')) return true;
          } catch {}
          return false;
        })();

        if (shouldUseAnonymous) {
          try { (raster as any).crossOrigin = 'anonymous'; } catch {}
        }

        if (!shouldProxy) return;

        if (typeof raster.source === 'string') {
          raster.source = renderable;
          return;
        }

        const maybeImg = raster.source as any;
        if (maybeImg && typeof maybeImg === 'object' && typeof maybeImg.src === 'string') {
          if (shouldUseAnonymous) {
            try { maybeImg.crossOrigin = 'anonymous'; } catch {}
          }
          try { maybeImg.src = renderable; } catch {}
        }
      });
    } catch (error) {
      console.warn('[PaperSaveService] 修复 Raster 跨域加载失败:', error);
    }
  }

  private async convertBlobUrlToBlob(blobUrl: string): Promise<Blob | null> {
    try {
      const response = await fetch(blobUrl);
      if (!response.ok) return null;
      return await responseToBlob(response);
    } catch (error) {
      console.warn('解析 blob URL 失败:', error);
      return null;
    }
  }

  private findRasterCanvasByImageId(imageId: string): HTMLCanvasElement | OffscreenCanvas | null {
    if (!imageId) return null;
    try {
      if (!this.isPaperProjectReady()) return null;
      const project = paper.project as any;
      const rasterClass = (paper as any).Raster;
      if (!project?.getItems || !rasterClass) return null;

      const rasters = project.getItems({ class: rasterClass }) as any[];
      if (!Array.isArray(rasters) || rasters.length === 0) return null;

      for (const raster of rasters) {
        const rid =
          raster?.data?.imageId ||
          raster?.parent?.data?.imageId ||
          raster?.data?.id ||
          raster?.id;
        if (String(rid) !== String(imageId)) continue;
        const canvas = raster?.canvas as any;
        if (canvas) return canvas as HTMLCanvasElement | OffscreenCanvas;
      }
    } catch {}
    return null;
  }

  private async resolveRasterCanvasAsInlineSource(asset: ImageAssetSnapshot): Promise<
    | { kind: 'blob'; value: Blob }
    | null
  > {
    try {
      const canvas = this.findRasterCanvasByImageId(asset.id);
      if (!canvas) return null;
      const type =
        typeof asset.contentType === 'string' && asset.contentType.startsWith('image/')
          ? asset.contentType
          : 'image/png';
      const blob = await canvasToBlob(canvas, { type });
      if (!blob || blob.size <= 0) return null;
      return { kind: 'blob', value: blob };
    } catch (error) {
      console.warn('从 Raster.canvas 兜底解析图片失败:', error);
      return null;
    }
  }

  private async resolveInlineAssetSource(asset: ImageAssetSnapshot): Promise<
    | { kind: 'dataUrl'; value: string }
    | { kind: 'blob'; value: Blob }
    | null
  > {
    const candidates = [asset.localDataUrl, asset.src, asset.url];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'string') continue;
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('data:image/')) {
        return { kind: 'dataUrl', value: trimmed };
      }
      if (trimmed.startsWith('blob:')) {
        const blob = await this.convertBlobUrlToBlob(trimmed);
        if (blob) {
          return { kind: 'blob', value: blob };
        }
        // blob URL 可能已被回收/刷新失效；尝试从已渲染的 Raster.canvas 兜底
        const fallback = await this.resolveRasterCanvasAsInlineSource(asset);
        if (fallback) return fallback;
        continue;
      }
      if (!isPersistableImageRef(trimmed) && trimmed.length > 128) {
        const compact = trimmed.replace(/\s+/g, '');
        const base64Pattern = /^[A-Za-z0-9+/=]+$/;
        if (base64Pattern.test(compact)) {
          return { kind: 'dataUrl', value: `data:image/png;base64,${compact}` };
        }
      }
    }
    // 最后兜底：允许仅靠 Raster.canvas 获取上传内容（避免某些分支只剩失效 blob）
    return await this.resolveRasterCanvasAsInlineSource(asset);
  }

  private buildRuntimeImageInstanceMap(): Map<string, any> {
    const map = new Map<string, any>();
    try {
      const instances = (window as any)?.tanvaImageInstances;
      if (Array.isArray(instances)) {
        instances.forEach((instance: any) => {
          if (instance?.id) {
            map.set(instance.id, instance);
          }
        });
      }
    } catch {}
    return map;
  }

  private syncRuntimeImageAsset(
    assetId: string,
    updates: Partial<ImageAssetSnapshot>,
    instanceMap: Map<string, any>
  ) {
    if (!assetId) return;
    const instance = instanceMap.get(assetId);
    if (!instance || !instance.imageData || typeof instance.imageData !== 'object') {
      return;
    }
    try {
      Object.assign(instance.imageData, updates);
      if (updates.pendingUpload === false) {
        delete instance.imageData.pendingUpload;
      }
      if ('localDataUrl' in updates && updates.localDataUrl === undefined) {
        delete instance.imageData.localDataUrl;
      }
    } catch (error) {
      console.warn('同步运行时图片状态失败:', error);
    }
  }

  private async ensureRemoteAssets(assets: {
    images: ImageAssetSnapshot[];
    models: ModelAssetSnapshot[];
    texts: TextAssetSnapshot[];
    videos: VideoAssetSnapshot[];
  }) {
    if (!assets.images.length) {
      return assets;
    }

    const projectStore = useProjectContentStore.getState();
    const projectId = projectStore.projectId;
    const runtimeMap = this.buildRuntimeImageInstanceMap();
    let uploaded = 0;
    let failed = 0;

    for (const image of assets.images) {
      const hasRemote =
        isPersistableImageRef(image.url) ||
        isPersistableImageRef(image.src) ||
        isPersistableImageRef(image.remoteUrl) ||
        isPersistableImageRef(image.key || null);
      if (hasRemote) {
        if (image.pendingUpload) {
          image.pendingUpload = false;
          delete image.localDataUrl;
          this.syncRuntimeImageAsset(image.id, { pendingUpload: false, localDataUrl: undefined }, runtimeMap);
        }
        continue;
      }

      const inlineSource = await this.resolveInlineAssetSource(image);
      if (!inlineSource) {
        if (!image.pendingUpload) {
          image.pendingUpload = true;
          this.syncRuntimeImageAsset(image.id, { pendingUpload: true }, runtimeMap);
        }
        continue;
      }

      try {
        const uploadOptions = {
          projectId,
          dir: projectId ? `projects/${projectId}/images/` : undefined,
          fileName: image.fileName || `autosave_${image.id || Date.now()}.png`,
        };

        let uploadResult;
        if (inlineSource.kind === 'blob') {
          const blob = inlineSource.value;
          const file = new File(
            [blob],
            uploadOptions.fileName,
            { type: blob.type || image.contentType || 'image/png' }
          );
          uploadResult = await imageUploadService.uploadImageFile(file, uploadOptions);
        } else {
          uploadResult = await imageUploadService.uploadImageDataUrl(inlineSource.value, uploadOptions);
        }

        if (uploadResult.success && uploadResult.asset?.url) {
          const uploadedAsset = uploadResult.asset;
          image.url = (uploadedAsset.key || uploadedAsset.url).trim();
          image.key = uploadedAsset.key || image.key;
          image.remoteUrl = uploadedAsset.url;
          // 持久化快照里保留远程 src，避免保存 blob/dataURL 到设计 JSON
          image.src = uploadedAsset.url;
          image.fileName = image.fileName || uploadedAsset.fileName;
          image.width = image.width || uploadedAsset.width;
          image.height = image.height || uploadedAsset.height;
          image.pendingUpload = false;
          delete image.localDataUrl;
          this.syncRuntimeImageAsset(
            image.id,
            {
              url: image.url,
              key: image.key,
              remoteUrl: image.remoteUrl,
              pendingUpload: false,
              localDataUrl: undefined,
            },
            runtimeMap,
          );
          uploaded += 1;
        } else {
          if (!image.pendingUpload) {
            image.pendingUpload = true;
            this.syncRuntimeImageAsset(image.id, { pendingUpload: true }, runtimeMap);
          }
          failed += 1;
        }
      } catch (error) {
        if (!image.pendingUpload) {
          image.pendingUpload = true;
          this.syncRuntimeImageAsset(image.id, { pendingUpload: true }, runtimeMap);
        }
        failed += 1;
        console.warn('自动上传本地图片失败:', error);
      }
    }

    if (uploaded > 0) {
      console.log(`📤 自动补全了 ${uploaded} 张本地图片的远程URL`);
    }
    if (failed > 0) {
      console.warn(`⚠️ 仍有 ${failed} 张图片缺少远程URL，保存到云端时将丢失这些图片（可重试上传）`);
    }

    return assets;
  }

  private normalizeLayerId(name?: string | undefined | null): string | null {
    if (!name) return null;
    if (name.startsWith('layer_')) return name.replace('layer_', '');
    return name;
  }

  private async gatherAssets(): Promise<{ images: ImageAssetSnapshot[]; models: ModelAssetSnapshot[]; texts: TextAssetSnapshot[]; videos: VideoAssetSnapshot[] }> {
    const images: ImageAssetSnapshot[] = [];
    const models: ModelAssetSnapshot[] = [];
    const texts: TextAssetSnapshot[] = [];
    const videos: VideoAssetSnapshot[] = [];
    const collectedImageIds = new Set<string>();

    // 1. 从 tanvaImageInstances 收集图片
    try {
      const instances = (window as any)?.tanvaImageInstances as any[] | undefined;
      if (Array.isArray(instances)) {
        instances.forEach((instance) => {
          const data = instance?.imageData;
          const bounds = instance?.bounds;
          const rawUrl = typeof data?.url === 'string' ? data.url.trim() : '';
          const rawSrc = typeof data?.src === 'string' ? data.src.trim() : '';
          const rawKey = typeof data?.key === 'string' ? data.key.trim() : '';
          const normalizedUrl = rawUrl ? normalizePersistableImageRef(rawUrl) : '';
          const normalizedSrc = rawSrc ? normalizePersistableImageRef(rawSrc) : '';
          const normalizedKey = rawKey ? normalizePersistableImageRef(rawKey) : '';

          const persistedRef =
            (normalizedKey && isPersistableImageRef(normalizedKey) ? normalizedKey : '') ||
            (normalizedUrl && isPersistableImageRef(normalizedUrl) ? normalizedUrl : '') ||
            (normalizedSrc && isPersistableImageRef(normalizedSrc) ? normalizedSrc : '');

          const url = persistedRef || data?.localDataUrl || rawUrl || rawSrc;
          if (!url) return;
          const pendingUpload = !!data?.pendingUpload || !isPersistableImageRef(url);
          collectedImageIds.add(instance.id);
          images.push({
            id: instance.id,
            url,
            key: persistedRef && isAssetKeyRef(persistedRef) ? persistedRef : (data?.key || normalizedKey || undefined),
            fileName: data?.fileName,
            width: data?.width,
            height: data?.height,
            contentType: data?.contentType,
            pendingUpload,
            localDataUrl: data?.localDataUrl,
            bounds: {
              x: bounds?.x ?? 0,
              y: bounds?.y ?? 0,
              width: bounds?.width ?? 0,
              height: bounds?.height ?? 0,
            },
            layerId: this.normalizeLayerId(instance?.layerId || instance?.layer?.name),
            src: persistedRef && normalizedSrc ? normalizedSrc : (data?.src || url),
          });
        });
      }
    } catch (error) {
      console.warn('采集图片实例失败:', error);
    }

    // 2. 扫描 Paper.js 中的所有 Raster，补充遗漏的图片
    try {
      if (this.isPaperProjectReady()) {
        const rasterClass = (paper as any).Raster;
        if (rasterClass) {
          const rasters = (paper.project as any).getItems?.({ class: rasterClass }) as any[];
          if (Array.isArray(rasters)) {
            for (const raster of rasters) {
              if (!raster) continue;
              const imageId = raster?.data?.imageId || raster?.parent?.data?.imageId;
              if (!imageId || collectedImageIds.has(imageId)) continue;

              // 获取图片源
              const source = raster.source;
              const remoteUrl = raster?.data?.remoteUrl;
              const key = typeof raster?.data?.key === 'string' ? raster.data.key.trim() : '';
              const url = (key && isPersistableImageRef(key) ? key : null)
                || (typeof remoteUrl === 'string' && isPersistableImageRef(remoteUrl) ? normalizePersistableImageRef(remoteUrl) : null)
                || (typeof source === 'string' && isPersistableImageRef(source) ? normalizePersistableImageRef(source) : null);

              // 如果没有远程 URL，尝试从 canvas 获取 dataUrl（限流，避免多图瞬时转码导致内存峰值）
              let localDataUrl: string | undefined;
              if (!url && raster.canvas) {
                try {
                  localDataUrl = await canvasToDataUrl(raster.canvas, 'image/png');
                } catch {}
              }

              const finalUrl = url || localDataUrl;
              if (!finalUrl) continue;

              const bounds = raster.bounds;
              collectedImageIds.add(imageId);
              images.push({
                id: imageId,
                url: finalUrl,
                src: finalUrl,
                fileName: raster?.data?.fileName,
                width: raster.width,
                height: raster.height,
                pendingUpload: !url,
                localDataUrl: localDataUrl,
                bounds: {
                  x: bounds?.x ?? 0,
                  y: bounds?.y ?? 0,
                  width: bounds?.width ?? 0,
                  height: bounds?.height ?? 0,
                },
                layerId: this.normalizeLayerId(raster?.layer?.name),
                key: key || undefined,
              });
              console.log(`📷 从 Paper.js 补充采集图片: ${imageId}`);
            }
          }
        }
      }
    } catch (error) {
      console.warn('从 Paper.js 补充采集图片失败:', error);
    }

    try {
      const instances = (window as any)?.tanvaModel3DInstances as any[] | undefined;
      if (Array.isArray(instances)) {
        instances.forEach((instance) => {
          const data: Model3DData | undefined = instance?.modelData;
          const bounds = instance?.bounds;
          const url = data?.url || (data as any)?.path;
          if (!url) return;
          models.push({
            id: instance.id,
            url,
            key: data?.key,
            path: url,
            format: data?.format || 'glb',
            fileName: data?.fileName || 'model',
          fileSize: data?.fileSize || 0,
          defaultScale: data?.defaultScale || { x: 1, y: 1, z: 1 },
          defaultRotation: data?.defaultRotation || { x: 0, y: 0, z: 0 },
          timestamp: data?.timestamp || Date.now(),
          camera: data?.camera,
          bounds: {
            x: bounds?.x ?? 0,
            y: bounds?.y ?? 0,
            width: bounds?.width ?? 0,
            height: bounds?.height ?? 0,
            },
            layerId: this.normalizeLayerId(instance?.layerId),
          });
        });
      }
    } catch (error) {
      console.warn('采集3D模型实例失败:', error);
    }

    try {
      const items = (window as any)?.tanvaTextItems as any[] | undefined;
      if (Array.isArray(items)) {
        items.forEach((item) => {
          const paperText = item?.paperText;
          const style = item?.style || {};
          const position = paperText?.position;
          const color = typeof style?.color === 'string'
            ? style.color
            : (paperText?.fillColor && typeof paperText.fillColor.toCSS === 'function'
              ? paperText.fillColor.toCSS(true)
              : '#000000');
          texts.push({
            id: item?.id,
            content: paperText?.content ?? '',
            position: {
              x: position?.x ?? 0,
              y: position?.y ?? 0,
            },
            style: {
              fontFamily: style?.fontFamily || 'sans-serif',
              fontWeight: style?.fontWeight === 'bold' ? 'bold' : 'normal',
              fontSize: style?.fontSize ?? 32,
              color,
              align: style?.align || 'left',
              italic: !!style?.italic,
            },
            layerId: this.normalizeLayerId(paperText?.layer?.name),
          });
        });
      }
    } catch (error) {
      console.warn('采集文本实例失败:', error);
    }

    return { images, models, texts, videos };
  }

  private sanitizeAssets(assets: { images: ImageAssetSnapshot[]; models: ModelAssetSnapshot[]; texts: TextAssetSnapshot[]; videos: VideoAssetSnapshot[] }) {
    const sanitizedImages = assets.images.map((asset) => {
      const next: ImageAssetSnapshot = { ...asset };
      const hasRemoteUrl = isPersistableImageRef(next.url);
      const hasRemoteSrc = isPersistableImageRef(next.src || '');

      if (hasRemoteUrl) {
        next.src = next.url;
      } else if (!hasRemoteUrl && hasRemoteSrc) {
        next.url = next.src!;
      }

      if (!next.pendingUpload && hasRemoteUrl) {
        delete next.localDataUrl;
      }

      return next;
    });

    const sanitizedModels = assets.models.map((model) => ({ ...model }));
    const sanitizedTexts = assets.texts.map((text) => ({ ...text }));
    const sanitizedVideos = assets.videos.map((video) => ({ ...video }));

    return {
      images: sanitizedImages,
      models: sanitizedModels,
      texts: sanitizedTexts,
      videos: sanitizedVideos
    };
  }

  private prepareRasterSources(imageAssets: ImageAssetSnapshot[]) {
    if (!this.isPaperProjectReady()) return;

    const assetMap = new Map<string, ImageAssetSnapshot>();
    imageAssets.forEach((asset) => {
      assetMap.set(asset.id, asset);
    });

    try {
      const rasters = (paper.project as any).getItems?.({
        match: (item: any) => item && (item.className === 'Raster' || item instanceof paper.Raster),
      }) as paper.Raster[] | undefined;

      (rasters || []).forEach((raster: any) => {
        if (!raster) return;
        const imageId =
          raster?.data?.imageId ||
          raster?.parent?.data?.imageId ||
          raster?.data?.id ||
          raster?.id;
        if (!imageId) return;

        const asset = assetMap.get(String(imageId));
        if (!asset) return;

        const persistedRef =
          (asset.key && isPersistableImageRef(asset.key) ? asset.key : undefined) ||
          (asset.url && isPersistableImageRef(asset.url) ? asset.url : undefined) ||
          (asset.src && isPersistableImageRef(asset.src) ? asset.src : undefined);
        const remoteUrl =
          (asset.src && isRemoteUrl(asset.src) ? asset.src : undefined) ||
          (asset.url && isRemoteUrl(asset.url) ? asset.url : undefined);

        if (persistedRef) {
          if (!raster.data) raster.data = {};
          if (remoteUrl) raster.data.remoteUrl = remoteUrl;
          if (asset.key) raster.data.key = asset.key;
        }

        if (raster.data) {
          delete raster.data.localDataUrl;
          delete raster.data.inlineDataUrl;
        }
      });
    } catch (error) {
      console.warn('准备Raster资源时出错:', error);
    }
  }

  /**
   * 初始化自动保存服务
   */
  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    console.log('🎨 Paper.js自动保存服务已初始化');
  }

  /**
   * 检查 Paper.js 项目是否正常初始化
   */
  private isPaperProjectReady(): boolean {
    try {
      return !!(paper && paper.project && paper.view);
    } catch (error) {
      console.warn('Paper.js 项目状态检查失败:', error);
      return false;
    }
  }

  private ensureRasterLoadUpdates() {
    try {
      if (!this.isPaperProjectReady()) return;

      const project = paper.project as any;
      const rasterClass = (paper as any).Raster;
      if (!project?.getItems || !rasterClass) return;

      const rasters = project.getItems({ class: rasterClass }) as any[];
      if (!Array.isArray(rasters) || rasters.length === 0) return;

      rasters.forEach((raster) => {
        if (!raster || (typeof raster !== 'object' && typeof raster !== 'function')) return;
        if (this.rasterLoadHooked.has(raster)) return;
        this.rasterLoadHooked.add(raster);

        const previousOnLoad = raster.onLoad;
        raster.onLoad = function (...args: any[]) {
          if (typeof previousOnLoad === 'function') {
            try {
              previousOnLoad.apply(this, args);
            } catch (error) {
              console.warn('执行原始 Raster onLoad 失败:', error);
            }
          }

          try {
            paper.view?.update();
          } catch {}
        };
      });
    } catch (error) {
      console.warn('[PaperSaveService] 挂接 Raster onLoad 更新失败:', error);
    }
  }

  /**
   * 序列化当前Paper.js项目为JSON字符串
   */
  serializePaperProject(excludeImageIds?: string[]): string | null {
    try {
      if (!this.isPaperProjectReady()) {
        console.warn('⚠️ Paper.js项目未正确初始化，跳过序列化');
        return null;
      }

      const project = paper.project as any;
      const SYSTEM_LAYER_NAMES = new Set(['grid', 'background', 'scalebar']);

      // 导出时剔除系统层与辅助元素，避免 paperJson 巨大导致序列化卡顿/内存峰值
      // 注意：通过“临时移除→导出→恢复”的方式实现，且在同一同步调用栈内完成，避免可见闪烁。
      const detachedLayers: Array<{ layer: paper.Layer; index: number }> = [];
      const detachedHelpers: Array<{ item: paper.Item; parent: paper.Item; index: number }> = [];
      const detachedPendingImages: Array<{ item: paper.Item; parent: paper.Item; index: number }> = [];
      const previousActiveLayer = paper.project.activeLayer;

      const detachHelpers = (parent: paper.Item) => {
        const children = (parent as any)?.children as paper.Item[] | undefined;
        if (!Array.isArray(children) || children.length === 0) return;

        // 从后往前遍历，记录原始 index，方便后续按升序恢复
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i];
          if (!child) continue;
          const data = (child as any).data as any;
          if (data?.isHelper) {
            detachedHelpers.push({ item: child, parent, index: i });
            try { child.remove(); } catch {}
            continue;
          }
          // 只深入非 helper 容器，避免重复拆解 helper group
          if ((child as any).hasChildren) {
            detachHelpers(child);
          }
        }
      };

      try {
        const layers = (paper.project.layers || []).slice();
        layers.forEach((layer: paper.Layer, index: number) => {
          const name = (layer as any)?.name || '';
          if (!SYSTEM_LAYER_NAMES.has(name)) return;
          detachedLayers.push({ layer, index });
        });

        // 临时移除系统层
        detachedLayers.forEach(({ layer }) => {
          try { layer.remove(); } catch {}
        });

        // 临时剔除“未上传/不可持久化”的图片，避免把 data:/blob:/base64 序列化进 paperJson
        const excludeSet = new Set(
          (excludeImageIds || [])
            .filter((id) => typeof id === 'string')
            .map((id) => id.trim())
            .filter((id) => id.length > 0)
        );

        if (excludeSet.size > 0) {
          try {
            const candidates = (paper.project as any).getItems?.({
              match: (item: any) => {
                const imageId = item?.data?.imageId;
                return imageId && excludeSet.has(String(imageId));
              },
            }) as paper.Item[] | undefined;

            const targets = new Set<paper.Item>();
            (candidates || []).forEach((item: any) => {
              const imageIdRaw = item?.data?.imageId;
              if (!imageIdRaw) return;
              const imageId = String(imageIdRaw);

              let cursor: any = item;
              let target: any = item;
              let best: any = item?.data?.type === 'image' ? item : null;

              while (cursor?.parent && cursor.parent !== paper.project) {
                const parent: any = cursor.parent;
                if (!parent || parent.className === 'Layer' || parent instanceof paper.Layer) break;
                const parentImageId = parent?.data?.imageId;
                if (parentImageId && String(parentImageId) === imageId) {
                  target = parent;
                  if (parent?.data?.type === 'image') best = parent;
                  cursor = parent;
                  continue;
                }
                break;
              }

              targets.add((best || target) as paper.Item);
            });

            const entries = Array.from(targets)
              .map((item) => {
                const parent = item.parent as any;
                if (!parent) return null;
                const index = typeof (item as any).index === 'number'
                  ? (item as any).index
                  : (Array.isArray(parent.children) ? parent.children.indexOf(item) : 0);
                return { item, parent, index: typeof index === 'number' ? index : 0 };
              })
              .filter(Boolean) as Array<{ item: paper.Item; parent: paper.Item; index: number }>;

            entries
              .sort((a, b) => b.index - a.index)
              .forEach(({ item, parent, index }) => {
                detachedPendingImages.push({ item, parent, index });
                try { item.remove(); } catch {}
              });
          } catch (error) {
            console.warn('[PaperSaveService] 剔除未上传图片失败（将继续序列化）:', error);
          }
        }

        // 临时移除所有 helper item（保留用户内容）
        (paper.project.layers || []).forEach((layer: any) => {
          const name = layer?.name || '';
          if (SYSTEM_LAYER_NAMES.has(name)) return;
          detachHelpers(layer as paper.Layer);
        });

        const jsonString = project.exportJSON({ asString: true });
        if (!jsonString || (typeof jsonString === 'string' && jsonString.length === 0)) {
          return JSON.stringify({ layers: [] });
        }
        return this.postprocessJsonForPersistence(jsonString as string);
      } finally {
        // 恢复 helper items（逆序插入可保证每个 parent 内按原 index 升序恢复）
        for (let i = detachedHelpers.length - 1; i >= 0; i--) {
          const entry = detachedHelpers[i];
          try {
            (entry.parent as any).insertChild(entry.index, entry.item);
          } catch {}
        }

        // 恢复被剔除的未上传图片（按 index 倒序插入，避免同父级下的 index 漂移）
        detachedPendingImages
          .sort((a, b) => b.index - a.index)
          .forEach(({ item, parent, index }) => {
            try { (parent as any).insertChild(index, item); } catch {}
          });

        // 恢复系统层（按原 index 升序插入）
        detachedLayers
          .sort((a, b) => a.index - b.index)
          .forEach(({ layer, index }) => {
            try { (paper.project as any).insertLayer(index, layer); } catch {}
          });

        // 恢复之前的 activeLayer
        try {
          if (previousActiveLayer && (previousActiveLayer as any).project === paper.project) {
            previousActiveLayer.activate();
          }
        } catch {}
      }
    } catch (error) {
      console.error('❌ Paper.js项目序列化失败:', error);
      return null;
    }
  }

  /**
   * 从JSON字符串恢复Paper.js项目
   */
  deserializePaperProject(jsonString: string): boolean {
    try {
      console.log('[deserializePaperProject] 开始，isPaperProjectReady:', this.isPaperProjectReady());

      if (!this.isPaperProjectReady()) {
        console.warn('⚠️ Paper.js项目未正确初始化，无法反序列化');
        return false;
      }

      if (!jsonString || jsonString.trim() === '') {
        console.log('📝 空的Paper.js内容，跳过反序列化');
        return true;
      }

      console.log('[deserializePaperProject] JSON 长度:', jsonString.length);

      // Paper.js 的 Project#importJSON 默认是"追加"到当前项目，而不是替换。
      try { (paper.project as any).clear(); } catch {}

      // 【关键】在 importJSON 之前预处理 JSON，将 OSS URL 替换为代理 URL
      const processedJson = this.preprocessJsonForProxy(jsonString);

      console.log('[deserializePaperProject] 预处理后 JSON 长度:', processedJson.length);

      // 导入保存的内容（使用预处理后的 JSON）
      (paper.project as any).importJSON(processedJson);

      // 作为后备，再次确保所有 Raster 使用代理 URL（处理动态创建的情况）
      this.ensureRasterCrossOriginAndProxySources();

      // 清理系统图层与辅助元素
      const toRemove: paper.Layer[] = [];
      (paper.project.layers || []).forEach((layer: any) => {
        const name = layer?.name || '';
        if (name === 'grid' || name === 'background' || name === 'scalebar') {
          toRemove.push(layer);
          return;
        }
        // 清理辅助元素
        try {
          const children = layer?.children || [];
          children.forEach((child: any) => {
            if (child?.data?.isHelper) child.remove();
          });
        } catch {}
      });
      toRemove.forEach(l => l.remove());

      // Raster 图片是异步加载的：在"冷启动/首次刷新"时，importJSON 后立刻 update 往往赶不上图片解码，
      // 需要为所有 Raster 挂接 onLoad → view.update，避免出现"首次刷新图片不显示、二次刷新才正常"的现象。
      this.ensureRasterLoadUpdates();

      console.log('✅ Paper.js项目反序列化成功');

      // 获取所有 Raster 并等待加载完成后再触发事件
      const rasterClass = (paper as any).Raster;
      const allRasters = rasterClass ? (paper.project as any).getItems?.({ class: rasterClass }) as any[] : [];
      const rasterCount = allRasters?.length || 0;
      const loadedCount = allRasters?.filter((r: any) => r?.bounds?.width > 0)?.length || 0;
      console.log(`🔍 [deserialize] Raster 状态: 总数=${rasterCount}, 已加载=${loadedCount}, 未加载=${rasterCount - loadedCount}`);

      // 等待所有 Raster 加载完成后再触发事件
      const pendingRasters = allRasters?.filter((r: any) => !r?.bounds?.width || r.bounds.width <= 0) || [];

      if (pendingRasters.length === 0) {
        // 所有图片已加载，直接触发事件
        console.log('🔍 [deserialize] 所有 Raster 已加载，立即触发事件');
        setTimeout(() => {
          try { window.dispatchEvent(new CustomEvent('paper-project-changed')); } catch {}
        }, 50);
      } else {
        // 有未加载的图片，等待它们加载完成
        console.log(`🔍 [deserialize] 等待 ${pendingRasters.length} 个 Raster 加载...`);
        let loadedSoFar = 0;
        let eventFired = false;
        const maxWaitTime = 10000; // 最大等待 10 秒
        const startTime = Date.now();

        const fireEventOnce = () => {
          if (eventFired) return;
          eventFired = true;
          const elapsed = Date.now() - startTime;
          console.log(`🔍 [deserialize] 触发 paper-project-changed 事件 (耗时 ${elapsed}ms)`);
          try { window.dispatchEvent(new CustomEvent('paper-project-changed')); } catch {}
        };

        // 超时兜底
        const timeoutId = setTimeout(() => {
          if (!eventFired) {
            console.warn(`⚠️ [deserialize] Raster 加载超时，强制触发事件`);
            fireEventOnce();
          }
        }, maxWaitTime);

        // 为每个未加载的 Raster 挂接 onLoad
        pendingRasters.forEach((raster: any) => {
          const originalOnLoad = raster.onLoad;
          raster.onLoad = function(this: any, ...args: any[]) {
            loadedSoFar++;
            console.log(`🔍 [deserialize] Raster 加载完成 (${loadedSoFar}/${pendingRasters.length})`);

            // 调用原始 onLoad
            if (typeof originalOnLoad === 'function') {
              try { originalOnLoad.apply(this, args); } catch {}
            }

            // 所有图片加载完成，触发事件
            if (loadedSoFar >= pendingRasters.length) {
              clearTimeout(timeoutId);
              // 稍微延迟确保 Paper.js 内部状态更新
              setTimeout(fireEventOnce, 50);
            }
          };
        });
      }

      if (paper.view) (paper.view as any).update();
      return true;
    } catch (error) {
      console.error('❌ Paper.js项目反序列化失败:', error);

      // 尝试触发项目重新初始化
      this.triggerProjectRecovery();

      return false;
    }
  }

  /**
   * 清空当前 Paper 项目（保留系统层，如 grid/background/scalebar，但清理其子元素）
   * 用于切换到“新建空项目”或在加载新项目前的画布重置
   */
  clearProject() {
    try {
      if (!this.isPaperProjectReady()) return;

      const SYSTEM_LAYER_NAMES = new Set(['grid', 'background', 'scalebar']);
      const layers = (paper.project.layers || []).slice();
      layers.forEach((layer: any) => {
        const name = layer?.name || '';
        if (SYSTEM_LAYER_NAMES.has(name)) {
          // 保留系统层，但清空其子元素
          try { layer.removeChildren(); } catch {}
        } else {
          try { layer.remove(); } catch {}
        }
      });

      // 更新视图并广播
      try { (paper.view as any)?.update?.(); } catch {}
      try { window.dispatchEvent(new CustomEvent('paper-project-cleared')); } catch {}
    } catch (e) {
      console.warn('清空 Paper 项目失败:', e);
    }
  }

  /**
   * 清空用户绘制内容（保留图层与系统层）。
   * - 系统层（grid/background/scalebar）：完全保留，不动其子元素
   * - 非系统层：仅清空子元素，保留图层结构，避免打乱图层面板
   */
  clearCanvasContent() {
    try {
      if (!this.isPaperProjectReady()) return;

      const SYSTEM_LAYER_NAMES = new Set(['grid', 'background', 'scalebar']);
      const layers = (paper.project.layers || []).slice();

      layers.forEach((layer: any) => {
        const name = layer?.name || '';
        if (SYSTEM_LAYER_NAMES.has(name)) {
          // 系统层保持不动（包含网格/坐标轴/底色等）
          return;
        }
        try { layer.removeChildren(); } catch {}
      });

      // 更新视图并广播清空事件（与 clearProject 保持一致的事件名）
      try { (paper.view as any)?.update?.(); } catch {}
      try { window.dispatchEvent(new CustomEvent('paper-project-cleared')); } catch {}
    } catch (e) {
      console.warn('清空画布内容失败:', e);
    }
  }

  /**
   * 触发项目恢复机制
   */
  private triggerProjectRecovery() {
    console.log('🔄 尝试恢复Paper.js项目...');

    // 发送恢复事件给其他组件
    try {
      window.dispatchEvent(new CustomEvent('paper-project-recovery-needed', {
        detail: { timestamp: Date.now() }
      }));
    } catch (error) {
      console.warn('发送恢复事件失败:', error);
    }
  }

  private scheduleSaveExecution(delay: number) {
    if (this.saveTimeoutId !== null) {
      window.clearTimeout(this.saveTimeoutId);
    }
    this.saveTimeoutId = window.setTimeout(() => this.executeScheduledSave(), delay);
  }

  private executeScheduledSave() {
    this.saveTimeoutId = null;

    const now = Date.now();
    const elapsedSinceLastSave = now - this.lastSaveTimestamp;

    if (this.lastSaveTimestamp > 0 && elapsedSinceLastSave < this.MIN_SAVE_INTERVAL) {
      const wait = this.MIN_SAVE_INTERVAL - elapsedSinceLastSave;
      console.debug(`[autosave] 距离上次保存仅过去 ${elapsedSinceLastSave}ms，延后 ${wait}ms 后再尝试保存`);
      this.scheduleSaveExecution(wait);
      return;
    }

    const reasonNote = this.pendingSaveReason ? `（来源：${this.pendingSaveReason}）` : '';
    console.log(`⏰ Paper.js自动保存延迟时间到，开始执行保存${reasonNote}...`);

    const finalize = () => {
      this.lastSaveTimestamp = Date.now();
      this.pendingSaveReason = null;
    };

    this.performSave()
      .finally(finalize);
  }

  /**
   * 触发自动保存（防抖）
   */
  triggerAutoSave(reason?: string) {
    // 记录当前项目ID，防止项目切换后把上一份内容写到新项目里
    try {
      this.scheduledForProjectId = useProjectContentStore.getState().projectId;
    } catch {
      this.scheduledForProjectId = null;
    }
    if (!this.scheduledForProjectId) {
      console.warn('⚠️ 无活动项目，跳过调度保存');
      return;
    }

    const reasonLabel = reason?.trim();
    if (reasonLabel) {
      this.pendingSaveReason = reasonLabel;
    }

    const alreadyScheduled = this.saveTimeoutId !== null;

    if (!alreadyScheduled) {
      console.log(`🔔 Paper.js自动保存被触发${reasonLabel ? `（${reasonLabel}）` : ''}`);
    }

    this.scheduleSaveExecution(this.SAVE_DELAY);

    if (!alreadyScheduled) {
      console.log(`⏱️ Paper.js自动保存已安排，将在${this.SAVE_DELAY}ms后执行`);
    }
  }

  /**
   * 执行实际的保存操作
   */
  private async performSave() {
    try {
      const contentStore = useProjectContentStore.getState();

      if (!contentStore.projectId) {
        console.warn('没有活动项目，跳过保存');
        return;
      }

      // 若在调度后项目已切换，直接丢弃这次保存
      if (this.scheduledForProjectId && this.scheduledForProjectId !== contentStore.projectId) {
        console.warn('⚠️ 项目已切换，取消过期的保存任务', {
          scheduledFor: this.scheduledForProjectId,
          current: contentStore.projectId,
        });
        return;
      }

      // 检查是否正在保存中，避免重复保存
      if (contentStore.saving) {
        console.warn('⚠️ 保存进行中，跳过重复保存');
        return;
      }

      const gatheredAssets = await this.gatherAssets();
      const sanitizedAssets = this.sanitizeAssets(gatheredAssets);
      const normalizedAssets = await this.ensureRemoteAssets(sanitizedAssets);
      const hasPendingImages = normalizedAssets.images.some((img) => img.pendingUpload);

      if (hasPendingImages) {
        try {
          const pendingCount = normalizedAssets.images.filter((img) => img.pendingUpload).length;
          const currentWarning = (contentStore as any).lastWarning as string | null;
          const pendingMsg = `存在未上传到 OSS 的本地图片（${pendingCount} 张），保存到云端时将丢失这些图片，请重试上传。`;
          if (currentWarning !== pendingMsg) {
            contentStore.setWarning(pendingMsg);
          }
        } catch {}
      } else {
        try {
          const currentWarning = (contentStore as any).lastWarning as string | null;
          if (currentWarning && currentWarning.startsWith('存在未上传到 OSS 的本地图片')) {
            contentStore.setWarning(null);
          }
        } catch {}
      }

      let paperJson: string | null = null;

      if (this.isPaperProjectReady()) {
        this.prepareRasterSources(normalizedAssets.images);
        const pendingImageIds = normalizedAssets.images
          .filter((img) => img.pendingUpload)
          .map((img) => img.id);

        const persistableRefMap = new Map<string, string>();
        normalizedAssets.images.forEach((img) => {
          const id = typeof img?.id === 'string' ? img.id.trim() : '';
          if (!id) return;
          const candidates = [img.key, img.url, img.remoteUrl, img.src];
          for (const candidate of candidates) {
            if (typeof candidate !== 'string') continue;
            const normalized = normalizePersistableImageRef(candidate);
            if (normalized && isPersistableImageRef(normalized)) {
              persistableRefMap.set(id, normalized);
              break;
            }
          }
        });

        this.persistableImageRefMap = persistableRefMap;
        try {
          paperJson = this.serializePaperProject(pendingImageIds);
        } finally {
          this.persistableImageRefMap = null;
        }
        // 统计层/元素数量
        let layerCount = 0; let itemCount = 0;
        try {
          (paper.project.layers || []).forEach((layer: any) => {
            const name = layer?.name || '';
            if (name === 'grid' || name === 'background' || name === 'scalebar') return;
            layerCount += 1;
            itemCount += (layer?.children?.length || 0);
          });
        } catch {}
        const meta = {
          paperJsonLen: paperJson?.length || 0,
          layerCount,
          itemCount,
          savedAt: new Date().toISOString(),
        };
        saveMonitor.push(contentStore.projectId, 'serialize', meta);
      } else {
        console.warn('⚠️ Paper.js项目状态异常，尝试恢复...');
        this.triggerProjectRecovery();

        // 即使 Paper.js 项目有问题，也要保存其他内容
        console.log('💾 Paper.js项目异常，但仍保存其他项目内容...');
      }

      contentStore.updatePartial({
        paperJson: paperJson || undefined,
        meta: paperJson ? { paperJsonLen: paperJson.length } : undefined,
        assets: normalizedAssets,
        updatedAt: new Date().toISOString()
      }, { markDirty: true });

    } catch (error) {
      console.error('❌ 更新Paper.js内容失败:', error);

      // 标记保存错误
      const contentStore = useProjectContentStore.getState();
      contentStore.setError(error instanceof Error ? error.message : '更新Paper.js内容失败');
    } finally {
      // 清理调度状态
      this.scheduledForProjectId = null;
    }
  }

  /**
   * 立即保存（不使用防抖）
   */
  async saveImmediately() {
    if (this.saveTimeoutId) {
      window.clearTimeout(this.saveTimeoutId);
      this.saveTimeoutId = null;
    }
    await this.performSave();
    this.lastSaveTimestamp = Date.now();
    this.pendingSaveReason = null;
  }

  cancelPending() {
    if (this.saveTimeoutId) {
      window.clearTimeout(this.saveTimeoutId);
      this.saveTimeoutId = null;
    }
    this.scheduledForProjectId = null;
    this.pendingSaveReason = null;
  }

  /**
   * 清理资源
   */
  cleanup() {
    if (this.saveTimeoutId) {
      window.clearTimeout(this.saveTimeoutId);
      this.saveTimeoutId = null;
    }
    this.isInitialized = false;
    this.pendingSaveReason = null;
  }
}

// 创建单例实例
export const paperSaveService = new PaperSaveService();
