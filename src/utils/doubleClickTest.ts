/**
 * 双击事件冲突测试工具
 * 用于验证AI对话框双击最小化与Flow节点面板的事件处理
 */

export class DoubleClickConflictTester {
  private logHistory: Array<{
    timestamp: number;
    source: 'ai-dialog' | 'flow-panel';
    action: string;
    coordinates: { x: number; y: number };
    target: string;
  }> = [];

  constructor() {
    this.init();
  }

  private init() {
    // 监听自定义事件来跟踪双击处理
    window.addEventListener('ai-dialog-double-click', this.handleAIDialogEvent.bind(this));
    window.addEventListener('flow-panel-double-click', this.handleFlowPanelEvent.bind(this));
  }

  private handleAIDialogEvent(event: CustomEvent) {
    this.logHistory.push({
      timestamp: Date.now(),
      source: 'ai-dialog',
      action: event.detail.action || 'toggle-maximize',
      coordinates: { x: event.detail.x, y: event.detail.y },
      target: event.detail.target
    });
  }

  private handleFlowPanelEvent(event: CustomEvent) {
    this.logHistory.push({
      timestamp: Date.now(),
      source: 'flow-panel',
      action: event.detail.action || 'create-node-panel',
      coordinates: { x: event.detail.x, y: event.detail.y },
      target: event.detail.target
    });
  }

  /**
   * 模拟在AI对话框区域双击
   */
  simulateAIDialogDoubleClick(x: number, y: number) {
    console.log('🧪 模拟AI对话框双击:', { x, y });
    
    const event = new MouseEvent('dblclick', {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true
    });
    
    document.dispatchEvent(event);
    
    setTimeout(() => {
      this.checkForConflicts();
    }, 100);
  }

  /**
   * 检查最近100ms内是否有事件冲突
   */
  private checkForConflicts() {
    const recent = this.logHistory.filter(log => Date.now() - log.timestamp < 100);
    
    if (recent.length > 1) {
      console.warn('🚨 检测到双击事件冲突:', recent);
      return true;
    }
    
    console.log('✅ 无事件冲突检测到');
    return false;
  }

  /**
   * 获取测试报告
   */
  getTestReport() {
    const report = {
      totalEvents: this.logHistory.length,
      aiDialogEvents: this.logHistory.filter(log => log.source === 'ai-dialog').length,
      flowPanelEvents: this.logHistory.filter(log => log.source === 'flow-panel').length,
      conflicts: this.detectConflicts(),
      recentHistory: this.logHistory.slice(-10)
    };
    
    console.log('📊 双击事件测试报告:', report);
    return report;
  }

  /**
   * 检测历史记录中的冲突
   */
  private detectConflicts() {
    const conflicts = [];
    const timeWindow = 100; // 100ms窗口
    
    for (let i = 0; i < this.logHistory.length - 1; i++) {
      const current = this.logHistory[i];
      const next = this.logHistory[i + 1];
      
      if (next.timestamp - current.timestamp < timeWindow && 
          current.source !== next.source) {
        conflicts.push({ current, next });
      }
    }
    
    return conflicts;
  }

  /**
   * 清除测试历史
   */
  clearHistory() {
    this.logHistory = [];
    console.log('🗑️ 测试历史已清除');
  }
}

// 导出单例实例
export const doubleClickTester = new DoubleClickConflictTester();

// 在开发环境下暴露到全局
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).doubleClickTester = doubleClickTester;
}