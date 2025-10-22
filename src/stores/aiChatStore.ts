/**
 * AI聊天对话框状态管理
 * 管理对话框显示、输入内容和生成状态
 */

import { create } from 'zustand';
import { aiImageService } from '@/services/aiImageService';
import {
  generateImageViaAPI,
  editImageViaAPI,
  blendImagesViaAPI,
  analyzeImageViaAPI,
  generateTextResponseViaAPI,
} from '@/services/aiBackendAPI';
import { useUIStore } from '@/stores/uiStore';
import { contextManager } from '@/services/contextManager';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { ossUploadService, dataURLToBlob } from '@/services/ossUploadService';
import type { AIImageResult } from '@/types/ai';
import type {
  ConversationContext,
  OperationHistory,
  SerializedConversationContext
} from '@/types/context';

// 本地存储会话的读取工具（用于无项目或早期回退场景）
const LOCAL_SESSIONS_KEY = 'tanva_aiChat_sessions';
const LOCAL_ACTIVE_KEY = 'tanva_aiChat_activeSessionId';

function readSessionsFromLocalStorage(): { sessions: SerializedConversationContext[]; activeSessionId: string | null } | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LOCAL_SESSIONS_KEY);
    if (!raw) return null;
    const sessions = JSON.parse(raw) as SerializedConversationContext[];
    const activeSessionId = localStorage.getItem(LOCAL_ACTIVE_KEY) || null;
    if (!Array.isArray(sessions) || sessions.length === 0) return null;
    return { sessions, activeSessionId };
  } catch {
    return null;
  }
}

export interface ChatMessage {
  id: string;
  type: 'user' | 'ai' | 'error';
  content: string;
  timestamp: Date;
  imageData?: string;
  sourceImageData?: string;
  sourceImagesData?: string[];
  webSearchResult?: unknown;
}

export interface GenerationStatus {
  isGenerating: boolean;
  progress: number;
  error: string | null;
  stage?: string;
}

export interface ChatSessionSummary {
  sessionId: string;
  name: string;
  lastActivity: Date;
  messageCount: number;
  preview?: string;
}

let hasHydratedSessions = false;

const toISOString = (value: Date | string | number | null | undefined): string => {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const cloneSafely = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) ?? (value as T);

export type ManualAIMode = 'auto' | 'text' | 'generate' | 'edit' | 'blend' | 'analyze';
type AvailableTool = 'generateImage' | 'editImage' | 'blendImages' | 'analyzeImage' | 'chatResponse';

// 🔥 图片上传到 OSS 的辅助函数
async function uploadImageToOSS(imageData: string, projectId?: string | null): Promise<string | null> {
  try {
    if (!imageData || !imageData.includes('base64,')) {
      console.warn('⚠️ 无效的图片数据，跳过上传');
      return null;
    }

    const blob = dataURLToBlob(imageData);
    const result = await ossUploadService.uploadToOSS(blob, {
      dir: 'ai-chat-images/',
      projectId,
      fileName: `ai-chat-${Date.now()}.png`,
      contentType: 'image/png',
      maxSize: 10 * 1024 * 1024, // 10MB
    });

    if (result.success && result.url) {
      console.log('✅ 图片上传成功:', result.url);
      return result.url;
    } else {
      console.error('❌ 图片上传失败:', result.error);
      return null;
    }
  } catch (error) {
    console.error('❌ 图片上传异常:', error);
    return null;
  }
}

const serializeConversation = async (context: ConversationContext): Promise<SerializedConversationContext> => {
  const projectId = useProjectContentStore.getState().projectId;

  // 🔥 优化：只保留最近 5 条带图片的消息，并上传到 OSS
  const messagesWithImages = context.messages.filter(msg => msg.imageData);
  const recentImagesCount = Math.min(5, messagesWithImages.length);
  const recentMessagesWithImages = messagesWithImages.slice(-recentImagesCount);

  // 批量上传图片到 OSS
  const uploadPromises = recentMessagesWithImages.map(async (msg) => {
    if (msg.imageData) {
      const ossUrl = await uploadImageToOSS(msg.imageData, projectId);
      return { messageId: msg.id, ossUrl };
    }
    return { messageId: msg.id, ossUrl: null };
  });

  const uploadResults = await Promise.all(uploadPromises);
  const imageUrlMap = new Map(uploadResults.map(r => [r.messageId, r.ossUrl]));

  return {
    sessionId: context.sessionId,
    name: context.name,
    startTime: toISOString(context.startTime),
    lastActivity: toISOString(context.lastActivity),
    currentMode: context.currentMode,
    activeImageId: context.activeImageId ?? undefined,
    messages: context.messages.map((message) => ({
      id: message.id,
      type: message.type,
      content: message.content,
      timestamp: toISOString(message.timestamp),
      webSearchResult: message.webSearchResult,
      // 🔥 性能优化：只保存 OSS URL，不保存原始 Base64
      imageUrl: imageUrlMap.get(message.id) || undefined,
    })),
    operations: context.operations.map((operation) => ({
      id: operation.id,
      type: operation.type,
      timestamp: toISOString(operation.timestamp),
      input: operation.input,
      output: operation.output,
      success: operation.success,
      metadata: operation.metadata ? cloneSafely(operation.metadata) : null
    })),
    cachedImages: {
      latest: null,
      latestId: context.cachedImages.latestId ?? null,
      latestPrompt: context.cachedImages.latestPrompt ?? null,
      timestamp: context.cachedImages.timestamp ? toISOString(context.cachedImages.timestamp) : null,
      latestBounds: context.cachedImages.latestBounds ?? null,
      latestLayerId: context.cachedImages.latestLayerId ?? null,
      latestRemoteUrl: context.cachedImages.latestRemoteUrl ?? null
    },
    contextInfo: {
      userPreferences: cloneSafely(context.contextInfo.userPreferences ?? {}),
      recentPrompts: [...context.contextInfo.recentPrompts],
      imageHistory: context.contextInfo.imageHistory.map((item) => ({
        id: item.id,
        prompt: item.prompt,
        timestamp: toISOString(item.timestamp),
        operationType: item.operationType,
        parentImageId: item.parentImageId ?? null,
        thumbnail: item.thumbnail ?? null
      })),
      iterationCount: context.contextInfo.iterationCount,
      lastOperationType: context.contextInfo.lastOperationType
    }
  };
};

