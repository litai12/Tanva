import paper from 'paper';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { saveMonitor } from '@/utils/saveMonitor';

class PaperSaveService {
  private saveTimeoutId: number | null = null;
  private readonly SAVE_DELAY = 200; // 在绘制结束后尽快序列化写入store
  private isInitialized = false;

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

  /**
   * 触发自动保存（防抖）
   */
  triggerAutoSave() {
    console.log('🔔 Paper.js自动保存被触发');

    // 清除之前的保存计时器
    if (this.saveTimeoutId) {
      window.clearTimeout(this.saveTimeoutId);
    }

    // 设置新的保存计时器
    this.saveTimeoutId = window.setTimeout(() => {
      console.log('⏰ Paper.js自动保存延迟时间到，开始执行保存...');
      this.performSave();
    }, this.SAVE_DELAY);

    console.log(`⏱️ Paper.js自动保存已安排，将在${this.SAVE_DELAY}ms后执行`);
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

      // 检查 Paper.js 状态并序列化内容
      let paperJson: string | null = null;

      if (this.isPaperProjectReady()) {
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

      // 更新项目内容store中的paperJson，这将触发现有的useProjectAutosave
      contentStore.updatePartial({
        paperJson: paperJson || undefined,
        meta: paperJson ? { paperJsonLen: paperJson.length } : undefined,
        updatedAt: new Date().toISOString()
      }, { markDirty: true });

      console.log('✅ Paper.js内容已更新到项目store，将触发自动保存');
    } catch (error) {
      console.error('❌ 更新Paper.js内容失败:', error);

      // 标记保存错误
      const contentStore = useProjectContentStore.getState();
      contentStore.setError(error instanceof Error ? error.message : '更新Paper.js内容失败');
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
    this.performSave();
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
  }
}

// 创建单例实例
export const paperSaveService = new PaperSaveService();
