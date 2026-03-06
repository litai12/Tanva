/**
 * 上下文记忆管理器
 * 负责管理AI对话的上下文和历史记录
 */

import type {
  ConversationContext,
  OperationHistory,
  ImageHistory,
  IContextManager,
  ContextConfig,
} from "@/types/context";
import type { ChatMessage } from "@/stores/aiChatStore";
import { DEFAULT_CONTEXT_CONFIG } from "@/types/context";

// 内存优化配置
const MEMORY_OPTIMIZATION = {
  maxSessions: 20, // 最多保留20个会话
  maxMessagesPerSession: 100, // 每个会话最多100条消息
  maxImageCacheSize: 2 * 1024 * 1024, // 图片缓存最大阈值降低到2MB (P0 优化)
  maxVideoMessagesPerSession: 20, // 每个会话最多保留20条视频消息
  videoExpiryMs: 24 * 60 * 60 * 1000, // 视频消息24小时后过期
  cleanupIntervalMs: 5 * 60 * 1000, // 每5分钟清理一次
  sessionTimeoutMs: 24 * 60 * 60 * 1000, // 24小时超时
};

// 检查是否为 base64 数据
const isBase64Data = (data?: string | null): boolean => {
  if (!data) return false;
  return (
    data.startsWith("data:image/") ||
    (data.length > 10000 && !data.startsWith("http"))
  );
};

class ContextManager implements IContextManager {
  private contexts: Map<string, ConversationContext> = new Map();
  private currentSessionId: string | null = null;
  private config: ContextConfig;
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  // 本地持久化前缀（用于在刷新/关闭后恢复会话上下文）
  private readonly STORAGE_KEY = "tanva:contexts:v1";
  private readonly STORAGE_ACTIVE_KEY = "tanva:contexts:active:v1";

  private generateDefaultSessionName(): string {
    const count = this.contexts.size + 1;
    return `会话 ${count}`;
  }

  private static createEmptyCachedImages(): ConversationContext["cachedImages"] {
    return {
      latest: null,
      latestId: null,
      latestPrompt: null,
      timestamp: null,
      latestBounds: null,
      latestLayerId: null,
      latestRemoteUrl: null,
    };
  }

  private ensureCachedImages(
    context: ConversationContext
  ): ConversationContext["cachedImages"] {
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

  private ensureTemporalFields(
    context: ConversationContext
  ): ConversationContext {
    if (!(context.startTime instanceof Date)) {
      context.startTime = new Date(context.startTime);
    }
    if (!(context.lastActivity instanceof Date)) {
      context.lastActivity = new Date(context.lastActivity);
    }
    if (!context.name) {
      context.name = this.generateDefaultSessionName();
    }

    if (!Array.isArray(context.messages)) {
      context.messages = [];
    } else {
      context.messages = context.messages.map((message) => ({
        ...message,
        timestamp:
          message.timestamp instanceof Date
            ? message.timestamp
            : new Date(message.timestamp),
      }));
    }

    if (!Array.isArray(context.operations)) {
      context.operations = [];
    } else {
      context.operations = context.operations.map((operation) => ({
        ...operation,
        timestamp:
          operation.timestamp instanceof Date
            ? operation.timestamp
            : new Date(operation.timestamp),
      }));
    }

    if (!context.contextInfo) {
      context.contextInfo = {
        userPreferences: {},
        recentPrompts: [],
        imageHistory: [],
        iterationCount: 0,
      };
    }

    if (!Array.isArray(context.contextInfo.recentPrompts)) {
      context.contextInfo.recentPrompts = [];
    }

    if (!Array.isArray(context.contextInfo.imageHistory)) {
      context.contextInfo.imageHistory = [];
    } else {
      context.contextInfo.imageHistory = context.contextInfo.imageHistory.map(
        (item) => ({
          ...item,
          timestamp:
            item.timestamp instanceof Date
              ? item.timestamp
              : new Date(item.timestamp),
        })
      );
    }

    return context;
  }

  private ensureActiveContext(): ConversationContext {
    if (this.currentSessionId) {
      const existing = this.contexts.get(this.currentSessionId);
      if (existing) {
        this.ensureTemporalFields(existing);
        this.ensureCachedImages(existing);
        return existing;
      }
    }
    const sessionId = this.createSession();
    const context = this.contexts.get(sessionId);
    if (!context) {
      throw new Error("Failed to create active context");
    }
    return context;
  }

  constructor(config: ContextConfig = DEFAULT_CONTEXT_CONFIG) {
    this.config = config;
    console.log("🧠 上下文管理器初始化完成");

    // 启动定期清理任务
    this.startCleanupInterval();
    // 尝试从本地存储恢复会话数据（关闭对话框/刷新后恢复）
    try {
      this.loadContextsFromStorage();
    } catch (e) {
      console.warn("[ContextManager] 从本地恢复会话失败:", e);
    }
  }

  /**
   * 启动定期清理任务
   */
  private startCleanupInterval(): void {
    if (typeof window === "undefined") return;

    // 清除之前的定时器
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
    }

    // 每5分钟执行一次清理
    this.cleanupIntervalId = setInterval(() => {
      this.performMemoryCleanup();
    }, MEMORY_OPTIMIZATION.cleanupIntervalMs);

    console.log("🧹 [ContextManager] 启动定期内存清理任务");
  }