const deserializeConversation = (data: SerializedConversationContext): ConversationContext => {
  const messages: ChatMessage[] = data.messages.map((message) => ({
    id: message.id,
    type: message.type,
    content: message.content,
    timestamp: new Date(message.timestamp),
    webSearchResult: message.webSearchResult,
    // 🔥 从 OSS URL 恢复图片（如果有的话）
    imageData: (message as any).imageUrl || (message as any).imageData || undefined
  }));

  const operations: OperationHistory[] = data.operations.map((operation) => ({
    id: operation.id,
    type: operation.type,
    timestamp: new Date(operation.timestamp),
    input: operation.input,
    output: operation.output,
    success: operation.success,
    metadata: operation.metadata ?? undefined
  }));

  return {
    sessionId: data.sessionId,
    name: data.name,
    startTime: new Date(data.startTime),
    lastActivity: new Date(data.lastActivity),
    messages,
    operations,
    currentMode: data.currentMode,
    activeImageId: data.activeImageId ?? undefined,
    cachedImages: {
      latest: null,
      latestId: data.cachedImages.latestId ?? null,
      latestPrompt: data.cachedImages.latestPrompt ?? null,
      timestamp: data.cachedImages.timestamp ? new Date(data.cachedImages.timestamp) : null,
      latestBounds: data.cachedImages.latestBounds ?? null,
      latestLayerId: data.cachedImages.latestLayerId ?? null,
      latestRemoteUrl: data.cachedImages.latestRemoteUrl ?? null
    },
    contextInfo: {
      userPreferences: cloneSafely(data.contextInfo.userPreferences ?? {}),
      recentPrompts: [...data.contextInfo.recentPrompts],
      imageHistory: data.contextInfo.imageHistory.map((item) => ({
        id: item.id,
        imageData: '',
        prompt: item.prompt,
        timestamp: new Date(item.timestamp),
        operationType: item.operationType,
        parentImageId: item.parentImageId ?? undefined,
        thumbnail: item.thumbnail ?? undefined
      })),
      iterationCount: data.contextInfo.iterationCount,
      lastOperationType: data.contextInfo.lastOperationType
    }
  };
};

const sessionsEqual = (
  a: SerializedConversationContext[] | undefined,
  b: SerializedConversationContext[]
): boolean => JSON.stringify(a ?? []) === JSON.stringify(b);

interface AIChatState {
  // 对话框状态
  isVisible: boolean;

  // 输入状态
  currentInput: string;

  // 会话管理
  currentSessionId: string | null;
  sessions: ChatSessionSummary[];

  // 生成状态
  generationStatus: GenerationStatus;

  // 消息历史
  messages: ChatMessage[];

  // 最近生成的图像
  lastGeneratedImage: AIImageResult | null;

  // 图生图状态
  sourceImageForEditing: string | null; // 当前用于编辑的源图像

  // 多图融合状态
  sourceImagesForBlending: string[]; // 当前用于融合的多张图像

  // 图像分析状态
  sourceImageForAnalysis: string | null; // 当前用于分析的源图像

  // 配置选项
  autoDownload: boolean;  // 是否自动下载生成的图片
  enableWebSearch: boolean;  // 是否启用联网搜索
  imageOnly: boolean;  // 仅返回图像，不返回文本（适用于图像生成/编辑/融合）
  aspectRatio: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9' | null;  // 图像长宽比
  manualAIMode: ManualAIMode;

  // 操作方法
  showDialog: () => void;
  hideDialog: () => void;
  toggleDialog: () => void;

  // 输入管理
  setCurrentInput: (input: string) => void;
  clearInput: () => void;

