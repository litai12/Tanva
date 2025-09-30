/**
 * 上下文记忆管理器
 * 负责管理AI对话的上下文和历史记录
 */

import type { 
  ConversationContext, 
  OperationHistory, 
  ImageHistory, 
  IContextManager, 
  ContextConfig 
} from '@/types/context';
import type { ChatMessage } from '@/stores/aiChatStore';
import { DEFAULT_CONTEXT_CONFIG } from '@/types/context';

class ContextManager implements IContextManager {
  private contexts: Map<string, ConversationContext> = new Map();
  private currentSessionId: string | null = null;
  private config: ContextConfig;

  private static createEmptyCachedImages(): ConversationContext['cachedImages'] {
    return {
      latest: null,
      latestId: null,
      latestPrompt: null,
      timestamp: null,
      latestBounds: null,
      latestLayerId: null,
      latestRemoteUrl: null
    };
  }

  private ensureCachedImages(context: ConversationContext): ConversationContext['cachedImages'] {
    if (!context.cachedImages) {
      context.cachedImages = ContextManager.createEmptyCachedImages();
    }

    const cached = context.cachedImages;

    if (cached.timestamp && !(cached.timestamp instanceof Date)) {
      cached.timestamp = new Date(cached.timestamp);
    }

    if (cached.latest === undefined) cached.latest = null;
    if (cached.latestId === undefined) cached.latestId = null;
    if (cached.latestPrompt === undefined) cached.latestPrompt = null;
    if (cached.latestBounds === undefined) cached.latestBounds = null;
    if (cached.latestLayerId === undefined) cached.latestLayerId = null;
    if (cached.latestRemoteUrl === undefined) cached.latestRemoteUrl = null;

    return cached;
  }

  constructor(config: ContextConfig = DEFAULT_CONTEXT_CONFIG) {
    this.config = config;
    console.log('🧠 上下文管理器初始化完成');
  }

  /**
   * 创建新会话
   */
  createSession(): string {
    // 检查是否已有活跃的会话
    if (this.currentSessionId && this.contexts.has(this.currentSessionId)) {
      const existingContext = this.contexts.get(this.currentSessionId);
      if (existingContext) {
        // 如果会话是最近30秒内创建的，认为是重复初始化，返回现有会话
        const sessionAge = Date.now() - existingContext.startTime.getTime();
        if (sessionAge < 30000) {  // 30秒内
          console.log('🧠 返回现有会话上下文:', this.currentSessionId, '(防止重复创建)');
          return this.currentSessionId;
        }
      }
    }
    
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const context: ConversationContext = {
      sessionId,
      startTime: new Date(),
      lastActivity: new Date(),
      messages: [],
      operations: [],
      currentMode: 'chat',
      cachedImages: {
        latest: null,
        latestId: null,
        latestPrompt: null,
        timestamp: null,
        latestBounds: null,
        latestLayerId: null,
        latestRemoteUrl: null
      },
      contextInfo: {
        userPreferences: {},
        recentPrompts: [],
        imageHistory: [],
        iterationCount: 0
      }
    };
    
    this.contexts.set(sessionId, context);
    this.currentSessionId = sessionId;
    
    console.log('🧠 创建新会话上下文:', sessionId);
    return sessionId;
  }

  /**
   * 获取当前上下文
   */
  getCurrentContext(): ConversationContext | null {
    if (!this.currentSessionId) return null;
    return this.contexts.get(this.currentSessionId) || null;
  }

