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

  constructor(config: ContextConfig = DEFAULT_CONTEXT_CONFIG) {
    this.config = config;
    console.log('🧠 上下文管理器初始化完成');
  }

  /**
   * 创建新会话
   */
  createSession(): string {
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
        timestamp: null
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
  }

  /**
   * 构建上下文提示
   */
  buildContextPrompt(userInput: string): string {
    const context = this.getCurrentContext();
    if (!context) return userInput;
    
    const recentMessages = context.messages.slice(-5); // 最近5条消息
    const recentOperations = context.operations.slice(-3); // 最近3次操作
    
    let contextPrompt = `用户当前输入: ${userInput}\n\n`;
    
    if (recentMessages.length > 0) {
      contextPrompt += `对话历史:\n`;
      recentMessages.forEach(msg => {
        const content = msg.content.length > 100 ? msg.content.substring(0, 100) + '...' : msg.content;
        contextPrompt += `- ${msg.type}: ${content}\n`;
      });
      contextPrompt += `\n`;
    }
    
    if (recentOperations.length > 0) {
      contextPrompt += `最近操作:\n`;
      recentOperations.forEach(op => {
        const input = op.input.length > 50 ? op.input.substring(0, 50) + '...' : op.input;
        const output = op.output && op.output.length > 50 ? op.output.substring(0, 50) + '...' : op.output;
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
    
    // 🖼️ 图像缓存信息
    if (context.cachedImages.latest) {
      contextPrompt += `\n当前缓存的图像:\n`;
      contextPrompt += `- 图像ID: ${context.cachedImages.latestId}\n`;
      contextPrompt += `- 生成提示: ${context.cachedImages.latestPrompt}\n`;
      contextPrompt += `- 生成时间: ${context.cachedImages.timestamp?.toLocaleTimeString()}\n`;
    }
    
    // 🧠 特殊处理数学计算和连续对话
    const isMathRelated = /[\d\+\-\*\/\=]/.test(userInput) || 
                          recentMessages.some(msg => /[\d\+\-\*\/\=]/.test(msg.content));
    
    if (isMathRelated) {
      contextPrompt += `\n注意：这是一个数学计算相关的对话，请保持计算的连续性和准确性。`;
    }
    
    // 🖼️ 特殊处理图像编辑意图
    const isImageEditIntent = this.detectImageEditIntent(userInput);
    if (isImageEditIntent && context.cachedImages.latest) {
      contextPrompt += `\n注意：用户可能想要编辑当前缓存的图像，请考虑使用编辑功能。`;
    }
    
    contextPrompt += `\n请根据以上上下文理解用户意图并提供合适的响应。`;
    
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
    
    return hasKeyword || isMathContinuation;
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
    this.contexts.set(data.sessionId, data);
    this.currentSessionId = data.sessionId;
    console.log('📥 导入会话数据:', data.sessionId);
  }

  /**
   * 🖼️ 缓存最新生成的图像
   */
  cacheLatestImage(imageData: string, imageId: string, prompt: string): void {
    const context = this.getCurrentContext();
    if (!context) {
      console.error('❌ 无法缓存图像：没有活跃的上下文');
      return;
    }
    
    context.cachedImages = {
      latest: imageData,
      latestId: imageId,
      latestPrompt: prompt,
      timestamp: new Date()
    };
    
    console.log('🖼️ 缓存最新图像:', {
      imageId,
      prompt: prompt.substring(0, 30),
      hasImageData: !!imageData,
      imageDataLength: imageData?.length || 0,
      sessionId: context.sessionId
    });
  }

  /**
   * 🖼️ 获取缓存的图像信息
   */
  getCachedImage(): { imageData: string; imageId: string; prompt: string } | null {
    const context = this.getCurrentContext();
    if (!context) {
      console.log('🔍 getCachedImage: 没有活跃的上下文');
      return null;
    }
    
    if (!context.cachedImages.latest) {
      console.log('🔍 getCachedImage: 没有缓存的图像', {
        sessionId: context.sessionId,
        cachedImages: context.cachedImages
      });
      return null;
    }
    
    const result = {
      imageData: context.cachedImages.latest,
      imageId: context.cachedImages.latestId!,
      prompt: context.cachedImages.latestPrompt!
    };
    
    console.log('🔍 getCachedImage: 返回缓存的图像', {
      imageId: result.imageId,
      prompt: result.prompt.substring(0, 30),
      hasImageData: !!result.imageData,
      imageDataLength: result.imageData?.length || 0
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
      timestamp: null
    };
    
    console.log('🗑️ 清除图像缓存');
  }
}

// 创建全局实例
export const contextManager = new ContextManager();

// 定期清理旧上下文
setInterval(() => {
  contextManager.cleanupOldContexts();
}, 60 * 60 * 1000); // 每小时清理一次