  // 消息管理
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  clearMessages: () => void;
  refreshSessions: (options?: { persistToLocal?: boolean; markProjectDirty?: boolean }) => Promise<void>;
  createSession: (name?: string) => Promise<string>;
  switchSession: (sessionId: string) => Promise<void>;
  renameCurrentSession: (name: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  hydratePersistedSessions: (
    sessions: SerializedConversationContext[],
    activeSessionId?: string | null,
    options?: { markProjectDirty?: boolean }
  ) => void;
  resetSessions: () => void;

  // 图像生成
  generateImage: (prompt: string) => Promise<void>;

  // 图生图功能
  editImage: (prompt: string, sourceImage: string, showImagePlaceholder?: boolean) => Promise<void>;
  setSourceImageForEditing: (imageData: string | null) => void;

  // 多图融合功能
  blendImages: (prompt: string, sourceImages: string[]) => Promise<void>;
  addImageForBlending: (imageData: string) => void;
  removeImageFromBlending: (index: number) => void;
  clearImagesForBlending: () => void;

  // 图像分析功能
  analyzeImage: (prompt: string, sourceImage: string) => Promise<void>;
  setSourceImageForAnalysis: (imageData: string | null) => void;

  // 文本对话功能
  generateTextResponse: (prompt: string) => Promise<void>;

  // 智能工具选择功能
  processUserInput: (input: string) => Promise<void>;
  
  // 核心处理流程
  executeProcessFlow: (input: string, isRetry?: boolean) => Promise<void>;

  // 智能模式检测
  getAIMode: () => 'generate' | 'edit' | 'blend' | 'analyze' | 'text';

  // 配置管理
  toggleAutoDownload: () => void;
  setAutoDownload: (value: boolean) => void;
  toggleWebSearch: () => void;
  setWebSearch: (value: boolean) => void;
  toggleImageOnly: () => void;  // 切换仅图像模式
  setImageOnly: (value: boolean) => void;
  setAspectRatio: (ratio: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9' | null) => void;  // 设置长宽比
  setManualAIMode: (mode: ManualAIMode) => void;

  // 重置状态
  resetState: () => void;

  // 🧠 上下文管理方法
  initializeContext: () => void;
  getContextSummary: () => string;
  isIterativeMode: () => boolean;
  enableIterativeMode: () => void;
  disableIterativeMode: () => void;
}

export const useAIChatStore = create<AIChatState>((set, get) => ({
  // 初始状态
  isVisible: true,
  currentInput: '',
  currentSessionId: null,
  sessions: [],
  generationStatus: {
    isGenerating: false,
    progress: 0,
    error: null
  },
  messages: [],
  lastGeneratedImage: null,
  sourceImageForEditing: null,  // 图生图源图像
  sourceImagesForBlending: [],  // 多图融合源图像数组
  sourceImageForAnalysis: null, // 图像分析源图像
  autoDownload: false,  // 默认不自动下载
  enableWebSearch: false,  // 默认关闭联网搜索
  imageOnly: false,  // 默认允许返回文本
  aspectRatio: null,  // 默认不指定长宽比
  manualAIMode: 'auto',

  // 对话框控制
  showDialog: () => set({ isVisible: true }),
  hideDialog: () => set({ isVisible: false }),
  toggleDialog: () => set((state) => ({ isVisible: !state.isVisible })),

  // 输入管理
  setCurrentInput: (input) => set({ currentInput: input }),
  clearInput: () => set({ currentInput: '' }),

  // 消息管理
  addMessage: (message) => {
    let sessionId = get().currentSessionId;

    if (!sessionId) {
      sessionId = contextManager.getCurrentSessionId() || contextManager.createSession();
      set({ currentSessionId: sessionId });
    } else if (contextManager.getCurrentSessionId() !== sessionId) {
      contextManager.switchSession(sessionId);
    }

    let storedMessage: ChatMessage | null = null;
    const context = contextManager.getCurrentContext();
    const lastMessage = context?.messages[context.messages.length - 1];

    if (
      lastMessage &&
      lastMessage.type === message.type &&
      lastMessage.content === message.content
    ) {
      storedMessage = lastMessage;
    }

    if (!storedMessage) {
      storedMessage = contextManager.addMessage(message);
    }

    console.log('📨 添加新消息:', {
      type: storedMessage.type,
      content: storedMessage.content.substring(0, 50) + (storedMessage.content.length > 50 ? '...' : ''),
      id: storedMessage.id
    });

    set((state) => ({
      messages: state.messages.some((msg) => msg.id === storedMessage!.id)
        ? state.messages
        : [...state.messages, storedMessage!]
    }));

    get().refreshSessions();

    console.log('📊 消息列表更新后长度:', get().messages.length);
  },

  clearMessages: () => {
    const state = get();
    const sessionId = state.currentSessionId || contextManager.getCurrentSessionId();
    if (sessionId) {
      const context = contextManager.getSession(sessionId);
      if (context) {
        context.messages = [];
        context.lastActivity = new Date();
      }
    }
    set({ messages: [] });
    get().refreshSessions();
  },

  refreshSessions: async (options) => {
    const { markProjectDirty = true } = options ?? {};
    const listedSessions = contextManager.listSessions();
    const sessionSummaries = listedSessions.map((session) => ({
      sessionId: session.sessionId,
      name: session.name,
      lastActivity: session.lastActivity,
      messageCount: session.messageCount,
      preview: session.preview
    }));

    // 🔥 异步序列化会话（上传图片到 OSS）
    const serializedSessionsPromises = listedSessions
      .map((session) => contextManager.getSession(session.sessionId))
      .filter((context): context is ConversationContext => !!context)
      .map((context) => serializeConversation(context));

    const serializedSessions = await Promise.all(serializedSessionsPromises);

    set({ sessions: sessionSummaries });

    const activeSessionId =
      get().currentSessionId ?? contextManager.getCurrentSessionId() ?? null;

    if (markProjectDirty) {
      const projectStore = useProjectContentStore.getState();
      if (projectStore.projectId && projectStore.hydrated) {
        const previousSessions = projectStore.content?.aiChatSessions ?? [];
        const previousActive = projectStore.content?.aiChatActiveSessionId ?? null;
        if (
          !sessionsEqual(previousSessions, serializedSessions) ||
          (previousActive ?? null) !== (activeSessionId ?? null)
        ) {
          projectStore.updatePartial({
            aiChatSessions: serializedSessions,
            aiChatActiveSessionId: activeSessionId ?? null
          }, { markDirty: true });
        }
      } else {
        // 无项目场景：把会话持久化到本地
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('tanva_aiChat_sessions', JSON.stringify(serializedSessions));
            localStorage.setItem('tanva_aiChat_activeSessionId', activeSessionId ?? '');
          }
        } catch {}
      }
    }
  },

  createSession: async (name) => {
    const sessionId = contextManager.createSession(name);
    const context = contextManager.getCurrentContext();
    set({
      currentSessionId: sessionId,
      messages: context ? [...context.messages] : []
    });
    get().refreshSessions();
    return sessionId;
  },

  switchSession: async (sessionId) => {
    const switched = contextManager.switchSession(sessionId);
    if (!switched) return;
    const context = contextManager.getSession(sessionId);
    set({
      currentSessionId: sessionId,
      messages: context ? [...context.messages] : []
    });
    get().refreshSessions();
  },

  renameCurrentSession: async (name) => {
    const sessionId = get().currentSessionId;
    if (!sessionId) return;
    if (contextManager.renameSession(sessionId, name)) {
      get().refreshSessions();
    }
  },

  deleteSession: async (sessionId) => {
    const removed = contextManager.deleteSession(sessionId);
    if (!removed) return;

    const activeId = contextManager.getCurrentSessionId();
    let nextMessages: ChatMessage[] = [];
    if (activeId) {
      const context = contextManager.getSession(activeId);
      if (context) {
        nextMessages = [...context.messages];
      }
    }

    set({
      currentSessionId: activeId || null,
      messages: nextMessages
    });
    get().refreshSessions();
  },

  hydratePersistedSessions: (sessions, activeSessionId = null, options) => {
    const markProjectDirty = options?.markProjectDirty ?? false;
    hasHydratedSessions = true;

    contextManager.resetSessions();

    sessions.forEach((session) => {
      try {
        const context = deserializeConversation(session);
        contextManager.importSessionData(context);
      } catch (error) {
        console.error('❌ 导入会话失败:', error);
      }
    });

    const availableSessions = contextManager.listSessions();
    const candidateIds = new Set(availableSessions.map((session) => session.sessionId));

    let targetSessionId: string | null = null;
    if (activeSessionId && candidateIds.has(activeSessionId)) {
      contextManager.switchSession(activeSessionId);
      targetSessionId = activeSessionId;
    } else if (availableSessions.length > 0) {
      const fallbackId = availableSessions[0].sessionId;
      contextManager.switchSession(fallbackId);
      targetSessionId = fallbackId;
    }

    if (!targetSessionId) {
      targetSessionId = contextManager.createSession();
    }

    const context = targetSessionId ? contextManager.getSession(targetSessionId) : null;
    set({
      currentSessionId: targetSessionId,
      messages: context ? [...context.messages] : []
    });

    get().refreshSessions({ markProjectDirty });
  },

  resetSessions: () => {
    contextManager.resetSessions();

    const sessionId = contextManager.createSession();
    const context = contextManager.getSession(sessionId);
    set({
      currentSessionId: sessionId,
      messages: context ? [...context.messages] : []
    });
    hasHydratedSessions = true;
    get().refreshSessions({ markProjectDirty: false });
  },

  // 图像生成主函数
  generateImage: async (prompt: string) => {
    const state = get();

    // 注意：这个方法可能被 processUserInput 调用，processUserInput 已经设置了 isGenerating = true
    // 所以这里不需要再检查 isGenerating

    // 添加用户消息
    state.addMessage({
      type: 'user',
      content: prompt
    });

    // 设置生成状态 - 保持或增加当前进度
    set((state) => ({
      generationStatus: {
        isGenerating: true,
        progress: Math.max(state.generationStatus.progress, 15),
        error: null
      }
    }));

    try {
      // 模拟进度更新
      const progressInterval = setInterval(() => {
        const currentState = get();
        if (currentState.generationStatus.progress < 90) {
          set({
            generationStatus: {
              ...currentState.generationStatus,
              progress: currentState.generationStatus.progress + 10
            }
          });
        }
      }, 500);

      // 调用后端API生成图像
      const result = await generateImageViaAPI({
        prompt,
        outputFormat: 'png',
        aspectRatio: state.aspectRatio || undefined,  // 传递长宽比
        imageOnly: state.imageOnly  // 传递仅图像模式
      });

      clearInterval(progressInterval);

      if (result.success && result.data) {
        // 生成成功
        set({
          generationStatus: {
            isGenerating: false,
            progress: 100,
            error: null
          },
          lastGeneratedImage: result.data
        });

        // 添加AI响应消息
        const messageContent = result.data.textResponse || 
          (result.data.hasImage ? `已生成图像: ${prompt}` : `无法生成图像: ${prompt}`);
        
        state.addMessage({
          type: 'ai',
          content: messageContent, // 优先使用API的真实文本回复
          imageData: result.data.imageData
        });

        // 如果没有图像，记录详细原因并返回
        if (!result.data.hasImage) {
          console.warn('⚠️ API返回了文本回复但没有图像，详细信息:', {
            文本回复: result.data.textResponse,
            图像数据存在: !!result.data.imageData,
            图像数据长度: result.data.imageData?.length || 0,
            hasImage标志: result.data.hasImage,
            生成提示: result.data.prompt
          });
          return;
        }

        // 可选：自动下载图片到用户的默认下载文件夹
        const downloadImageData = (imageData: string, prompt: string, autoDownload: boolean = false) => {
          if (!autoDownload) {
            console.log('⏭️ 跳过自动下载，图片将直接添加到画布');
            return;
          }

          try {
            const mimeType = `image/${result.data?.metadata?.outputFormat || 'png'}`;
            const imageDataUrl = `data:${mimeType};base64,${imageData}`;

            const link = document.createElement('a');
            link.href = imageDataUrl;

            // 生成文件名
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const promptSafeString = prompt.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').substring(0, 30);
            const extension = result.data?.metadata?.outputFormat || 'png';

            link.download = `ai_generated_${promptSafeString}_${timestamp}.${extension}`;

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            console.log('✅ 图像下载已开始:', link.download);
          } catch (error) {
            console.error('❌ 下载图像失败:', error);
          }
        };

        // 根据配置决定是否自动下载（仅当有图像时）
        const currentState = get();
        if (result.data.imageData) {
          downloadImageData(result.data.imageData, prompt, currentState.autoDownload);
        }

        // 自动添加到画布中央 - 使用快速上传工具的逻辑（仅当有图像时）
        const addImageToCanvas = (aiResult: AIImageResult) => {
          if (!aiResult.imageData) {
            console.log('⚠️ 跳过画布添加：没有图像数据');
            return;
          }
          
          // 构建图像数据URL
          const mimeType = `image/${aiResult.metadata?.outputFormat || 'png'}`;
          const imageDataUrl = `data:${mimeType};base64,${aiResult.imageData}`;
          const fileName = `ai_generated_${prompt.substring(0, 20)}.${aiResult.metadata?.outputFormat || 'png'}`;

          // 计算智能位置：基于缓存图片中心 → 向下（偏移量由 smartPlacementOffset 决定）
          let smartPosition: { x: number; y: number } | undefined = undefined;
          try {
            const cached = contextManager.getCachedImage();
            if (cached?.bounds) {
              const cx = cached.bounds.x + cached.bounds.width / 2;
              const cy = cached.bounds.y + cached.bounds.height / 2;
              const offset = useUIStore.getState().smartPlacementOffset || 778;
              smartPosition = { x: cx, y: cy + offset };
              console.log('📍 生成图智能位置(相对缓存 → 下移)', offset, 'px:', smartPosition);
            } else {
              console.log('📍 无缓存位置，按默认策略放置');
            }
          } catch (e) {
            console.warn('计算生成图智能位置失败:', e);
          }

          // 直接触发快速上传事件，复用现有的上传逻辑，添加智能排版信息
          window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
            detail: {
              imageData: imageDataUrl,
              fileName: fileName,
              operationType: 'generate',
              smartPosition,
              sourceImageId: undefined,
              sourceImages: undefined
            }
          }));
          console.log('📋 已触发快速图片上传事件，使用智能排版 (操作类型: generate)');
        };

        // 自动添加到画布
        setTimeout(() => {
          if (result.data) {
            addImageToCanvas(result.data);
          }
        }, 100); // 短暂延迟，确保UI更新

        console.log('✅ 图像生成成功，已自动添加到画布', {
          imageDataLength: result.data.imageData?.length,
          prompt: result.data.prompt,
          model: result.data.model,
          id: result.data.id,
          createdAt: result.data.createdAt,
          metadata: result.data.metadata
        });

        // 取消自动关闭对话框 - 保持对话框打开状态
        // setTimeout(() => {
        //   get().hideDialog();
        //   console.log('🔄 AI对话框已自动关闭');
        // }, 100); // 延迟0.1秒关闭，让用户看到生成完成的消息

      } else {
        // 生成失败
        const errorMessage = result.error?.message || '图像生成失败';

        set({
          generationStatus: {
            isGenerating: false,
            progress: 0,
            error: errorMessage
          }
        });

        // 添加错误消息
        state.addMessage({
          type: 'error',
          content: errorMessage
        });

        console.error('❌ 图像生成失败:', errorMessage);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';

      set({
        generationStatus: {
          isGenerating: false,
          progress: 0,
          error: errorMessage
        }
      });

      // 添加错误消息
      state.addMessage({
        type: 'error',
        content: `生成失败: ${errorMessage}`
      });

      console.error('❌ 图像生成异常:', error);
    }
  },