  /**
   * 将当前内存中的会话上下文持久化到本地存储（localStorage）
   * 注意：为避免把大型 base64 嵌入，写入时会剔除大字段
   */
  private persistContextsToStorage(): void {
    try {
      const entries = Array.from(this.contexts.entries());
      const serialized = JSON.stringify(entries, (key, value) => {
        // 避免将大型 base64 字符串写入 localStorage（会导致 stringify 内存峰值 + 容量超限）
        if (typeof value === "string" && isBase64Data(value)) {
          // 统一策略：不持久化任何 base64/dataURL 图像内容（刷新后可通过 remoteUrl/历史重建）
          return undefined;
        }

        // 常见的大字段键名（更稳妥：即使不是 base64 也不持久化）
        if (
          key === "imageData" ||
          key === "sourceImageData" ||
          key === "thumbnail" ||
          key === "thumbnails" ||
          key === "sourceImagesData" ||
          key === "latest" ||
          key === "videoLocalUrl"
        ) {
          // 对数组字段保留空数组（避免 JSON 中出现 null 占位影响读取逻辑）
          if (Array.isArray(value)) return [];
          return undefined;
        }

        // 本地视频缓存索引只在 IndexedDB 内有效，不写入 localStorage
        if (key === "videoLocalAssetId") return undefined;

        // 视频任务信息可能非常大且与恢复会话无关
        if (key === "taskInfo") return null;

        return value;
      });
      localStorage.setItem(this.STORAGE_KEY, serialized);
      localStorage.setItem(
        this.STORAGE_ACTIVE_KEY,
        this.currentSessionId || ""
      );
    } catch (error) {
      console.warn("[ContextManager] 持久化会话到本地失败:", error);
    }
  }

