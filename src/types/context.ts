/**
 * 上下文记忆系统类型定义
 * 用于管理AI对话的上下文和历史记录
 */

import type { ChatMessage } from '@/stores/aiChatStore';

// 对话上下文
export interface ConversationContext {
  sessionId: string;
  startTime: Date;
  lastActivity: Date;
  
  // 对话历史
  messages: ChatMessage[];
  
  // 操作历史
  operations: OperationHistory[];
  
  // 当前状态
  currentMode: 'generate' | 'edit' | 'blend' | 'analyze' | 'chat';
  activeImageId?: string;
  
  // 🖼️ 图像缓存状态
  cachedImages: {
    latest: string | null; // 最新生成的图像数据
    latestId: string | null; // 最新图像的ID
    latestPrompt: string | null; // 最新图像的提示词
    timestamp: Date | null; // 生成时间
    // 新增：最近图像在画布中的位置信息（可选）
    latestBounds?: { x: number; y: number; width: number; height: number } | null;
    latestLayerId?: string | null;
  };
  
  // 上下文信息
  contextInfo: {
    userPreferences: Record<string, any>;
    recentPrompts: string[];
    imageHistory: ImageHistory[];
    iterationCount: number;
    lastOperationType?: string;
  };
}

// 操作历史记录
export interface OperationHistory {
  id: string;
  type: 'generate' | 'edit' | 'blend' | 'analyze' | 'chat';
  timestamp: Date;
  input: string;
  output?: string;
  imageData?: string;
  success: boolean;
  metadata?: Record<string, any>;
}

// 图像历史记录
export interface ImageHistory {
  id: string;
  imageData: string;
  prompt: string;
  timestamp: Date;
  operationType: string;
  parentImageId?: string; // 用于追踪编辑链
  thumbnail?: string; // 缩略图，用于显示
}

// 上下文管理器接口
export interface IContextManager {
  createSession(): string;
  getCurrentContext(): ConversationContext | null;
  addMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): void;
  recordOperation(operation: Omit<OperationHistory, 'id' | 'timestamp'>): void;
  buildContextPrompt(userInput: string): string;
  detectIterativeIntent(input: string): boolean;
  incrementIteration(): void;
  resetIteration(): void;
  saveUserPreference(key: string, value: any): void;
  getUserPreference(key: string): any;
  cleanupOldContexts(maxAge?: number): void;
  getSessionSummary(): string;
}

// 上下文配置
export interface ContextConfig {
  maxMessages: number;
  maxOperations: number;
  maxImageHistory: number;
  sessionTimeout: number; // 毫秒
  enableIterationDetection: boolean;
  enableUserPreferences: boolean;
}

// 默认配置
export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  maxMessages: 50,
  maxOperations: 20,
  maxImageHistory: 10,
  sessionTimeout: 24 * 60 * 60 * 1000, // 24小时
  enableIterationDetection: true,
  enableUserPreferences: true
};