  // 图生图功能
  editImage: async (prompt: string, sourceImage: string, showImagePlaceholder: boolean = true) => {
    const state = get();

    // 注意：这个方法可能被 processUserInput 调用，processUserInput 已经设置了 isGenerating = true
    // 所以这里不需要再检查 isGenerating

    // 添加用户消息（根据参数决定是否包含源图像）
    const messageData: any = {
      type: 'user',
      content: `编辑图像: ${prompt}`,
    };
    
    // 只有在需要显示图片占位框时才添加 sourceImageData
    if (showImagePlaceholder) {
      messageData.sourceImageData = sourceImage;
    }
    
    state.addMessage(messageData);

    // 设置生成状态 - 保持或增加当前进度
    set((state) => ({
      generationStatus: {
        isGenerating: true,
        progress: Math.max(state.generationStatus.progress, 15),
        error: null
      }
    }));

    try {
      // 模拟进度更新
      const progressInterval = setInterval(() => {
        const currentState = get();
        if (currentState.generationStatus.progress < 90) {
          set({
            generationStatus: {
              ...currentState.generationStatus,
              progress: currentState.generationStatus.progress + 10
            }
          });
        }
      }, 500);

      // 调用后端API编辑图像
      const result = await editImageViaAPI({
        prompt,
        sourceImage,
        outputFormat: 'png',
        aspectRatio: state.aspectRatio || undefined,  // 传递长宽比
        imageOnly: state.imageOnly  // 传递仅图像模式
      });

      clearInterval(progressInterval);

      if (result.success && result.data) {
        // 编辑成功
        set({
          generationStatus: {
            isGenerating: false,
            progress: 100,
            error: null
          },
          lastGeneratedImage: result.data
        });

        // 添加AI响应消息
        const messageContent = result.data.textResponse || 
          (result.data.hasImage ? `已编辑图像: ${prompt}` : `无法编辑图像: ${prompt}`);
          
        state.addMessage({
          type: 'ai',
          content: messageContent, // 优先使用API的真实文本回复
          imageData: result.data.imageData
        });

        // 如果没有图像，记录原因并返回
        if (!result.data.hasImage) {
          console.log('⚠️ 编辑API返回了文本回复但没有图像:', result.data.textResponse);
          return;
        }

        // 自动添加到画布
        const addImageToCanvas = (aiResult: AIImageResult) => {
          if (!aiResult.imageData) {
            console.log('⚠️ 跳过编辑图像画布添加：没有图像数据');
            return;
          }
          
          const mimeType = `image/${aiResult.metadata?.outputFormat || 'png'}`;
          const imageDataUrl = `data:${mimeType};base64,${aiResult.imageData}`;
          const fileName = `ai_edited_${prompt.substring(0, 20)}.${aiResult.metadata?.outputFormat || 'png'}`;

          // 🎯 获取当前选中图片的ID和边界信息用于智能排版
          let selectedImageBounds = null;
          let sourceImageId = null;
          try {
            if ((window as any).tanvaImageInstances) {
              const selectedImage = (window as any).tanvaImageInstances.find((img: any) => img.isSelected);
              if (selectedImage) {
                selectedImageBounds = selectedImage.bounds;
                sourceImageId = selectedImage.id;
                console.log('🎯 发现选中图片，ID:', sourceImageId, '边界:', selectedImageBounds);
              }
            }
          } catch (error) {
            console.warn('获取选中图片信息失败:', error);
          }

          // 计算智能位置：基于缓存图片中心 → 向右（偏移量由 smartPlacementOffset 决定）
          let smartPosition: { x: number; y: number } | undefined = undefined;
          try {
            const cached = contextManager.getCachedImage();
            if (cached?.bounds) {
              const cx = cached.bounds.x + cached.bounds.width / 2;
              const cy = cached.bounds.y + cached.bounds.height / 2;
              const offset = useUIStore.getState().smartPlacementOffset || 778;
              smartPosition = { x: cx + offset, y: cy };
              console.log('📍 编辑产出智能位置(相对缓存 → 右移)', offset, 'px:', smartPosition);
            } else if (selectedImageBounds) {
              // 兼容：若无缓存但传入了选中图片边界，则基于选中图向右
              const cx = selectedImageBounds.x + selectedImageBounds.width / 2;
              const cy = selectedImageBounds.y + selectedImageBounds.height / 2;
              const offset = useUIStore.getState().smartPlacementOffset || 778;
              smartPosition = { x: cx + offset, y: cy };
              console.log('📍 编辑产出智能位置(相对选中图 → 右移)', offset, 'px:', smartPosition);
            } else {
              console.log('📍 无缓存和选中边界，按默认策略放置');
            }
          } catch (e) {
            console.warn('计算编辑产出智能位置失败:', e);
          }

          window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
            detail: {
              imageData: imageDataUrl,
              fileName: fileName,
              selectedImageBounds: selectedImageBounds,  // 保持兼容性
              operationType: 'edit',
              smartPosition,
              sourceImageId: sourceImageId,
              sourceImages: undefined
            }
          }));

          const targetInfo = sourceImageId ? `选中图片${sourceImageId}下方` : '默认位置';
          console.log(`📋 已触发快速图片上传事件，使用智能排版 (操作类型: edit, 目标位置: ${targetInfo})`);
        };

