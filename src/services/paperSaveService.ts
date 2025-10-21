import paper from 'paper';
import { useProjectContentStore } from '@/stores/projectContentStore';
import type { ImageAssetSnapshot, ModelAssetSnapshot, TextAssetSnapshot } from '@/types/project';
import type { Model3DData } from '@/services/model3DUploadService';
import { saveMonitor } from '@/utils/saveMonitor';

class PaperSaveService {
  private saveTimeoutId: number | null = null;
  private readonly SAVE_DELAY = 150; // 初始延迟，用于收敛多次触发
  private readonly MIN_SAVE_INTERVAL = 800; // 两次实际保存之间的最小间隔(ms)
  private isInitialized = false;
  private scheduledForProjectId: string | null = null;
  private lastSaveTimestamp = 0;
  private pendingSaveReason: string | null = null;

  private normalizeLayerId(name?: string | undefined | null): string | null {
    if (!name) return null;
    if (name.startsWith('layer_')) return name.replace('layer_', '');
    return name;
  }

  private gatherAssets(): { images: ImageAssetSnapshot[]; models: ModelAssetSnapshot[]; texts: TextAssetSnapshot[] } {
    const images: ImageAssetSnapshot[] = [];
    const models: ModelAssetSnapshot[] = [];
    const texts: TextAssetSnapshot[] = [];

    try {
      const instances = (window as any)?.tanvaImageInstances as any[] | undefined;
      if (Array.isArray(instances)) {
        instances.forEach((instance) => {
          const data = instance?.imageData;
          const bounds = instance?.bounds;
          const url = data?.url || data?.localDataUrl || data?.src;
          if (!url) return;
          images.push({
            id: instance.id,
            url,
            key: data?.key,
            fileName: data?.fileName,
            width: data?.width,
            height: data?.height,
            contentType: data?.contentType,
            pendingUpload: !!data?.pendingUpload,
            localDataUrl: data?.localDataUrl,
            bounds: {
              x: bounds?.x ?? 0,
              y: bounds?.y ?? 0,
              width: bounds?.width ?? 0,
              height: bounds?.height ?? 0,
            },
            layerId: this.normalizeLayerId(instance?.layerId || instance?.layer?.name),
            src: url,
          });
        });
      }
    } catch (error) {
      console.warn('采集图片实例失败:', error);
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
              fontSize: style?.fontSize ?? 24,
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

    return { images, models, texts };
  }

  private isInlineDataUrl(value: unknown): value is string {
    return typeof value === 'string' && /^data:image\//i.test(value);
  }

  private sanitizeAssets(assets: { images: ImageAssetSnapshot[]; models: ModelAssetSnapshot[]; texts: TextAssetSnapshot[] }) {
    const sanitizedImages = assets.images.map((asset) => {
      const next: ImageAssetSnapshot = { ...asset };
      const hasRemoteUrl = typeof next.url === 'string' && !this.isInlineDataUrl(next.url);
      const hasRemoteSrc = typeof next.src === 'string' && !this.isInlineDataUrl(next.src || '');

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

    return {
      images: sanitizedImages,
      models: sanitizedModels,
      texts: sanitizedTexts
    };
  }

  private prepareRasterSources(imageAssets: ImageAssetSnapshot[]) {
    if (!this.isPaperProjectReady()) return;

    const assetMap = new Map<string, ImageAssetSnapshot>();
    imageAssets.forEach((asset) => {
      assetMap.set(asset.id, asset);
    });

    try {
      (paper.project.layers || []).forEach((layer: any) => {
        const children = layer?.children || [];
        children.forEach((child: any) => {
          if (!child) return;
          const isRaster = child.className === 'Raster' || child instanceof paper.Raster;
          if (!isRaster) return;

          const imageId = child?.data?.imageId || child?.data?.id || child?.id;
          if (!imageId) return;

          const asset = assetMap.get(imageId);
          if (!asset) return;

          const remoteUrl = (asset.url && !this.isInlineDataUrl(asset.url))
            ? asset.url
            : asset.src && !this.isInlineDataUrl(asset.src)
              ? asset.src
              : undefined;

          if (remoteUrl) {
            if (typeof child.source === 'string' && this.isInlineDataUrl(child.source)) {
              child.source = remoteUrl;
            }
            if (!child.data) child.data = {};
            child.data.remoteUrl = remoteUrl;
          }

          if (child.data) {
            delete child.data.localDataUrl;
            delete child.data.inlineDataUrl;
          }
        });
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

  /**
   * 序列化当前Paper.js项目为JSON字符串
   */
  serializePaperProject(): string | null {
    try {
      if (!this.isPaperProjectReady()) {
        console.warn('⚠️ Paper.js项目未正确初始化，跳过序列化');
        return null;
      }

      // 直接导出当前项目；导入时再清理系统层/辅助元素
      const jsonString = (paper.project as any).exportJSON({ asString: true });
      if (!jsonString || (typeof jsonString === 'string' && jsonString.length === 0)) {
        return JSON.stringify({ layers: [] });
      }

      console.log('✅ Paper.js项目序列化成功');
      return jsonString as string;
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
      if (!this.isPaperProjectReady()) {
        console.warn('⚠️ Paper.js项目未正确初始化，无法反序列化');
        return false;
      }

      if (!jsonString || jsonString.trim() === '') {
        console.log('📝 空的Paper.js内容，跳过反序列化');
        return true;
      }

      // 导入保存的内容（此操作会替换当前项目内容）
      (paper.project as any).importJSON(jsonString);

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

      console.log('✅ Paper.js项目反序列化成功');
      try { window.dispatchEvent(new CustomEvent('paper-project-changed')); } catch {}
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

      const gatheredAssets = this.gatherAssets();
      const sanitizedAssets = this.sanitizeAssets(gatheredAssets);
      const hasPendingImages = sanitizedAssets.images.some((img) => img.pendingUpload);

      if (hasPendingImages) {
        try {
          const currentError = (contentStore as any).lastError as string | null;
          const pendingMsg = '存在未上传成功的图片，已使用本地副本，请稍后在网络可用时重新上传。';
          if (currentError !== pendingMsg) {
            contentStore.setError(pendingMsg);
          }
        } catch {}
      } else {
        try {
          const currentError = (contentStore as any).lastError as string | null;
          const pendingMsg = '存在未上传成功的图片，已使用本地副本，请稍后在网络可用时重新上传。';
          if (currentError === pendingMsg) {
            contentStore.setError(null);
          }
        } catch {}
      }

      let paperJson: string | null = null;

      if (this.isPaperProjectReady()) {
        this.prepareRasterSources(sanitizedAssets.images);
        paperJson = this.serializePaperProject();
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
        console.log('💾 更新项目内容store中的paperJson...', { projectId: contentStore.projectId, hasPaperContent: !!paperJson, ...meta });
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
        assets: sanitizedAssets,
        updatedAt: new Date().toISOString()
      }, { markDirty: true });

      console.log('✅ Paper.js内容已更新到项目store，将触发自动保存');
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