  /**
   * 从本地存储加载之前持久化的会话数据（如存在）
   */
  private loadContextsFromStorage(): void {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return;
      const entries = JSON.parse(raw) as Array<[string, ConversationContext]>;
      entries.forEach(([id, ctx]) => {
        try {
          this.ensureTemporalFields(ctx);
          this.ensureCachedImages(ctx);
          this.contexts.set(id, ctx);
        } catch {}
      });
      const active = localStorage.getItem(this.STORAGE_ACTIVE_KEY);
      if (active) this.currentSessionId = active || null;
    } catch (error) {
      console.warn("[ContextManager] 从本地加载会话失败:", error);
    }
  }

  /**
   * 执行内存清理
   */
  private performMemoryCleanup(): void {
    const before = this.contexts.size;
    this.cleanupOldContexts();
    this.trimLargeContexts();
    this.enforceSessionLimit();

    const after = this.contexts.size;
    if (before !== after) {
      console.log(`🧹 [ContextManager] 清理完成: ${before} -> ${after} 个会话`);
    }
  }

  /**
   * 裁剪大型上下文中的消息
   */
  private trimLargeContexts(): void {
    for (const [sessionId, context] of this.contexts.entries()) {
      // 清理消息中的大型 base64 数据
      let trimmedCount = 0;
      context.messages = context.messages.map((msg, index) => {
        // 🛑 内存优化：只有在有替代品（远程URL或缩略图）且不是最近几条消息时，才清理大型 Base64
        // 这可以防止正在进行的对话图片突然消失，同时回收历史消息的内存
        const isOldMessage = index < context.messages.length - 3;
        const hasAlternative = !!(msg.imageRemoteUrl || msg.thumbnail);
        const isLarge = (data?: string | null) =>
          data &&
          isBase64Data(data) &&
          data.length > MEMORY_OPTIMIZATION.maxImageCacheSize;

        if (isOldMessage && hasAlternative) {
          const next = { ...msg };
          let changed = false;

          if (isLarge(next.imageData)) {
            next.imageData = undefined;
            trimmedCount++;
            changed = true;
          }

          if (isLarge(next.sourceImageData)) {
            next.sourceImageData = undefined;
            trimmedCount++;
            changed = true;
          }

          if (Array.isArray(next.sourceImagesData)) {
            const filtered = next.sourceImagesData.filter((item) => {
              if (isLarge(item)) {
                trimmedCount++;
                return false;
              }
              return true;
            });
            if (filtered.length !== next.sourceImagesData.length) {
              next.sourceImagesData =
                filtered.length > 0 ? filtered : undefined;
              changed = true;
            }
          }

          if (changed) return next;
        }

        const next = { ...msg };

        if (
          next.thumbnail &&
          isBase64Data(next.thumbnail) &&
          next.thumbnail.length > MEMORY_OPTIMIZATION.maxImageCacheSize
        ) {
          trimmedCount++;
          next.thumbnail = undefined;
        }

        if (
          next.sourceImageData &&
          isBase64Data(next.sourceImageData) &&
          next.sourceImageData.length > MEMORY_OPTIMIZATION.maxImageCacheSize
        ) {
          trimmedCount++;
          next.sourceImageData = undefined;
        }

        if (
          Array.isArray(next.sourceImagesData) &&
          next.sourceImagesData.length > 0
        ) {
          const filtered = next.sourceImagesData.filter((item) => {
            if (
              isBase64Data(item) &&
              item.length > MEMORY_OPTIMIZATION.maxImageCacheSize
            ) {
              trimmedCount++;
              return false;
            }
            return true;
          });
          next.sourceImagesData = filtered.length > 0 ? filtered : undefined;
        }

        // 清理视频相关的缓存数据
        if (next.videoMetadata && typeof next.videoMetadata === "object") {
          const metadata = next.videoMetadata as Record<string, any>;
          // 如果taskInfo过大，进行清理
          if (
            metadata.taskInfo &&
            JSON.stringify(metadata.taskInfo).length > 1024 * 1024
          ) {
            // 1MB限制
            trimmedCount++;
            metadata.taskInfo = null;
            console.log(`🧹 [ContextManager] 清理了大型视频taskInfo数据`);
          }
          // 如果referencedUrls数组过大，只保留前几个
          if (
            Array.isArray(metadata.referencedUrls) &&
            metadata.referencedUrls.length > 10
          ) {
            metadata.referencedUrls = metadata.referencedUrls.slice(0, 10);
            trimmedCount++;
          }
        }

        return next;
      });

      // 限制消息数量
      if (context.messages.length > MEMORY_OPTIMIZATION.maxMessagesPerSession) {
        const excess =
          context.messages.length - MEMORY_OPTIMIZATION.maxMessagesPerSession;
        context.messages = context.messages.slice(excess);
        console.log(
          `🧹 [ContextManager] 会话 ${sessionId} 裁剪了 ${excess} 条旧消息`
        );
      }

      // 限制视频消息数量，优先保留最新的视频消息
      const videoMessages = context.messages.filter(
        (msg) => msg.videoUrl || msg.videoThumbnail
      );
      if (
        videoMessages.length > MEMORY_OPTIMIZATION.maxVideoMessagesPerSession
      ) {
        const excess =
          videoMessages.length - MEMORY_OPTIMIZATION.maxVideoMessagesPerSession;
        // 找到需要清理的视频消息（最旧的）
        const messagesToClean = videoMessages.slice(0, excess);

        // 清理这些消息中的视频数据
        context.messages = context.messages.map((msg) => {
          const isToClean = messagesToClean.some(
            (cleanMsg) => cleanMsg.id === msg.id
          );
          if (isToClean) {
            return {
              ...msg,
              videoUrl: undefined,
              videoThumbnail: undefined,
              videoDuration: undefined,
              videoReferencedUrls: undefined,
              videoTaskId: null,
              videoStatus: null,
              videoSourceUrl: undefined,
              videoMetadata: undefined,
            };
          }
          return msg;
        });

        console.log(
          `🧹 [ContextManager] 会话 ${sessionId} 清理了 ${excess} 条旧视频消息`
        );
      }

      // 清理超过24小时的视频消息
      const now = Date.now();
      const expiredVideoMessages = context.messages.filter((msg) => {
        const hasVideo = msg.videoUrl || msg.videoThumbnail;
        if (!hasVideo) return false;
        const messageTime = new Date(msg.timestamp).getTime();
        return now - messageTime > MEMORY_OPTIMIZATION.videoExpiryMs;
      });

      if (expiredVideoMessages.length > 0) {
        context.messages = context.messages.map((msg) => {
          const isExpired = expiredVideoMessages.some(
            (expiredMsg) => expiredMsg.id === msg.id
          );
          if (isExpired) {
            return {
              ...msg,
              videoUrl: undefined,
              videoThumbnail: undefined,
              videoDuration: undefined,
              videoReferencedUrls: undefined,
              videoTaskId: null,
              videoStatus: null,
              videoSourceUrl: undefined,
              videoMetadata: undefined,
            };
          }
          return msg;
        });

        console.log(
          `🧹 [ContextManager] 会话 ${sessionId} 清理了 ${expiredVideoMessages.length} 条超过24小时的视频消息`
        );
      }

      // 清理缓存的大型图片数据
      if (
        context.cachedImages?.latest &&
        isBase64Data(context.cachedImages.latest)
      ) {
        if (
          context.cachedImages.latest.length >
          MEMORY_OPTIMIZATION.maxImageCacheSize
        ) {
          // 如果有 remoteUrl，清除 base64 数据
          if (context.cachedImages.latestRemoteUrl) {
            context.cachedImages.latest = null;
            console.log(
              `🧹 [ContextManager] 会话 ${sessionId} 清理了大型图片缓存（有远程URL）`
            );
          }
        }
      }

      // 清理图片历史中的大型 base64 数据（若已存在远程 URL）
      if (Array.isArray(context.contextInfo.imageHistory)) {
        context.contextInfo.imageHistory = context.contextInfo.imageHistory.map(
          (item) => {
            const next = { ...item };
            if (next.imageRemoteUrl) {
              if (
                next.imageData &&
                isBase64Data(next.imageData) &&
                next.imageData.length > MEMORY_OPTIMIZATION.maxImageCacheSize
              ) {
                trimmedCount++;
                // 在运行时类型上使用 undefined，而不是 null，以符合 ImageHistory 的类型定义
                next.imageData = undefined;
              }
              if (
                next.thumbnail &&
                isBase64Data(next.thumbnail) &&
                next.thumbnail.length > MEMORY_OPTIMIZATION.maxImageCacheSize
              ) {
                trimmedCount++;
                next.thumbnail = undefined;
              }
            }
            return next;
          }
        );
      }

      if (trimmedCount > 0) {
        console.log(
          `🧹 [ContextManager] 会话 ${sessionId} 清理了 ${trimmedCount} 条消息的大型图片数据`
        );
      }
    }
  }

  /**
   * 强制执行会话数量限制
   */
  private enforceSessionLimit(): void {
    if (this.contexts.size <= MEMORY_OPTIMIZATION.maxSessions) return;

    // 按最后活动时间排序，删除最旧的会话
    const sorted = Array.from(this.contexts.entries()).sort(
      (a, b) => a[1].lastActivity.getTime() - b[1].lastActivity.getTime()
    );

    const toDelete = sorted.slice(
      0,
      this.contexts.size - MEMORY_OPTIMIZATION.maxSessions
    );

    toDelete.forEach(([sessionId, context]) => {
      // 不删除当前活跃的会话
      if (sessionId !== this.currentSessionId) {
        this.contexts.delete(sessionId);
        console.log(`🧹 [ContextManager] 删除超出限制的会话: ${sessionId}`);
      }
    });
  }

  /**
   * 创建新会话
   */
  createSession(name?: string): string {
    // 先执行清理，确保不超出限制
    this.enforceSessionLimit();

    // 检查是否已有活跃的会话
    if (this.currentSessionId && this.contexts.has(this.currentSessionId)) {
      const existingContext = this.contexts.get(this.currentSessionId);
      if (existingContext) {
        // 如果会话是最近30秒内创建的，认为是重复初始化，返回现有会话
        const sessionAge = Date.now() - existingContext.startTime.getTime();
        if (sessionAge < 30000) {
          // 30秒内
          console.log(
            "🧠 返回现有会话上下文:",
            this.currentSessionId,
            "(防止重复创建)"
          );
          return this.currentSessionId;
        }
      }
    }

    const sessionId = `session_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const context: ConversationContext = {
      sessionId,
      startTime: new Date(),
      lastActivity: new Date(),
      name: name || this.generateDefaultSessionName(),
      messages: [],
      operations: [],
      currentMode: "chat",
      cachedImages: {
        latest: null,
        latestId: null,
        latestPrompt: null,
        timestamp: null,
        latestBounds: null,
        latestLayerId: null,
        latestRemoteUrl: null,
      },
      contextInfo: {
        userPreferences: {},
        recentPrompts: [],
        imageHistory: [],
        iterationCount: 0,
      },
    };

    this.contexts.set(sessionId, context);
    this.currentSessionId = sessionId;

    console.log(
      "🧠 创建新会话上下文:",
      sessionId,
      `(总数: ${this.contexts.size})`
    );
    // 持久化到本地，方便刷新/关闭后恢复
    try {
      this.persistContextsToStorage();
    } catch {}
    return sessionId;
  }

  /**
   * 获取当前会话ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * 切换当前会话
   */
  switchSession(sessionId: string): boolean {
    const context = this.contexts.get(sessionId);
    if (!context) {
      console.warn("⚠️ 尝试切换到不存在的会话:", sessionId);
      return false;
    }
    this.currentSessionId = sessionId;
    this.ensureTemporalFields(context);
    this.ensureCachedImages(context);
    console.log("🧠 切换会话上下文:", sessionId);
    return true;
  }

  /**
   * 获取当前上下文
   */
  getCurrentContext(): ConversationContext | null {
    if (!this.currentSessionId) return null;
    const context = this.contexts.get(this.currentSessionId) || null;
    if (!context) return null;
    this.ensureTemporalFields(context);
    this.ensureCachedImages(context);
    return context;
  }

  /**
   * 获取指定会话
   */
  getSession(sessionId: string): ConversationContext | null {
    const context = this.contexts.get(sessionId);
    if (!context) return null;
    this.ensureTemporalFields(context);
    this.ensureCachedImages(context);
    return context;
  }

  /**
   * 列出所有会话
   */
  listSessions(): Array<{
    sessionId: string;
    name: string;
    lastActivity: Date;
    messageCount: number;
    createdAt: Date;
    preview?: string;
  }> {
    return Array.from(this.contexts.values())
      .map((context) => {
        this.ensureTemporalFields(context);
        const lastMessage = context.messages[context.messages.length - 1];
        const preview = lastMessage
          ? lastMessage.content.substring(0, 50)
          : undefined;
        return {
          sessionId: context.sessionId,
          name: context.name,
          lastActivity: context.lastActivity,
          createdAt: context.startTime,
          messageCount: context.messages.length,
          preview,
        };
      })
      .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  }

  /**
   * 获取所有会话原始数据
   */
  getAllSessions(): ConversationContext[] {
    return Array.from(this.contexts.values()).map((context) => {
      this.ensureTemporalFields(context);
      this.ensureCachedImages(context);
      return context;
    });
  }

  /**
   * 重命名会话
   */
  renameSession(sessionId: string, name: string): boolean {
    const context = this.contexts.get(sessionId);
    if (!context) return false;
    const trimmed = name.trim();
    if (trimmed.length === 0) return false;
    context.name = trimmed;
    context.lastActivity = new Date();
    console.log("🧠 重命名会话:", sessionId, "=>", trimmed);
    try {
      this.persistContextsToStorage();
    } catch {}
    return true;
  }

  /**
   * 删除会话
   */
  deleteSession(sessionId: string): boolean {
    const removed = this.contexts.delete(sessionId);
    if (!removed) return false;
    console.log("🗑️ 删除会话上下文:", sessionId);

    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
      const next = this.listSessions()[0];
      if (next) {
        this.currentSessionId = next.sessionId;
        console.log("🧠 自动切换到最近的会话:", next.sessionId);
      }
    }
    try {
      this.persistContextsToStorage();
    } catch {}
    return true;
  }

  /**
   * 重置所有会话
   */
  resetSessions(): void {
    this.contexts.clear();
    this.currentSessionId = null;
    try {
      this.persistContextsToStorage();
    } catch {}
  }

  /**
   * 添加消息到上下文
   */
  addMessage(
    message: Omit<ChatMessage, "id" | "timestamp">,
    options?: { id?: string; timestamp?: Date }
  ): ChatMessage {
    const context = this.ensureActiveContext();

    const newMessage: ChatMessage = {
      ...message,
      id:
        options?.id ||
        `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: options?.timestamp ? new Date(options.timestamp) : new Date(),
    };

    context.messages.push(newMessage);
    context.lastActivity = new Date();

    // 限制消息数量
    if (context.messages.length > this.config.maxMessages) {
      context.messages = context.messages.slice(-this.config.maxMessages);
    }

    console.log("📝 添加消息到上下文:", newMessage.content.substring(0, 50));
    try {
      this.persistContextsToStorage();
    } catch {}
    return newMessage;
  }

  /**
   * 记录操作历史
   */
  recordOperation(operation: Omit<OperationHistory, "id" | "timestamp">): void {
    const context = this.getCurrentContext();
    if (!context) return;

    const newOperation: OperationHistory = {
      ...operation,
      id: `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
    };

    context.operations.push(newOperation);
    context.lastActivity = new Date();
    context.currentMode = operation.type;
    context.contextInfo.lastOperationType = operation.type;

    // 限制操作历史数量
    if (context.operations.length > this.config.maxOperations) {
      context.operations = context.operations.slice(-this.config.maxOperations);
    }

    console.log(
      "📊 记录操作历史:",
      newOperation.type,
      newOperation.input.substring(0, 30)
    );

    // 事件通知：模式变化
    try {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("contextModeChanged", {
            detail: { mode: context.currentMode },
          })
        );
      }
    } catch {}
    try {
      this.persistContextsToStorage();
    } catch {}
    try {
      // 持久化缓存的图像信息，方便关闭/刷新后恢复（注意内容已被裁剪）
      this.persistContextsToStorage();
    } catch {}
  }

  /**
   * 获取所有会话统计
   */

  /**
   * 构建上下文提示
   */
  buildContextPrompt(userInput: string): string {
    const context = this.getCurrentContext();
    if (!context) return userInput;

    // 过滤正在生成的占位消息，避免干扰上下文
    const effectiveMessages = context.messages.filter(
      (msg) => !(msg.generationStatus?.isGenerating && msg.type === "ai")
    );

    // 限制历史记录数量，防止请求头过大 (431错误)
    const recentMessages = effectiveMessages.slice(-3); // 减少到最近3条消息

    // 去重：如果最新一条历史就是这次的用户输入，则从历史中移除，避免与“用户当前输入”重复
    if (recentMessages.length > 0) {
      const last = recentMessages[recentMessages.length - 1];
      if (last.type === "user" && last.content === userInput) {
        recentMessages.pop();
      }
    }
    const recentOperations = context.operations.slice(-2); // 减少到最近2次操作

    let contextPrompt = `用户当前输入: ${userInput}\n\n`;

    if (recentMessages.length > 0) {
      contextPrompt += `对话历史:\n`;
      recentMessages.forEach((msg) => {
        // 减少单条消息长度限制
        const content =
          msg.content.length > 80
            ? msg.content.substring(0, 80) + "..."
            : msg.content;
        contextPrompt += `- ${msg.type}: ${content}\n`;
      });
      contextPrompt += `\n`;
    }

    if (recentOperations.length > 0) {
      contextPrompt += `最近操作:\n`;
      recentOperations.forEach((op) => {
        // 减少操作记录长度限制
        const input =
          op.input.length > 40 ? op.input.substring(0, 40) + "..." : op.input;
        const output =
          op.output && op.output.length > 40
            ? op.output.substring(0, 40) + "..."
            : op.output;
        contextPrompt += `- ${op.type}: ${input} → ${output || "成功"} (${
          op.success ? "成功" : "失败"
        })\n`;
      });
      contextPrompt += `\n`;
    }

    if (context.currentMode !== "chat") {
      contextPrompt += `当前模式: ${context.currentMode}\n`;
    }

    if (context.contextInfo.iterationCount > 0) {
      contextPrompt += `迭代次数: ${context.contextInfo.iterationCount}\n`;
    }

    if (context.contextInfo.lastOperationType) {
      contextPrompt += `上次操作: ${context.contextInfo.lastOperationType}\n`;
    }

    // 🖼️ 图像缓存信息 - 简化信息
    if (context.cachedImages.latest || context.cachedImages.latestRemoteUrl) {
      contextPrompt += `\n当前缓存图像: ${
        context.cachedImages.latestId || "unknown"
      }\n`;
      // 简化生成提示信息
      const promptPreview =
        context.cachedImages.latestPrompt &&
        context.cachedImages.latestPrompt.length > 50
          ? context.cachedImages.latestPrompt.substring(0, 50) + "..."
          : context.cachedImages.latestPrompt || "";
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
    if (
      isImageEditIntent &&
      (context.cachedImages.latest || context.cachedImages.latestRemoteUrl)
    ) {
      contextPrompt += `\n注意：可能需要编辑缓存图像。`;
    }

    // 限制总体上下文提示长度，防止请求头过大 (431错误)
    const maxContextLength = 1500; // 设置合理的上限
    if (contextPrompt.length > maxContextLength) {
      contextPrompt =
        contextPrompt.substring(0, maxContextLength) + "\n...(上下文已截断)";
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
      "优化",
      "调整",
      "改进",
      "修改",
      "再",
      "继续",
      "进一步",
      "更好",
      "更",
      "再试",
      "重新",
      "optimize",
      "adjust",
      "improve",
      "refine",
      "continue",
      "further",
      "better",
      "more",
      "again",
      "retry",
    ];

    const lowerInput = input.toLowerCase();

    // 检查关键词
    const hasKeyword = iterativeKeywords.some((keyword) =>
      lowerInput.includes(keyword.toLowerCase())
    );

    // 🧠 检查数学计算的连续性
    const isMathContinuation =
      /[\+\-\*\/]/.test(input) &&
      this.getCurrentContext()?.messages.some(
        (msg) => msg.type === "ai" && /[\d\+\-\*\/\=]/.test(msg.content)
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
    console.log("🔄 迭代计数:", context.contextInfo.iterationCount);
  }

  /**
   * 重置迭代计数
   */
  resetIteration(): void {
    const context = this.getCurrentContext();
    if (!context) return;

    context.contextInfo.iterationCount = 0;
    console.log("🔄 重置迭代计数");
  }

  /**
   * 保存用户偏好
   */
  saveUserPreference(key: string, value: unknown): void {
    if (!this.config.enableUserPreferences) return;

    const context = this.getCurrentContext();
    if (!context) return;

    context.contextInfo.userPreferences[key] = value;
    console.log("💾 保存用户偏好:", key, value);
  }

  /**
   * 获取用户偏好
   */
  getUserPreference(key: string): unknown {
    const context = this.getCurrentContext();
    if (!context) return null;

    return context.contextInfo.userPreferences[key];
  }

  /**
   * 添加图像历史
   */
  addImageHistory(
    imageHistory: Omit<ImageHistory, "id" | "timestamp"> & {
      id?: string;
      timestamp?: Date;
    }
  ): ImageHistory {
    const context = this.getCurrentContext();
    if (!context) {
      throw new Error("No active context to record image history");
    }

    const newImageHistory: ImageHistory = {
      ...imageHistory,
      id:
        imageHistory.id ??
        `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: imageHistory.timestamp
        ? new Date(imageHistory.timestamp)
        : new Date(),
    };

    context.contextInfo.imageHistory.push(newImageHistory);

    // 限制图像历史数量
    if (context.contextInfo.imageHistory.length > this.config.maxImageHistory) {
      context.contextInfo.imageHistory = context.contextInfo.imageHistory.slice(
        -this.config.maxImageHistory
      );
    }

    console.log("🖼️ 添加图像历史:", newImageHistory.prompt.substring(0, 30));
    try {
      this.persistContextsToStorage();
    } catch {}
    return newImageHistory;
  }

  /**
   * 获取会话摘要
   */
  getSessionSummary(): string {
    const context = this.getCurrentContext();
    if (!context) return "";

    const duration = Math.round(
      (Date.now() - context.startTime.getTime()) / 1000 / 60
    ); // 分钟
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
      this.ensureTemporalFields(context);
      if (now.getTime() - context.lastActivity.getTime() > maxAge) {
        this.contexts.delete(sessionId);
        cleanedCount++;
        if (this.currentSessionId === sessionId) {
          this.currentSessionId = null;
        }
      }
    }

    if (cleanedCount > 0) {
      console.log("🗑️ 清理旧上下文:", cleanedCount, "个会话");
      if (!this.currentSessionId) {
        const next = this.listSessions()[0];
        if (next) {
          this.currentSessionId = next.sessionId;
          console.log("🧠 清理后自动切换到会话:", next.sessionId);
        }
      }
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
      this.ensureTemporalFields(context);
      if (now.getTime() - context.lastActivity.getTime() < activeThreshold) {
        activeSessions++;
      }
    }

    return {
      totalSessions: this.contexts.size,
      activeSessions,
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
    this.ensureTemporalFields(data);
    this.ensureCachedImages(data);
    this.contexts.set(data.sessionId, data);
    this.currentSessionId = data.sessionId;
    console.log("📥 导入会话数据:", data.sessionId);
    try {
      this.persistContextsToStorage();
    } catch {}
  }

  /**
   * 🖼️ 缓存最新生成的图像
   * 内存优化：优先使用 remoteUrl，避免存储大的 base64 数据
   */
  cacheLatestImage(
    imageData: string | null | undefined,
    imageId: string,
    prompt: string,
    options?: {
      bounds?: { x: number; y: number; width: number; height: number };
      layerId?: string;
      remoteUrl?: string | null;
    }
  ): void {
    const context = this.getCurrentContext();
    if (!context) {
      console.error("❌ 无法缓存图像：没有活跃的上下文");
      return;
    }

    const previous = this.ensureCachedImages(context);

    // 内存优化：如果有 remoteUrl，优先使用它，但仍允许缓存小尺寸预览图（用于面板预览与 fallback）
    const hasRemoteUrl =
      options?.remoteUrl && options.remoteUrl.startsWith("http");
    const normalizedRemoteUrl =
      options?.remoteUrl ?? previous.latestRemoteUrl ?? null;

    // 始终尝试缓存 imageData（常为缩略图/预览），但限制大小，并避免把 http(s) URL 当作 imageData 存储
    let normalizedImageData: string | null = null;
    const candidateData =
      typeof imageData === "string" && imageData.length > 0
        ? imageData
        : previous.latest;
    const candidateLooksRemote =
      typeof candidateData === "string" && /^https?:\/\//i.test(candidateData);

    if (candidateData && !candidateLooksRemote) {
      // 内存优化：如果数据是 base64 且超过阈值，不存储
      if (isBase64Data(candidateData)) {
        if (candidateData.length > MEMORY_OPTIMIZATION.maxImageCacheSize) {
          console.log("⚠️ [ContextManager] 跳过大型 base64 缓存（过大）", {
            size: (candidateData.length / 1024 / 1024).toFixed(2) + "MB",
            hasRemoteUrl: !!normalizedRemoteUrl,
          });
          normalizedImageData = null;
        } else {
          normalizedImageData = candidateData;
        }
      } else {
        // data:image 或 blob: 等轻量引用允许存储（remoteUrl 单独存）
        normalizedImageData = candidateData;
      }
    }

    const normalizedImageId =
      typeof imageId === "string" && imageId.length > 0
        ? imageId
        : previous.latestId;
    const normalizedPrompt =
      typeof prompt === "string" && prompt.length > 0
        ? prompt
        : previous.latestPrompt;

    const normalizedBounds = options?.bounds ?? previous.latestBounds ?? null;
    const normalizedLayerId =
      options?.layerId ?? previous.latestLayerId ?? null;

    // 必须有 URL 或者 imageData，以及 ID 和 prompt
    if (
      (!normalizedImageData && !normalizedRemoteUrl) ||
      !normalizedImageId ||
      !normalizedPrompt
    ) {
      console.warn("⚠️ 缓存图像失败：缺少必要字段", {
        sessionId: context.sessionId,
        hasPreviousImage: !!previous.latest,
        provided: {
          hasImageData: typeof imageData === "string" && imageData.length > 0,
          hasImageId: typeof imageId === "string" && imageId.length > 0,
          hasPrompt: typeof prompt === "string" && prompt.length > 0,
          hasRemoteUrl: !!normalizedRemoteUrl,
        },
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
      latestRemoteUrl: normalizedRemoteUrl,
    };

    console.log("🖼️ 缓存最新图像:", {
      imageId: normalizedImageId,
      prompt: normalizedPrompt.substring(0, 30),
      hasImageData: !!normalizedImageData,
      imageDataLength: normalizedImageData?.length || 0,
      sessionId: context.sessionId,
      bounds: normalizedBounds,
      layerId: normalizedLayerId,
      hasRemoteUrl: !!normalizedRemoteUrl,
      usingRemoteUrlOnly: hasRemoteUrl && !normalizedImageData,
    });

    // 通知: 缓存更新
    try {
      if (typeof window !== "undefined") {
        const payload = this.getCachedImage();
        window.dispatchEvent(
          new CustomEvent("cachedImageChanged", { detail: payload })
        );
      }
    } catch {}
  }

  /**
   * 🖼️ 获取缓存的图像信息
   */
  getCachedImage(): {
    imageData: string | null;
    imageId: string;
    prompt: string;
    bounds?: { x: number; y: number; width: number; height: number } | null;
    layerId?: string | null;
    remoteUrl?: string | null;
  } | null {
    const context = this.getCurrentContext();
    if (!context) {
      console.log("🔍 getCachedImage: 没有活跃的上下文");
      return null;
    }
    const cachedImages = this.ensureCachedImages(context);

    const hasAnyImage = !!(cachedImages.latest || cachedImages.latestRemoteUrl);
    if (!hasAnyImage || !cachedImages.latestId || !cachedImages.latestPrompt) {
      console.log("🔍 getCachedImage: 缓存数据不完整", {
        sessionId: context.sessionId,
        hasImageData: !!cachedImages.latest,
        hasRemoteUrl: !!cachedImages.latestRemoteUrl,
        hasImageId: !!cachedImages.latestId,
        hasPrompt: !!cachedImages.latestPrompt,
      });
      return null;
    }

    const result = {
      imageData: cachedImages.latest ?? null,
      imageId: cachedImages.latestId,
      prompt: cachedImages.latestPrompt,
      bounds: cachedImages.latestBounds ?? null,
      layerId: cachedImages.latestLayerId ?? null,
      remoteUrl: cachedImages.latestRemoteUrl ?? null,
    };

    console.log("🔍 getCachedImage: 返回缓存的图像", {
      imageId: result.imageId,
      prompt: result.prompt.substring(0, 30),
      hasImageData: !!result.imageData,
      imageDataLength: result.imageData?.length || 0,
      bounds: result.bounds,
      layerId: result.layerId,
      hasRemoteUrl: !!result.remoteUrl,
    });

    return result;
  }

  /**
   * 🖼️ 检测用户是否想要编辑最新图像
   */
  detectImageEditIntent(input: string): boolean {
    const context = this.getCurrentContext();
    if (
      !context ||
      (!context.cachedImages.latest && !context.cachedImages.latestRemoteUrl)
    )
      return false;

    const editKeywords = [
      "编辑",
      "修改",
      "改变",
      "调整",
      "优化",
      "改进",
      "让它",
      "改成",
      "变成",
      "给",
      "加上",
      "添加",
      "戴上",
      "穿上",
      "画上",
      "加上",
      "制作",
      "设计",
      "edit",
      "modify",
      "change",
      "adjust",
      "optimize",
      "improve",
      "make it",
      "turn into",
      "add",
      "put on",
      "wear",
      "draw on",
      "create",
      "design",
    ];

    const lowerInput = input.toLowerCase();
    return editKeywords.some((keyword) =>
      lowerInput.includes(keyword.toLowerCase())
    );
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
      latestRemoteUrl: null,
    };

    console.log("🗑️ 清除图像缓存");

    // 通知: 缓存清空
    try {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("cachedImageChanged", { detail: null })
        );
      }
    } catch {}
  }
}

// 创建全局实例
// 说明：在 Vite/React Fast Refresh 下，模块可能被多次重新执行；若每次都 new 实例会导致定时器与旧实例被引用而无法 GC。
export const contextManager: ContextManager = (() => {
  if (typeof window === "undefined") {
    return new ContextManager();
  }
  const globalAny = window as any;
  if (globalAny.__tanvaContextManager) {
    return globalAny.__tanvaContextManager as ContextManager;
  }
  globalAny.__tanvaContextManager = new ContextManager();
  return globalAny.__tanvaContextManager as ContextManager;
})();