        setTimeout(() => {
          if (result.data) {
            addImageToCanvas(result.data);
          }
        }, 100);

        console.log('✅ 图像编辑成功，已自动添加到画布', {
          imageDataLength: result.data.imageData?.length,
          prompt: result.data.prompt,
          model: result.data.model,
          id: result.data.id
        });

        // 取消自动关闭对话框 - 保持对话框打开状态
        // setTimeout(() => {
        //   get().hideDialog();
        //   console.log('🔄 AI对话框已自动关闭');
        // }, 100); // 延迟0.1秒关闭，让用户看到编辑完成的消息

      } else {
        // 编辑失败
        const errorMessage = result.error?.message || '图像编辑失败';

        set({
          generationStatus: {
            isGenerating: false,
            progress: 0,
            error: errorMessage
          }
        });

        state.addMessage({
          type: 'error',
          content: errorMessage
        });

        console.error('❌ 图像编辑失败:', errorMessage);
      }

    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : '未知错误';
      
      // 🔒 安全检查：防止Base64图像数据被当作错误消息
      if (errorMessage && errorMessage.length > 1000 && errorMessage.includes('iVBORw0KGgo')) {
        console.warn('⚠️ 检测到Base64图像数据被当作错误消息，使用默认错误信息');
        errorMessage = '图像编辑失败，请重试';
      }

      set({
        generationStatus: {
          isGenerating: false,
          progress: 0,
          error: errorMessage
        }
      });

      state.addMessage({
        type: 'error',
        content: `编辑失败: ${errorMessage}`
      });

      console.error('❌ 图像编辑异常:', error);
    }
  },

  setSourceImageForEditing: (imageData: string | null) => {
    set({ sourceImageForEditing: imageData });
    
    // 🔥 立即缓存用户上传的图片
    if (imageData) {
      const imageId = `user_upload_${Date.now()}`;
      contextManager.cacheLatestImage(imageData, imageId, '用户上传的图片');
      console.log('📸 用户上传图片已缓存:', imageId);
    }
  },

  // 多图融合功能
  blendImages: async (prompt: string, sourceImages: string[]) => {
    const state = get();

    // 注意：这个方法可能被 processUserInput 调用，processUserInput 已经设置了 isGenerating = true
    // 所以这里不需要再检查 isGenerating

    state.addMessage({
      type: 'user',
      content: `融合图像: ${prompt}`,
      sourceImagesData: sourceImages
    });

    set((state) => ({
      generationStatus: {
        isGenerating: true,
        progress: Math.max(state.generationStatus.progress, 15),
        error: null
      }
    }));

    try {
      const progressInterval = setInterval(() => {
        const currentState = get();
        if (currentState.generationStatus.progress < 90) {
          set({
            generationStatus: {
              ...currentState.generationStatus,
              progress: currentState.generationStatus.progress + 10
            }
          });
        }
      }, 500);

      const result = await blendImagesViaAPI({
        prompt,
        sourceImages,
        outputFormat: 'png',
        aspectRatio: state.aspectRatio || undefined,  // 传递长宽比
        imageOnly: state.imageOnly  // 传递仅图像模式
      });

      clearInterval(progressInterval);

      if (result.success && result.data) {
        set({
          generationStatus: {
            isGenerating: false,
            progress: 100,
            error: null
          },
          lastGeneratedImage: result.data
        });

        // 添加AI响应消息
        const messageContent = result.data.textResponse || 
          (result.data.hasImage ? `已融合图像: ${prompt}` : `无法融合图像: ${prompt}`);
          
        state.addMessage({
          type: 'ai',
          content: messageContent, // 优先使用API的真实文本回复
          imageData: result.data.imageData
        });

        // 如果没有图像，记录原因并返回
        if (!result.data.hasImage) {
          console.log('⚠️ 融合API返回了文本回复但没有图像:', result.data.textResponse);
          return;
        }

        const addImageToCanvas = (aiResult: AIImageResult) => {
          if (!aiResult.imageData) {
            console.log('⚠️ 跳过融合图像画布添加：没有图像数据');
            return;
          }
          
          const mimeType = `image/${aiResult.metadata?.outputFormat || 'png'}`;
          const imageDataUrl = `data:${mimeType};base64,${aiResult.imageData}`;
          const fileName = `ai_blended_${prompt.substring(0, 20)}.${aiResult.metadata?.outputFormat || 'png'}`;

          // 🎯 获取源图像ID列表用于智能排版
          let sourceImageIds: string[] = [];
          try {
            if ((window as any).tanvaImageInstances) {
              const selectedImages = (window as any).tanvaImageInstances.filter((img: any) => img.isSelected);
              sourceImageIds = selectedImages.map((img: any) => img.id);
              console.log('🎯 发现选中的源图像IDs:', sourceImageIds);
            }
          } catch (error) {
            console.warn('获取源图像IDs失败:', error);
          }

          window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
            detail: {
              imageData: imageDataUrl,
              fileName: fileName,
              operationType: 'blend',
              smartPosition: (() => {
                try {
                  const cached = contextManager.getCachedImage();
                  if (cached?.bounds) {
                    const cx = cached.bounds.x + cached.bounds.width / 2;
                    const cy = cached.bounds.y + cached.bounds.height / 2;
                    const offset = useUIStore.getState().smartPlacementOffset || 778;
                    const pos = { x: cx + offset, y: cy };
                    console.log('📍 融合产出智能位置(相对缓存 → 右移)', offset, 'px:', pos);
                    return pos;
                  }
                } catch (e) {
                  console.warn('计算融合产出智能位置失败:', e);
                }
                return undefined;
              })(),
              sourceImageId: undefined,
              sourceImages: sourceImageIds.length > 0 ? sourceImageIds : undefined
            }
          }));
          
          const targetInfo = sourceImageIds.length > 0 ? `第一张源图像${sourceImageIds[0]}下方` : '默认位置';
          console.log(`📋 已触发快速图片上传事件，使用智能排版 (操作类型: blend, 目标位置: ${targetInfo})`);
        };

        setTimeout(() => {
          if (result.data) {
            addImageToCanvas(result.data);
          }
        }, 100);

        console.log('✅ 图像融合成功，已自动添加到画布');

        // 取消自动关闭对话框 - 保持对话框打开状态
        // setTimeout(() => {
        //   get().hideDialog();
        //   console.log('🔄 AI对话框已自动关闭');
        // }, 100); // 延迟0.1秒关闭，让用户看到融合完成的消息

      } else {
        const errorMessage = result.error?.message || '图像融合失败';
        set({
          generationStatus: {
            isGenerating: false,
            progress: 0,
            error: errorMessage
          }
        });

        state.addMessage({
          type: 'error',
          content: errorMessage
        });
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      set({
        generationStatus: {
          isGenerating: false,
          progress: 0,
          error: errorMessage
        }
      });

      state.addMessage({
        type: 'error',
        content: `融合失败: ${errorMessage}`
      });
    }
  },

  addImageForBlending: (imageData: string) => {
    set((state) => ({
      sourceImagesForBlending: [...state.sourceImagesForBlending, imageData]
    }));
    
    // 🔥 立即缓存用户上传的融合图片（缓存最后一张）
    const imageId = `user_blend_upload_${Date.now()}`;
    contextManager.cacheLatestImage(imageData, imageId, '用户上传的融合图片');
    console.log('📸 用户融合图片已缓存:', imageId);
  },

  removeImageFromBlending: (index: number) => {
    set((state) => ({
      sourceImagesForBlending: state.sourceImagesForBlending.filter((_, i) => i !== index)
    }));
  },

  clearImagesForBlending: () => {
    set({ sourceImagesForBlending: [] });
  },

  // 图像分析功能
  analyzeImage: async (prompt: string, sourceImage: string) => {
    const state = get();

    // 注意：这个方法可能被 processUserInput 调用，processUserInput 已经设置了 isGenerating = true
    // 所以这里不需要再检查 isGenerating

    // 添加用户消息（包含源图像）
    // 确保图像数据有正确的data URL前缀
    const formattedImageData = sourceImage.startsWith('data:image') 
      ? sourceImage 
      : `data:image/png;base64,${sourceImage}`;
      
    state.addMessage({
      type: 'user',
      content: prompt ? `分析图片: ${prompt}` : '分析这张图片',
      sourceImageData: formattedImageData
    });

    set((state) => ({
      generationStatus: {
        isGenerating: true,
        progress: Math.max(state.generationStatus.progress, 15),
        error: null
      }
    }));

    try {
      // 模拟进度更新
      const progressInterval = setInterval(() => {
        const currentState = get();
        if (currentState.generationStatus.progress < 90) {
          set({
            generationStatus: {
              ...currentState.generationStatus,
              progress: currentState.generationStatus.progress + 15
            }
          });
        }
      }, 300);

      // 调用后端API分析图像
      const result = await analyzeImageViaAPI({
        prompt: prompt || '请详细分析这张图片的内容',
        sourceImage,
      });

      clearInterval(progressInterval);

      if (result.success && result.data) {
        set({
          generationStatus: {
            isGenerating: false,
            progress: 100,
            error: null
          }
        });

        // 添加AI分析结果
        state.addMessage({
          type: 'ai',
          content: result.data.analysis
        });

        console.log('✅ 图片分析成功');

      } else {
        throw new Error(result.error?.message || '图片分析失败');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';

      set({
        generationStatus: {
          isGenerating: false,
          progress: 0,
          error: errorMessage
        }
      });

      state.addMessage({
        type: 'error',
        content: `分析失败: ${errorMessage}`
      });

      console.error('❌ 图片分析异常:', error);
    }
  },

  setSourceImageForAnalysis: (imageData: string | null) => {
    set({ sourceImageForAnalysis: imageData });
    
    // 🔥 立即缓存用户上传的分析图片
    if (imageData) {
      const imageId = `user_analysis_upload_${Date.now()}`;
      contextManager.cacheLatestImage(imageData, imageId, '用户上传的分析图片');
      console.log('📸 用户分析图片已缓存:', imageId);
    }
  },

  // 文本对话功能
  generateTextResponse: async (prompt: string) => {
    // 注意：这个方法是被 processUserInput 调用的，所以不需要再次检查 isGenerating
    // 因为 processUserInput 已经设置了 isGenerating = true

    // 添加用户消息
    get().addMessage({
      type: 'user',
      content: prompt
    });

    // 更新进度，但保持 isGenerating 状态（已由 processUserInput 设置）
    set((state) => ({
      generationStatus: {
        ...state.generationStatus,
        progress: 50, // 文本生成通常很快
        stage: '正在生成文本回复...'
      }
    }));

    try {
      // 调用后端API生成文本
      const state = get();
      const result = await generateTextResponseViaAPI({
        prompt,
        enableWebSearch: state.enableWebSearch
      });

      if (result.success && result.data) {
        set({
          generationStatus: {
            isGenerating: false,
            progress: 100,
            error: null
          }
        });

        get().addMessage({
          type: 'ai',
          content: result.data.text,
          webSearchResult: result.data.webSearchResult
        });

        console.log('✅ 文本回复成功:', result.data.text);
      } else {
        throw new Error(result.error?.message || '文本生成失败');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';

      set({
        generationStatus: {
          isGenerating: false,
          progress: 0,
          error: errorMessage
        }
      });

      get().addMessage({
        type: 'error',
        content: `回复失败: ${errorMessage}`
      });

      console.error('❌ 文本生成失败:', errorMessage);
    }
  },

  // 🔄 核心处理流程 - 可重试的执行逻辑
  executeProcessFlow: async (input: string, isRetry: boolean = false) => {
    const state = get();

    // 检测迭代意图
    const isIterative = contextManager.detectIterativeIntent(input);
    if (isIterative && !isRetry) {
      contextManager.incrementIteration();
      console.log('🔄 检测到迭代优化意图');
    }

    // 准备工具选择请求
    const cachedImage = contextManager.getCachedImage();
    
    // 计算显式图片数量（不包含缓存图片）
    let explicitImageCount = 0;
    
    // 计算融合模式的图片数量
    if (state.sourceImagesForBlending.length > 0) {
      explicitImageCount += state.sourceImagesForBlending.length;
    }
    
    // 如果有编辑图片，计入总数
    if (state.sourceImageForEditing) {
      explicitImageCount += 1;
    }
    
    // 如果有分析图片，计入总数
    if (state.sourceImageForAnalysis) {
      explicitImageCount += 1;
    }
    
    // 总图像数量 = 显式图片 + 缓存图片（如果存在）
    const totalImageCount = explicitImageCount + (cachedImage ? 1 : 0);
    
    const toolSelectionRequest = {
      userInput: input,
      hasImages: totalImageCount > 0,
      imageCount: explicitImageCount, // 传递显式图片数量，不包含缓存
      hasCachedImage: !!cachedImage,  // 单独标记是否有缓存图片
      availableTools: ['generateImage', 'editImage', 'blendImages', 'analyzeImage', 'chatResponse']
    };

    console.log('🔍 工具选择调试信息:', {
      userInput: input,
      hasImages: toolSelectionRequest.hasImages,
      显式图片数量: explicitImageCount,
      总图片数量: totalImageCount,
      isRetry: isRetry,
      详细: {
        融合图片数量: state.sourceImagesForBlending.length,
        编辑图片: state.sourceImageForEditing ? '有' : '无',
        分析图片: state.sourceImageForAnalysis ? '有' : '无',
        缓存图片: cachedImage ? `ID: ${cachedImage.imageId}` : '无'
      }
    });

    // 根据手动模式或AI选择工具
    const manualMode = state.manualAIMode;
    const manualToolMap: Record<ManualAIMode, AvailableTool | null> = {
      auto: null,
      text: 'chatResponse',
      generate: 'generateImage',
      edit: 'editImage',
      blend: 'blendImages',
      analyze: 'analyzeImage'
    };

    let selectedTool: AvailableTool | null = null;
    let parameters: { prompt: string } = { prompt: input };

    if (manualMode !== 'auto') {
      selectedTool = manualToolMap[manualMode];
      console.log('🎛️ 手动模式直接选择工具:', manualMode, '→', selectedTool);
    } else {
      const toolSelectionResult = await aiImageService.selectTool(toolSelectionRequest);

      if (!toolSelectionResult.success || !toolSelectionResult.data) {
        const errorMsg = toolSelectionResult.error?.message || '工具选择失败';
        console.error('❌ 工具选择失败:', errorMsg);
        throw new Error(errorMsg);
      }

      selectedTool = toolSelectionResult.data.selectedTool;
      parameters = toolSelectionResult.data.parameters;

      console.log('🎯 AI选择工具:', selectedTool);
    }

    if (!selectedTool) {
      throw new Error('未选择执行工具');
    }

    // 根据选择的工具执行相应操作
    // 获取最新的 store 实例来调用方法
    const store = get();

    switch (selectedTool) {
      case 'generateImage':
        await store.generateImage(parameters.prompt);
        break;

      case 'editImage':
        if (state.sourceImageForEditing) {
          console.log('🖼️ 使用显式图像进行编辑:', {
            imageDataLength: state.sourceImageForEditing.length,
            imageDataPrefix: state.sourceImageForEditing.substring(0, 50),
            isBase64: state.sourceImageForEditing.startsWith('data:image')
          });
          await store.editImage(parameters.prompt, state.sourceImageForEditing);
          
          // 🧠 检测是否需要保持编辑状态
          if (!isIterative) {
            store.setSourceImageForEditing(null);
            contextManager.resetIteration();
          }
        } else {
          // 🖼️ 检查是否有缓存的图像可以编辑
          const cachedImage = contextManager.getCachedImage();
          console.log('🔍 editImage case 调试:', {
            hasSourceImage: !!state.sourceImageForEditing,
            cachedImage: cachedImage ? `ID: ${cachedImage.imageId}` : 'none',
            input: input
          });
          
          if (cachedImage) {
            console.log('🖼️ 使用缓存的图像进行编辑:', {
              imageId: cachedImage.imageId,
              imageDataLength: cachedImage.imageData.length,
              imageDataPrefix: cachedImage.imageData.substring(0, 50),
              isBase64: cachedImage.imageData.startsWith('data:image')
            });
            await store.editImage(parameters.prompt, cachedImage.imageData, false); // 不显示图片占位框
          } else {
            console.error('❌ 无法编辑图像的原因:', {
              cachedImage: cachedImage ? 'exists' : 'null',
              input: input
            });
            throw new Error('没有可编辑的图像');
          }
        }
        break;

      case 'blendImages':
        if (state.sourceImagesForBlending.length >= 2) {
          await store.blendImages(parameters.prompt, state.sourceImagesForBlending);
          store.clearImagesForBlending();
        } else {
          throw new Error('需要至少2张图像进行融合');
        }
        break;

      case 'analyzeImage':
        if (state.sourceImageForAnalysis) {
          await store.analyzeImage(parameters.prompt || input, state.sourceImageForAnalysis);
          store.setSourceImageForAnalysis(null);
        } else if (state.sourceImageForEditing) {
          await store.analyzeImage(parameters.prompt || input, state.sourceImageForEditing);
          // 分析后不清除图像，用户可能还想编辑
        } else {
          // 🖼️ 检查是否有缓存的图像可以分析
          const cachedImage = contextManager.getCachedImage();
          if (cachedImage) {
            console.log('🖼️ 使用缓存的图像进行分析:', cachedImage.imageId);
            await store.analyzeImage(parameters.prompt || input, cachedImage.imageData);
          } else {
            throw new Error('没有可分析的图像');
          }
        }
        break;

      case 'chatResponse':
        console.log('🎯 执行文本对话，参数:', parameters.prompt);
        console.log('🔧 调用 generateTextResponse 方法...');
        console.log('🔧 store 对象:', store);
        console.log('🔧 generateTextResponse 方法存在:', typeof store.generateTextResponse);
        try {
          const result = await store.generateTextResponse(parameters.prompt);
          console.log('✅ generateTextResponse 执行完成，返回值:', result);
        } catch (error) {
          console.error('❌ generateTextResponse 执行失败:', error);
          if (error instanceof Error) {
            console.error('❌ 错误堆栈:', error.stack);
          }
          throw error;
        }
        break;

      default:
        throw new Error(`未知工具: ${selectedTool}`);
    }
  },

  // 智能工具选择功能 - 统一入口
  processUserInput: async (input: string) => {
    const state = get();

    if (state.generationStatus.isGenerating) return;

    // 🧠 确保有活跃的会话并同步状态
    let sessionId = state.currentSessionId || contextManager.getCurrentSessionId();
    if (!sessionId) {
      sessionId = contextManager.createSession();
    } else if (contextManager.getCurrentSessionId() !== sessionId) {
      contextManager.switchSession(sessionId);
    }

    if (sessionId !== state.currentSessionId) {
      const context = contextManager.getSession(sessionId);
      set({
        currentSessionId: sessionId,
        messages: context ? [...context.messages] : []
      });
    }

    get().refreshSessions();

    console.log('🤖 智能处理用户输入...');

    // 显示工具选择进度 - 从0开始
    set({
      generationStatus: {
        isGenerating: true,
        progress: 0,
        error: null
      }
    });

    // 短暂延迟后动画过渡到10%
    setTimeout(() => {
      set((state) => ({
        generationStatus: {
          ...state.generationStatus,
          progress: 10
        }
      }));
    }, 100);

    try {
      // 执行核心处理流程
      await get().executeProcessFlow(input, false);

    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : '处理失败';
      
      // 🔒 安全检查：防止Base64图像数据被当作错误消息
      if (errorMessage && errorMessage.length > 1000 && errorMessage.includes('iVBORw0KGgo')) {
        console.warn('⚠️ 检测到Base64图像数据被当作错误消息，使用默认错误信息');
        errorMessage = '图像处理失败，请重试';
      }

      // 正常处理错误
      set({
        generationStatus: {
          isGenerating: false,
          progress: 0,
          error: errorMessage
        }
      });

      get().addMessage({
        type: 'error',
        content: `处理失败: ${errorMessage}`
      });

      console.error('❌ 智能处理异常:', error);
    }
  },

  getAIMode: () => {
    const state = get();
    if (state.manualAIMode && state.manualAIMode !== 'auto') {
      if (state.manualAIMode === 'text') return 'text';
      return state.manualAIMode;
    }
    if (state.sourceImagesForBlending.length >= 2) return 'blend';
    if (state.sourceImageForEditing) return 'edit';
    if (state.sourceImageForAnalysis) return 'analyze';
    return 'generate';
  },

  // 配置管理
  toggleAutoDownload: () => set((state) => ({ autoDownload: !state.autoDownload })),
  setAutoDownload: (value: boolean) => set({ autoDownload: value }),
  toggleWebSearch: () => set((state) => ({ enableWebSearch: !state.enableWebSearch })),
  setWebSearch: (value: boolean) => set({ enableWebSearch: value }),
  toggleImageOnly: () => set((state) => ({ imageOnly: !state.imageOnly })),
  setImageOnly: (value: boolean) => set({ imageOnly: value }),
  setAspectRatio: (ratio) => set({ aspectRatio: ratio }),
  setManualAIMode: (mode) => set({ manualAIMode: mode }),

  // 重置状态
  resetState: () => {
    set({
      isVisible: false,
      currentInput: '',
      generationStatus: {
        isGenerating: false,
        progress: 0,
        error: null
      },
      messages: [],
      lastGeneratedImage: null,
      sourceImageForEditing: null,
      sourceImagesForBlending: [],
      sourceImageForAnalysis: null
    });
  },

  // 🧠 上下文管理方法实现
  initializeContext: () => {
    if (!hasHydratedSessions) {
      const stored = readSessionsFromLocalStorage();
      if (stored && stored.sessions.length > 0) {
        get().hydratePersistedSessions(stored.sessions, stored.activeSessionId, { markProjectDirty: false });
      }
    }

    let sessionId = contextManager.getCurrentSessionId();
    if (!sessionId) {
      const existingSessions = contextManager.listSessions();
      if (existingSessions.length > 0) {
        sessionId = existingSessions[0].sessionId;
        contextManager.switchSession(sessionId);
      } else {
        sessionId = contextManager.createSession();
      }
    }

    const context = sessionId ? contextManager.getSession(sessionId) : null;
    set({
      currentSessionId: sessionId,
      messages: context ? [...context.messages] : []
    });
    hasHydratedSessions = true;
    get().refreshSessions({ markProjectDirty: false });
    console.log('🧠 初始化上下文会话:', sessionId);
  },

  getContextSummary: () => {
    return contextManager.getSessionSummary();
  },

  isIterativeMode: () => {
    const context = contextManager.getCurrentContext();
    return context ? context.contextInfo.iterationCount > 0 : false;
  },

  enableIterativeMode: () => {
    contextManager.incrementIteration();
    console.log('🔄 启用迭代模式');
  },

  disableIterativeMode: () => {
    contextManager.resetIteration();
    console.log('🔄 禁用迭代模式');
  },

}));