  /**
   * 添加消息到上下文
   */
  addMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): void {
    const context = this.getCurrentContext();
    if (!context) return;
    
    const newMessage: ChatMessage = {
      ...message,
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date()
    };
    
    context.messages.push(newMessage);
    context.lastActivity = new Date();
    
    // 限制消息数量
    if (context.messages.length > this.config.maxMessages) {
      context.messages = context.messages.slice(-this.config.maxMessages);
    }
    
    console.log('📝 添加消息到上下文:', newMessage.content.substring(0, 50));
  }

  /**
   * 记录操作历史
   */
  recordOperation(operation: Omit<OperationHistory, 'id' | 'timestamp'>): void {
    const context = this.getCurrentContext();
    if (!context) return;
    
    const newOperation: OperationHistory = {
      ...operation,
      id: `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date()
    };
    
    context.operations.push(newOperation);
    context.lastActivity = new Date();
    context.currentMode = operation.type;
    context.contextInfo.lastOperationType = operation.type;
    
    // 限制操作历史数量
    if (context.operations.length > this.config.maxOperations) {
      context.operations = context.operations.slice(-this.config.maxOperations);
    }
    
    console.log('📊 记录操作历史:', newOperation.type, newOperation.input.substring(0, 30));

    // 事件通知：模式变化
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('contextModeChanged', { detail: { mode: context.currentMode } }));
      }
    } catch {}
  }

  /**
   * 构建上下文提示
   */
  buildContextPrompt(userInput: string): string {
    const context = this.getCurrentContext();
    if (!context) return userInput;
    
    // 限制历史记录数量，防止请求头过大 (431错误)
    const recentMessages = context.messages.slice(-3); // 减少到最近3条消息

    // 去重：如果最新一条历史就是这次的用户输入，则从历史中移除，避免与“用户当前输入”重复
    if (recentMessages.length > 0) {
      const last = recentMessages[recentMessages.length - 1];
      if (last.type === 'user' && last.content === userInput) {
        recentMessages.pop();
      }
    }
    const recentOperations = context.operations.slice(-2); // 减少到最近2次操作
    
    let contextPrompt = `用户当前输入: ${userInput}\n\n`;
    
    if (recentMessages.length > 0) {
      contextPrompt += `对话历史:\n`;
      recentMessages.forEach(msg => {
        // 减少单条消息长度限制
        const content = msg.content.length > 80 ? msg.content.substring(0, 80) + '...' : msg.content;
        contextPrompt += `- ${msg.type}: ${content}\n`;
      });
      contextPrompt += `\n`;
    }
    
    if (recentOperations.length > 0) {
      contextPrompt += `最近操作:\n`;
      recentOperations.forEach(op => {
        // 减少操作记录长度限制
        const input = op.input.length > 40 ? op.input.substring(0, 40) + '...' : op.input;
        const output = op.output && op.output.length > 40 ? op.output.substring(0, 40) + '...' : op.output;
        contextPrompt += `- ${op.type}: ${input} → ${output || '成功'} (${op.success ? '成功' : '失败'})\n`;
      });
      contextPrompt += `\n`;
    }
    
    if (context.currentMode !== 'chat') {
      contextPrompt += `当前模式: ${context.currentMode}\n`;
    }
    
    if (context.contextInfo.iterationCount > 0) {
      contextPrompt += `迭代次数: ${context.contextInfo.iterationCount}\n`;
    }
    
    if (context.contextInfo.lastOperationType) {
      contextPrompt += `上次操作: ${context.contextInfo.lastOperationType}\n`;
    }
    
    // 🖼️ 图像缓存信息 - 简化信息
    if (context.cachedImages.latest) {
      contextPrompt += `\n当前缓存图像: ${context.cachedImages.latestId || 'unknown'}\n`;
      // 简化生成提示信息
      const promptPreview = context.cachedImages.latestPrompt && context.cachedImages.latestPrompt.length > 50 
        ? context.cachedImages.latestPrompt.substring(0, 50) + '...'
        : context.cachedImages.latestPrompt || '';
      if (promptPreview) {
        contextPrompt += `生成提示: ${promptPreview}\n`;
      }
    }
    
    // 🧠 特殊处理数学计算和连续对话 - 简化检测
    const isMathRelated = /[\d\+\-\*\/\=]/.test(userInput);
    if (isMathRelated) {
      contextPrompt += `\n注意：数学计算相关对话。`;
    }
    
    // 🖼️ 特殊处理图像编辑意图 - 简化检测
    const isImageEditIntent = this.detectImageEditIntent(userInput);
    if (isImageEditIntent && context.cachedImages.latest) {
      contextPrompt += `\n注意：可能需要编辑缓存图像。`;
    }
    
    // 限制总体上下文提示长度，防止请求头过大 (431错误)
    const maxContextLength = 1500; // 设置合理的上限
    if (contextPrompt.length > maxContextLength) {
      contextPrompt = contextPrompt.substring(0, maxContextLength) + '\n...(上下文已截断)';
    }
    
    contextPrompt += `\n请根据上下文理解用户意图。`;
    
    return contextPrompt;
  }

  /**
   * 检测迭代意图
   */
  detectIterativeIntent(input: string): boolean {
    if (!this.config.enableIterationDetection) return false;
    
    const iterativeKeywords = [
      '优化', '调整', '改进', '修改', '再', '继续', '进一步', '更好', '更', '再试', '重新',
      'optimize', 'adjust', 'improve', 'refine', 'continue', 'further', 'better', 'more', 'again', 'retry'
    ];
    
    const lowerInput = input.toLowerCase();
    
    // 检查关键词
    const hasKeyword = iterativeKeywords.some(keyword => lowerInput.includes(keyword.toLowerCase()));
    
    // 🧠 检查数学计算的连续性
    const isMathContinuation = /[\+\-\*\/]/.test(input) && 
                              this.getCurrentContext()?.messages.some(msg => 
                                msg.type === 'ai' && /[\d\+\-\*\/\=]/.test(msg.content)
                              );
    
    return hasKeyword || !!isMathContinuation;
  }

  /**
   * 更新迭代计数
   */
  incrementIteration(): void {
    const context = this.getCurrentContext();
    if (!context) return;
    
    context.contextInfo.iterationCount++;
    console.log('🔄 迭代计数:', context.contextInfo.iterationCount);
  }

  /**
   * 重置迭代计数
   */
  resetIteration(): void {
    const context = this.getCurrentContext();
    if (!context) return;
    
    context.contextInfo.iterationCount = 0;
    console.log('🔄 重置迭代计数');
  }

  /**
   * 保存用户偏好
   */
  saveUserPreference(key: string, value: any): void {
    if (!this.config.enableUserPreferences) return;
    
    const context = this.getCurrentContext();
    if (!context) return;
    
    context.contextInfo.userPreferences[key] = value;
    console.log('💾 保存用户偏好:', key, value);
  }

  /**
   * 获取用户偏好
   */
  getUserPreference(key: string): any {
    const context = this.getCurrentContext();
    if (!context) return null;
    
    return context.contextInfo.userPreferences[key];
  }

  /**
   * 添加图像历史
   */
  addImageHistory(imageHistory: Omit<ImageHistory, 'id' | 'timestamp'>): void {
    const context = this.getCurrentContext();
    if (!context) return;
    
    const newImageHistory: ImageHistory = {
      ...imageHistory,
      id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date()
    };
    
    context.contextInfo.imageHistory.push(newImageHistory);
    
    // 限制图像历史数量
    if (context.contextInfo.imageHistory.length > this.config.maxImageHistory) {
      context.contextInfo.imageHistory = context.contextInfo.imageHistory.slice(-this.config.maxImageHistory);
    }
    
    console.log('🖼️ 添加图像历史:', newImageHistory.prompt.substring(0, 30));
  }

  /**
   * 获取会话摘要
   */
  getSessionSummary(): string {
    const context = this.getCurrentContext();
    if (!context) return '';
    
    const duration = Math.round((Date.now() - context.startTime.getTime()) / 1000 / 60); // 分钟
    const messageCount = context.messages.length;
    const operationCount = context.operations.length;
    const imageCount = context.contextInfo.imageHistory.length;
    
    return `会话时长: ${duration}分钟, 消息: ${messageCount}条, 操作: ${operationCount}次, 图像: ${imageCount}张`;
  }

  /**
   * 清理旧上下文
   */
  cleanupOldContexts(maxAge: number = this.config.sessionTimeout): void {
    const now = new Date();
    let cleanedCount = 0;
    
    for (const [sessionId, context] of this.contexts.entries()) {
      if (now.getTime() - context.lastActivity.getTime() > maxAge) {
        this.contexts.delete(sessionId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log('🗑️ 清理旧上下文:', cleanedCount, '个会话');
    }
  }

  /**
   * 获取所有会话统计
   */
  getSessionStats(): { totalSessions: number; activeSessions: number } {
    const now = new Date();
    const activeThreshold = 30 * 60 * 1000; // 30分钟
    
    let activeSessions = 0;
    for (const context of this.contexts.values()) {
      if (now.getTime() - context.lastActivity.getTime() < activeThreshold) {
        activeSessions++;
      }
    }
    
    return {
      totalSessions: this.contexts.size,
      activeSessions
    };
  }

  /**
   * 导出当前会话数据
   */
  exportSessionData(): ConversationContext | null {
    return this.getCurrentContext();
  }

  /**
   * 导入会话数据
   */
  importSessionData(data: ConversationContext): void {
    this.ensureCachedImages(data);
    this.contexts.set(data.sessionId, data);
    this.currentSessionId = data.sessionId;
    console.log('📥 导入会话数据:', data.sessionId);
  }

  /**
   * 🖼️ 缓存最新生成的图像
   */
  cacheLatestImage(
    imageData: string,
    imageId: string,
    prompt: string,
    options?: { bounds?: { x: number; y: number; width: number; height: number }; layerId?: string; remoteUrl?: string | null }
  ): void {
    const context = this.getCurrentContext();
    if (!context) {
      console.error('❌ 无法缓存图像：没有活跃的上下文');
      return;
    }

    const previous = this.ensureCachedImages(context);

    const normalizedImageData = typeof imageData === 'string' && imageData.length > 0
      ? imageData
      : previous.latest;
    const normalizedImageId = typeof imageId === 'string' && imageId.length > 0
      ? imageId
      : previous.latestId;
    const normalizedPrompt = typeof prompt === 'string' && prompt.length > 0
      ? prompt
      : previous.latestPrompt;

    const normalizedBounds = options?.bounds ?? previous.latestBounds ?? null;
    const normalizedLayerId = options?.layerId ?? previous.latestLayerId ?? null;
    const normalizedRemoteUrl = options && 'remoteUrl' in options
      ? options.remoteUrl ?? null
      : previous.latestRemoteUrl ?? null;

    if (!normalizedImageData || !normalizedImageId || !normalizedPrompt) {
      console.warn('⚠️ 缓存图像失败：缺少必要字段', {
        sessionId: context.sessionId,
        hasPreviousImage: !!previous.latest,
        provided: {
          hasImageData: typeof imageData === 'string' && imageData.length > 0,
          hasImageId: typeof imageId === 'string' && imageId.length > 0,
          hasPrompt: typeof prompt === 'string' && prompt.length > 0
        }
      });
      return;
    }

    context.cachedImages = {
      latest: normalizedImageData,
      latestId: normalizedImageId,
      latestPrompt: normalizedPrompt,
      timestamp: new Date(),
      latestBounds: normalizedBounds,
      latestLayerId: normalizedLayerId,
      latestRemoteUrl: normalizedRemoteUrl
    };

    console.log('🖼️ 缓存最新图像:', {
      imageId: normalizedImageId,
      prompt: normalizedPrompt.substring(0, 30),
      hasImageData: !!normalizedImageData,
      imageDataLength: normalizedImageData?.length || 0,
      sessionId: context.sessionId,
      bounds: normalizedBounds,
      layerId: normalizedLayerId,
      hasRemoteUrl: !!normalizedRemoteUrl
    });

    // 通知: 缓存更新
    try {
      if (typeof window !== 'undefined') {
        const payload = this.getCachedImage();
        window.dispatchEvent(new CustomEvent('cachedImageChanged', { detail: payload }));
      }
    } catch {}
  }

  /**
   * 🖼️ 获取缓存的图像信息
   */
  getCachedImage(): { imageData: string; imageId: string; prompt: string; bounds?: { x: number; y: number; width: number; height: number } | null; layerId?: string | null; remoteUrl?: string | null } | null {
    const context = this.getCurrentContext();
    if (!context) {
      console.log('🔍 getCachedImage: 没有活跃的上下文');
      return null;
    }
    const cachedImages = this.ensureCachedImages(context);

    if (!cachedImages.latest || !cachedImages.latestId || !cachedImages.latestPrompt) {
      console.log('🔍 getCachedImage: 缓存数据不完整', {
        sessionId: context.sessionId,
        hasImageData: !!cachedImages.latest,
        hasImageId: !!cachedImages.latestId,
        hasPrompt: !!cachedImages.latestPrompt
      });
      return null;
    }

    const result = {
      imageData: cachedImages.latest,
      imageId: cachedImages.latestId,
      prompt: cachedImages.latestPrompt,
      bounds: cachedImages.latestBounds ?? null,
      layerId: cachedImages.latestLayerId ?? null,
      remoteUrl: cachedImages.latestRemoteUrl ?? null
    };

    console.log('🔍 getCachedImage: 返回缓存的图像', {
      imageId: result.imageId,
      prompt: result.prompt.substring(0, 30),
      hasImageData: !!result.imageData,
      imageDataLength: result.imageData?.length || 0,
      bounds: result.bounds,
      layerId: result.layerId,
      hasRemoteUrl: !!result.remoteUrl
    });

    return result;
  }

  /**
   * 🖼️ 检测用户是否想要编辑最新图像
   */
  detectImageEditIntent(input: string): boolean {
    const context = this.getCurrentContext();
    if (!context || !context.cachedImages.latest) return false;
    
    const editKeywords = [
      '编辑', '修改', '改变', '调整', '优化', '改进', '让它', '改成', '变成',
      '给', '加上', '添加', '戴上', '穿上', '画上', '加上', '制作', '设计',
      'edit', 'modify', 'change', 'adjust', 'optimize', 'improve', 'make it', 'turn into',
      'add', 'put on', 'wear', 'draw on', 'create', 'design'
    ];
    
    const lowerInput = input.toLowerCase();
    return editKeywords.some(keyword => lowerInput.includes(keyword.toLowerCase()));
  }

  /**
   * 🖼️ 清除图像缓存
   */
  clearImageCache(): void {
    const context = this.getCurrentContext();
    if (!context) return;
    
    context.cachedImages = {
      latest: null,
      latestId: null,
      latestPrompt: null,
      timestamp: null,
      latestBounds: null,
      latestLayerId: null,
      latestRemoteUrl: null
    };
    
    console.log('🗑️ 清除图像缓存');

    // 通知: 缓存清空
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cachedImageChanged', { detail: null }));
      }
    } catch {}
  }
}

// 创建全局实例
export const contextManager = new ContextManager();

// 定期清理旧上下文
setInterval(() => {
  contextManager.cleanupOldContexts();
}, 60 * 60 * 1000); // 每小时清理一次
