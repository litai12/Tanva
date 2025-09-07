/**
 * AI聊天对话框状态管理
 * 管理对话框显示、输入内容和生成状态
 */

import { create } from 'zustand';
import { aiImageService } from '@/services/aiImageService';
import { contextManager } from '@/services/contextManager';
import type { AIImageResult } from '@/types/ai';

export interface ChatMessage {
  id: string;
  type: 'user' | 'ai' | 'error';
  content: string;
  timestamp: Date;
  imageData?: string; // AI生成的图像数据
  sourceImageData?: string; // 用户上传的源图像数据（用于图生图）
  sourceImagesData?: string[]; // 多张源图像数据（用于图像融合）
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

  // 图生图状态
  sourceImageForEditing: string | null; // 当前用于编辑的源图像

  // 多图融合状态
  sourceImagesForBlending: string[]; // 当前用于融合的多张图像

  // 图像分析状态
  sourceImageForAnalysis: string | null; // 当前用于分析的源图像

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

  // 图生图功能
  editImage: (prompt: string, sourceImage: string) => Promise<void>;
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

  // 智能模式检测
  getAIMode: () => 'generate' | 'edit' | 'blend' | 'analyze';

  // 配置管理
  toggleAutoDownload: () => void;
  setAutoDownload: (value: boolean) => void;

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

    console.log('📨 添加新消息:', {
      type: newMessage.type,
      content: newMessage.content.substring(0, 50) + (newMessage.content.length > 50 ? '...' : ''),
      id: newMessage.id
    });

    set((state) => ({
      messages: [...state.messages, newMessage]
    }));

