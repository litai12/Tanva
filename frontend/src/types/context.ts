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
  name: string;
  
  // 对话历史
  messages: ChatMessage[];
  
  // 操作历史
  operations: OperationHistory[];
  
  // 当前状态
  currentMode: 'generate' | 'edit' | 'blend' | 'analyze' | 'chat' | 'video_generate' | 'generateVideo';
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
    latestRemoteUrl?: string | null;
  };
  
  // 上下文信息
  contextInfo: {
    userPreferences: Record<string, unknown>;
    recentPrompts: string[];
    imageHistory: ImageHistory[];
    iterationCount: number;
    lastOperationType?: string;
  };
}

// 操作历史记录
export interface OperationHistory {
  id: string;
  type: 'generate' | 'edit' | 'blend' | 'analyze' | 'chat' | 'video_generate' | 'generateVideo';
  timestamp: Date;
  input: string;
  output?: string;
  imageData?: string;
  success: boolean;
  metadata?: Record<string, unknown>;
}

// 图像历史记录
export interface ImageHistory {
  id: string;
  imageData?: string;
  imageRemoteUrl?: string;
  prompt: string;
  timestamp: Date;
  operationType: string;
  parentImageId?: string; // 用于追踪编辑链
  thumbnail?: string; // 缩略图，用于显示
}

// 序列化结构（用于持久化保存/恢复）
export interface SerializedChatMessage {
  id: string;
  type: ChatMessage['type'];
  content: string;
  timestamp: string;
  webSearchResult?: unknown;
  // 可选：用于在聊天记录中显示的缩略图/小图
  imageData?: string;
  imageRemoteUrl?: string;
  thumbnail?: string;
  expectsImageOutput?: boolean;
  sourceImageData?: string;
  sourceImagesData?: string[];
  generationStatus?: {
    isGenerating: boolean;
    progress: number;
    error: string | null;
    stage?: string;
  };
  // 🔥 新增：OSS 图片 URL（优化性能）
  imageUrl?: string;
  provider?: ChatMessage['provider'];
  metadata?: Record<string, unknown>;
  videoUrl?: string;
  videoThumbnail?: string;
  videoDuration?: number;
  videoReferencedUrls?: string[];
  videoTaskId?: string | null;
  videoStatus?: string | null;
  videoSourceUrl?: string;
  // 并行生成分组信息（用于在恢复/持久化时保留并行组关系）
  groupId?: string | null;
  groupIndex?: number | null;
  groupTotal?: number | null;
}

export interface SerializedOperationHistory {
  id: string;
  type: OperationHistory['type'];
  timestamp: string;
  input: string;
  output?: string;
  success: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface SerializedImageHistoryEntry {
  id: string;
  prompt: string;
  timestamp: string;
  operationType: string;
  parentImageId: string | null;
  thumbnail: string | null;
  imageRemoteUrl: string | null;
  imageData?: string | null;
}

export interface SerializedConversationContext {
  sessionId: string;
  name: string;
  startTime: string;
  lastActivity: string;
  currentMode: ConversationContext['currentMode'];
  activeImageId?: string;
  messages: SerializedChatMessage[];
  operations: SerializedOperationHistory[];
  cachedImages: {
    latest: string | null;
    latestId: string | null;
    latestPrompt: string | null;
    timestamp: string | null;
    latestBounds: ConversationContext['cachedImages']['latestBounds'];
    latestLayerId: string | null;
    latestRemoteUrl: string | null;
  };
  contextInfo: {
    userPreferences: Record<string, unknown>;
    recentPrompts: string[];
    imageHistory: SerializedImageHistoryEntry[];
    iterationCount: number;
    lastOperationType?: string;
  };
}

// 上下文管理器接口
export interface IContextManager {
  createSession(name?: string): string;
  getCurrentContext(): ConversationContext | null;
  getCurrentSessionId(): string | null;
  switchSession(sessionId: string): boolean;
  getSession(sessionId: string): ConversationContext | null;
  listSessions(): Array<{
    sessionId: string;
    name: string;
    lastActivity: Date;
    messageCount: number;
   createdAt: Date;
   preview?: string;
 }>;
  getAllSessions(): ConversationContext[];
  renameSession(sessionId: string, name: string): boolean;
  deleteSession(sessionId: string): boolean;
  resetSessions(): void;
  addMessage(
    message: Omit<ChatMessage, 'id' | 'timestamp'>,
    options?: { id?: string; timestamp?: Date }
  ): ChatMessage;
  recordOperation(operation: Omit<OperationHistory, 'id' | 'timestamp'>): void;
  buildContextPrompt(userInput: string): string;
  detectIterativeIntent(input: string): boolean;
  incrementIteration(): void;
  resetIteration(): void;
  saveUserPreference(key: string, value: unknown): void;
  getUserPreference(key: string): unknown;
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
