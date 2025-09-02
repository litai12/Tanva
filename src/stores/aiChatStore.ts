/**
 * AI聊天对话框状态管理
 * 管理对话框显示、输入内容和生成状态
 */

import { create } from 'zustand';
import { aiImageService } from '@/services/aiImageService';
import type { AIImageResult } from '@/types/ai';

export interface ChatMessage {
  id: string;
  type: 'user' | 'ai' | 'error';
  content: string;
  timestamp: Date;
  imageData?: string; // AI生成的图像数据
}

export interface GenerationStatus {
  isGenerating: boolean;
  progress: number; // 0-100
  error: string | null;
}

interface AIChatState {
  // 对话框状态
  isVisible: boolean;

  // 输入状态
  currentInput: string;

  // 生成状态
  generationStatus: GenerationStatus;

  // 消息历史
  messages: ChatMessage[];

  // 最近生成的图像
  lastGeneratedImage: AIImageResult | null;

  // 配置选项
  autoDownload: boolean;  // 是否自动下载生成的图片

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

  // 图像生成
  generateImage: (prompt: string) => Promise<void>;

  // 配置管理
  toggleAutoDownload: () => void;
  setAutoDownload: (value: boolean) => void;

  // 重置状态
  resetState: () => void;
}

export const useAIChatStore = create<AIChatState>((set, get) => ({
  // 初始状态
  isVisible: false,
  currentInput: '',
  generationStatus: {
    isGenerating: false,
    progress: 0,
    error: null
  },
  messages: [],
  lastGeneratedImage: null,
  autoDownload: false,  // 默认不自动下载

  // 对话框控制
  showDialog: () => set({ isVisible: true }),
  hideDialog: () => set({ isVisible: false }),
  toggleDialog: () => set((state) => ({ isVisible: !state.isVisible })),

  // 输入管理
  setCurrentInput: (input) => set({ currentInput: input }),
  clearInput: () => set({ currentInput: '' }),

  // 消息管理
  addMessage: (message) => {
    const newMessage: ChatMessage = {
      ...message,
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date()
    };

    set((state) => ({
      messages: [...state.messages, newMessage]
    }));
  },

  clearMessages: () => set({ messages: [] }),

  // 图像生成主函数
  generateImage: async (prompt: string) => {
    const state = get();

    // 如果正在生成，忽略新请求
    if (state.generationStatus.isGenerating) {
      return;
    }

    // 添加用户消息
    state.addMessage({
      type: 'user',
      content: prompt
    });

    // 设置生成状态
    set({
      generationStatus: {
        isGenerating: true,
        progress: 0,
        error: null
      }
    });

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

      // 调用AI服务生成图像
      const result = await aiImageService.generateImage({
        prompt,
        aspectRatio: '1:1',
        outputFormat: 'png'
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
        state.addMessage({
          type: 'ai',
          content: `已生成图像: ${prompt}`,
          imageData: result.data.imageData
        });

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

        // 根据配置决定是否自动下载
        const currentState = get();
        downloadImageData(result.data.imageData, prompt, currentState.autoDownload);

        // 自动添加到画布中央 - 使用快速上传工具的逻辑
        const addImageToCanvas = (aiResult: AIImageResult) => {
          // 构建图像数据URL
          const mimeType = `image/${aiResult.metadata?.outputFormat || 'png'}`;
          const imageDataUrl = `data:${mimeType};base64,${aiResult.imageData}`;
          const fileName = `ai_generated_${prompt.substring(0, 20)}.${aiResult.metadata?.outputFormat || 'png'}`;

          // 直接触发快速上传事件，复用现有的上传逻辑
          window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
            detail: {
              imageData: imageDataUrl,
              fileName: fileName
            }
          }));
          console.log('📋 已触发快速图片上传事件，图片将自动放置到坐标原点(0,0)');
        };

        // 自动添加到画布
        setTimeout(() => {
          addImageToCanvas(result.data);
        }, 100); // 短暂延迟，确保UI更新

        console.log('✅ 图像生成成功，已自动添加到画布', {
          imageDataLength: result.data.imageData?.length,
          prompt: result.data.prompt,
          model: result.data.model,
          id: result.data.id,
          createdAt: result.data.createdAt,
          metadata: result.data.metadata
        });

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

  // 配置管理
  toggleAutoDownload: () => set((state) => ({ autoDownload: !state.autoDownload })),
  setAutoDownload: (value: boolean) => set({ autoDownload: value }),

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
      lastGeneratedImage: null
    });
  }
}));