    console.log('📊 消息列表更新后长度:', get().messages.length);
  },

  clearMessages: () => set({ messages: [] }),

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
        aspectRatio: '16:9',  // 改为横屏16:9，生成更大的图像
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

      // 调用AI服务编辑图像
      const result = await aiImageService.editImage({
        prompt,
        sourceImage,
        outputFormat: 'png'
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
        state.addMessage({
          type: 'ai',
          content: `已编辑图像: ${prompt}`,
          imageData: result.data.imageData
        });

        // 自动添加到画布
        const addImageToCanvas = (aiResult: AIImageResult) => {
          const mimeType = `image/${aiResult.metadata?.outputFormat || 'png'}`;
          const imageDataUrl = `data:${mimeType};base64,${aiResult.imageData}`;
          const fileName = `ai_edited_${prompt.substring(0, 20)}.${aiResult.metadata?.outputFormat || 'png'}`;

          // 🎯 获取当前选中图片的边界作为占位框
          let selectedImageBounds = null;
          try {
            if ((window as any).tanvaImageInstances) {
              const selectedImage = (window as any).tanvaImageInstances.find((img: any) => img.isSelected);
              if (selectedImage) {
                selectedImageBounds = selectedImage.bounds;
                console.log('🎯 发现选中图片，使用其边界作为占位框:', selectedImageBounds);
              }
            }
          } catch (error) {
            console.warn('获取选中图片边界失败:', error);
          }

          window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
            detail: {
              imageData: imageDataUrl,
              fileName: fileName,
              selectedImageBounds: selectedImageBounds  // 传递选中图片的边界
            }
          }));

          const targetInfo = selectedImageBounds ? '选中图片位置' : '坐标原点(0,0)';
          console.log(`📋 已触发快速图片上传事件，编辑后的图片将自动放置到${targetInfo}`);
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

    set({
      generationStatus: {
        isGenerating: true,
        progress: 0,
        error: null
      }
    });

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

      const result = await aiImageService.blendImages({
        prompt,
        sourceImages,
        outputFormat: 'png'
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

        state.addMessage({
          type: 'ai',
          content: `已融合图像: ${prompt}`,
          imageData: result.data.imageData
        });

        const addImageToCanvas = (aiResult: AIImageResult) => {
          const mimeType = `image/${aiResult.metadata?.outputFormat || 'png'}`;
          const imageDataUrl = `data:${mimeType};base64,${aiResult.imageData}`;
          const fileName = `ai_blended_${prompt.substring(0, 20)}.${aiResult.metadata?.outputFormat || 'png'}`;

          window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
            detail: {
              imageData: imageDataUrl,
              fileName: fileName
            }
          }));
          console.log('📋 已触发快速图片上传事件，融合后的图片将自动放置到坐标原点(0,0)');
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
    state.addMessage({
      type: 'user',
      content: prompt ? `分析图片: ${prompt}` : '分析这张图片',
      sourceImageData: sourceImage
    });

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
              progress: currentState.generationStatus.progress + 15
            }
          });
        }
      }, 300);

      // 调用AI服务分析图像
      const result = await aiImageService.analyzeImage({
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
      // 调用文本生成服务
      const result = await aiImageService.generateTextResponse({ prompt });

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
          content: result.data.text
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

  // 智能工具选择功能 - 统一入口
  processUserInput: async (input: string) => {
    const state = get();

    if (state.generationStatus.isGenerating) return;

    // 🧠 确保有活跃的上下文
    if (!contextManager.getCurrentContext()) {
      contextManager.createSession();
    }
    
    // 🧠 添加用户消息到上下文
    contextManager.addMessage({
      type: 'user',
      content: input
    });

    // 检测迭代意图
    const isIterative = contextManager.detectIterativeIntent(input);
    if (isIterative) {
      contextManager.incrementIteration();
      console.log('🔄 检测到迭代优化意图');
    }

    // 准备工具选择请求
    const cachedImage = contextManager.getCachedImage();
    const toolSelectionRequest = {
      userInput: input,
      hasImages: !!(state.sourceImageForEditing || state.sourceImagesForBlending.length > 0 || state.sourceImageForAnalysis || cachedImage),
      imageCount: state.sourceImagesForBlending.length || (state.sourceImageForEditing ? 1 : 0) || (state.sourceImageForAnalysis ? 1 : 0) || (cachedImage ? 1 : 0),
      availableTools: ['generateImage', 'editImage', 'blendImages', 'analyzeImage', 'chatResponse']
    };

    console.log('🔍 工具选择调试信息:', {
      userInput: input,
      hasImages: toolSelectionRequest.hasImages,
      imageCount: toolSelectionRequest.imageCount,
      cachedImage: cachedImage ? `ID: ${cachedImage.imageId}` : 'none',
      sourceImageForEditing: state.sourceImageForEditing ? 'exists' : 'none',
      sourceImagesForBlending: state.sourceImagesForBlending.length,
      sourceImageForAnalysis: state.sourceImageForAnalysis ? 'exists' : 'none'
    });

    console.log('🤖 智能处理用户输入...');

    // 显示工具选择进度
    set({
      generationStatus: {
        isGenerating: true,
        progress: 10,
        error: null
      }
    });

    try {
      // 使用AI选择工具
      const toolSelectionResult = await aiImageService.selectTool(toolSelectionRequest);

      if (!toolSelectionResult.success || !toolSelectionResult.data) {
        const errorMsg = toolSelectionResult.error?.message || '工具选择失败';
        console.error('❌ 工具选择失败:', errorMsg);
        throw new Error(errorMsg);
      }

      const { selectedTool, parameters } = toolSelectionResult.data;

      console.log('🎯 AI选择工具:', selectedTool);

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

    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : '处理失败';
      
      // 🔒 安全检查：防止Base64图像数据被当作错误消息
      if (errorMessage && errorMessage.length > 1000 && errorMessage.includes('iVBORw0KGgo')) {
        console.warn('⚠️ 检测到Base64图像数据被当作错误消息，使用默认错误信息');
        errorMessage = '图像处理失败，请重试';
      }

      set({
        generationStatus: {
          isGenerating: false,
          progress: 0,
          error: errorMessage
        }
      });

      // 🧠 添加错误消息到上下文
      contextManager.addMessage({
        type: 'error',
        content: `处理失败: ${errorMessage}`
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
    if (state.sourceImagesForBlending.length >= 2) return 'blend';
    if (state.sourceImageForEditing) return 'edit';
    if (state.sourceImageForAnalysis) return 'analyze';
    return 'generate';
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
      lastGeneratedImage: null,
      sourceImageForEditing: null,
      sourceImagesForBlending: [],
      sourceImageForAnalysis: null
    });
  },

  // 🧠 上下文管理方法实现
  initializeContext: () => {
    const sessionId = contextManager.createSession();
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
  }
}));