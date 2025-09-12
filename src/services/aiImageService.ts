/**
 * Google Gemini 2.5 Flash Image (Nano Banana) API 服务层
 * 处理AI图像生成、编辑和融合功能
 * 使用最新的 gemini-2.5-flash-image-preview 模型
 */

import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import { contextManager } from '@/services/contextManager';
import type {
  AIImageGenerateRequest,
  AIImageEditRequest,
  AIImageBlendRequest,
  AIImageAnalyzeRequest,
  AITextChatRequest,
  AIImageResult,
  AIImageAnalysisResult,
  AITextChatResult,
  AIServiceResponse,
  AIError,
  AITool,
  ToolSelectionRequest,
  ToolSelectionResult
} from '@/types/ai';

class AIImageService {
  private genAI: GoogleGenAI | null = null;
  private readonly DEFAULT_MODEL = 'gemini-2.5-flash-image-preview';
  private readonly DEFAULT_TIMEOUT = 60000; // 增加到60秒

  constructor() {
    this.initializeClient();
  }

  private initializeClient(): void {
    // 兼容 Vite 和 Node.js 环境
    const apiKey = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_GOOGLE_GEMINI_API_KEY
      : process.env.VITE_GOOGLE_GEMINI_API_KEY;

    // 临时使用默认密钥进行测试（生产环境应该移除）
    const defaultApiKey = 'AIzaSyAWVrzl5s4JQDhrZN8iSPcxmbFmgEJTTxw';
    const finalApiKey = apiKey || defaultApiKey;

    if (!finalApiKey) {
      console.warn('Google Gemini API key not found. Please set VITE_GOOGLE_GEMINI_API_KEY in your .env.local file');
      return;
    }

    console.log('🔑 使用API密钥:', finalApiKey.substring(0, 10) + '...');
    console.log('🔑 密钥来源:', apiKey ? '环境变量' : '默认密钥');

    try {
      this.genAI = new GoogleGenAI({ apiKey: finalApiKey });
      console.log('✅ Google GenAI client initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Google GenAI client:', error);
    }
  }

  private createError(code: string, message: string, details?: unknown): AIError {
    return {
      code,
      message,
      details,
      timestamp: new Date()
    };
  }

  /**
   * 🔒 安全地处理错误对象，防止Base64数据被输出到控制台
   */
  private sanitizeErrorForLogging(error: unknown): string {
    if (error instanceof Error) {
      const message = error.message;
      
      // 检查是否包含Base64数据
      if (message && message.length > 1000 && message.includes('iVBORw0KGgo')) {
        console.warn('⚠️ 检测到Base64图像数据在错误消息中，已过滤');
        return '图像处理失败（错误详情已过滤）';
      }
      
      // 检查是否包含data URL
      if (message && message.includes('data:image/')) {
        console.warn('⚠️ 检测到图像数据URL在错误消息中，已过滤');
        return '图像处理失败（包含图像数据，已过滤）';
      }
      
      return message;
    }
    
    return String(error);
  }

  private async processWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number = this.DEFAULT_TIMEOUT,
    retries: number = 1 // 减少重试次数
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
        );
        
        const result = await Promise.race([promise, timeoutPromise]);
        
        // 如果成功，立即返回，不进行重试
        if (attempt > 0) {
          console.log(`✅ 重试成功 (第${attempt + 1}次尝试)`);
        }
        
        return result;
      } catch (error) {
        lastError = error as Error;
        
        // 检查是否是网络相关错误
        if (this.isNetworkError(error) && attempt < retries) {
          console.warn(`⚠️ 网络错误，${2000 * (attempt + 1)}ms后重试 (${attempt + 1}/${retries})`);
          await this.delay(2000 * (attempt + 1)); // 增加延迟时间
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError!;
  }

  /**
   * 检查是否是网络相关错误
   */
  private isNetworkError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('fetch') || 
             message.includes('network') || 
             message.includes('connection') ||
             message.includes('cors') ||
             message.includes('load failed');
    }
    return false;
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 生成图像
   */
  async generateImage(request: AIImageGenerateRequest): Promise<AIServiceResponse<AIImageResult>> {
    console.log('🎨 开始生成图像:', request);

    if (!this.genAI) {
      return {
        success: false,
        error: this.createError(
          'CLIENT_NOT_INITIALIZED',
          'Google GenAI client is not initialized. Please check your API key.'
        )
      };
    }

    try {
      // 构建中文图像生成提示词
      let prompt = `🌏 请生成图像，使用中文描述过程：${request.prompt}`;

      // 添加宽高比信息（如果指定）
      if (request.aspectRatio && request.aspectRatio !== '1:1') {
        prompt += ` (宽高比: ${request.aspectRatio})`;
      }

      console.log('📝 发送提示词:', prompt);

      const startTime = Date.now();

      // 发送生成请求 - 使用新的generateContent API
      const result = await this.processWithTimeout(
        this.genAI.models.generateContent({
          model: request.model || this.DEFAULT_MODEL,
          contents: prompt,
        })
      );

      const processingTime = Date.now() - startTime;
      console.log(`⏱️ 处理耗时: ${processingTime}ms`);

      console.log('📄 API响应:', result);

      // 获取生成的图像数据 - 新的响应格式
      if (!result.candidates || result.candidates.length === 0) {
        throw new Error('No candidates returned from API');
      }

      const candidate = result.candidates[0];
      if (!candidate.content || !candidate.content.parts) {
        throw new Error('No content parts in response');
      }

      // 查找图像数据
      let imageBytes: string | null = null;
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          imageBytes = part.inlineData.data;
          break;
        }
      }

      if (!imageBytes) {
        throw new Error('No image data found in response');
      }

      const aiResult: AIImageResult = {
        id: uuidv4(),
        imageData: imageBytes, // base64编码的图像数据
        prompt: request.prompt,
        model: request.model || this.DEFAULT_MODEL,
        createdAt: new Date(),
        metadata: {
          aspectRatio: request.aspectRatio,
          outputFormat: request.outputFormat || 'png',
          processingTime
        }
      };

      console.log('✅ 图像生成成功:', aiResult.id);

      // 🧠 记录操作到上下文
      contextManager.recordOperation({
        type: 'generate',
        input: request.prompt,
        output: `生成图像成功，ID: ${aiResult.id}`,
        imageData: aiResult.imageData,
        success: true,
        metadata: { 
          model: request.model || this.DEFAULT_MODEL,
          aspectRatio: request.aspectRatio,
          processingTime: Date.now() - startTime
        }
      });

      // 🖼️ 缓存最新生成的图像
      contextManager.cacheLatestImage(aiResult.imageData, aiResult.id, request.prompt);

      // 🧠 添加图像历史
      contextManager.addImageHistory({
        imageData: aiResult.imageData,
        prompt: request.prompt,
        operationType: 'generate',
        thumbnail: aiResult.imageData // 使用原图作为缩略图
      });

      return {
        success: true,
        data: aiResult
      };

    } catch (error) {
      // 🔒 安全检查：防止Base64图像数据被输出到控制台
      const safeError = this.sanitizeErrorForLogging(error);
      console.error('❌ 图像生成失败:', safeError);

      // 详细的错误分析
      let errorCode = 'GENERATION_FAILED';
      let errorMessage = error instanceof Error ? error.message : 'Failed to generate image';

      if (error.message) {
        if (error.message.includes('API_KEY_INVALID')) {
          errorCode = 'INVALID_API_KEY';
          errorMessage = 'API密钥无效，请检查密钥是否正确配置';
        } else if (error.message.includes('PERMISSION_DENIED')) {
          errorCode = 'PERMISSION_DENIED';
          errorMessage = 'API权限被拒绝，请检查密钥权限设置';
        } else if (error.message.includes('QUOTA_EXCEEDED')) {
          errorCode = 'QUOTA_EXCEEDED';
          errorMessage = 'API配额已用完，请检查账户余额';
        } else if (error.message.includes('User location is not supported')) {
          errorCode = 'LOCATION_NOT_SUPPORTED';
          errorMessage = '当前地区不支持此API功能，请尝试使用VPN或联系管理员';
        } else if (error.message.includes('billed users')) {
          errorCode = 'BILLING_REQUIRED';
          errorMessage = 'Gemini API需要付费账户，请升级您的Google Cloud账户';
        } else if (error.message.includes('fetch failed')) {
          errorCode = 'NETWORK_ERROR';
          errorMessage = '网络连接失败，请检查网络连接或API服务状态';
        }
      }

      return {
        success: false,
        error: this.createError(errorCode, errorMessage, error)
      };
    }
  }

  /**
   * 编辑图像
   */
  async editImage(request: AIImageEditRequest): Promise<AIServiceResponse<AIImageResult>> {
    console.log('✏️ 开始编辑图像:', { prompt: request.prompt, hasImage: !!request.sourceImage });

    if (!this.genAI) {
      return {
        success: false,
        error: this.createError(
          'CLIENT_NOT_INITIALIZED',
          'Google GenAI client is not initialized. Please check your API key.'
        )
      };
    }

    try {
      const prompt = `🌏 请根据以下指令编辑这张图片，并用中文回复处理结果：${request.prompt}`;

      // 将base64图像转换为适当的格式
      const imageData = request.sourceImage.replace(/^data:image\/[a-z]+;base64,/, '');

      const startTime = Date.now();

      const result = await this.processWithTimeout(
        this.genAI.models.generateContent({
          model: request.model || this.DEFAULT_MODEL,
          contents: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg', // 根据实际格式调整
                data: imageData
              }
            }
          ]
        })
      );

      const processingTime = Date.now() - startTime;

      // 处理新的响应格式
      if (!result.candidates || result.candidates.length === 0) {
        throw new Error('No candidates returned from API');
      }

      const candidate = result.candidates[0];
      if (!candidate.content || !candidate.content.parts) {
        throw new Error('No content parts in response');
      }

      // 查找图像数据
      let editedImageData: string | null = null;
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          editedImageData = part.inlineData.data;
          break;
        }
      }

      if (!editedImageData) {
        throw new Error('No edited image data found in response');
      }

      const aiResult: AIImageResult = {
        id: uuidv4(),
        imageData: editedImageData,
        prompt: request.prompt,
        model: request.model || this.DEFAULT_MODEL,
        createdAt: new Date(),
        metadata: {
          outputFormat: request.outputFormat,
          processingTime
        }
      };

      console.log('✅ 图像编辑成功:', aiResult.id);

      // 🧠 记录操作到上下文
      contextManager.recordOperation({
        type: 'edit',
        input: request.prompt,
        output: `编辑图像成功，ID: ${aiResult.id}`,
        imageData: aiResult.imageData,
        success: true,
        metadata: { 
          model: request.model || this.DEFAULT_MODEL,
          processingTime: Date.now() - startTime
        }
      });

      // 🖼️ 更新缓存的图像（编辑后的新图像）
      contextManager.cacheLatestImage(aiResult.imageData, aiResult.id, request.prompt);

      // 🧠 添加图像历史
      contextManager.addImageHistory({
        imageData: aiResult.imageData,
        prompt: request.prompt,
        operationType: 'edit',
        thumbnail: aiResult.imageData
      });

      return {
        success: true,
        data: aiResult
      };

    } catch (error) {
      // 🔒 安全检查：防止Base64图像数据被输出到控制台
      const safeError = this.sanitizeErrorForLogging(error);
      console.error('❌ 图像编辑失败:', safeError);

      // 详细的错误分析
      let errorCode = 'EDIT_FAILED';
      let errorMessage = error instanceof Error ? error.message : 'Failed to edit image';

      if (error.message) {
        if (error.message.includes('API_KEY_INVALID')) {
          errorCode = 'INVALID_API_KEY';
          errorMessage = 'API密钥无效，请检查密钥是否正确配置';
        } else if (error.message.includes('PERMISSION_DENIED')) {
          errorCode = 'PERMISSION_DENIED';
          errorMessage = 'API权限被拒绝，请检查密钥权限设置';
        } else if (error.message.includes('QUOTA_EXCEEDED')) {
          errorCode = 'QUOTA_EXCEEDED';
          errorMessage = 'API配额已用完，请检查账户余额';
        } else if (error.message.includes('User location is not supported')) {
          errorCode = 'LOCATION_NOT_SUPPORTED';
          errorMessage = '当前地区不支持此API功能，请尝试使用VPN或联系管理员';
        } else if (error.message.includes('billed users')) {
          errorCode = 'BILLING_REQUIRED';
          errorMessage = 'Gemini API需要付费账户，请升级您的Google Cloud账户';
        } else if (error.message.includes('fetch failed')) {
          errorCode = 'NETWORK_ERROR';
          errorMessage = '网络连接失败，请检查网络连接或API服务状态';
        }
      }

      return {
        success: false,
        error: this.createError(errorCode, errorMessage, error)
      };
    }
  }

  /**
   * 融合多个图像
   */
  async blendImages(request: AIImageBlendRequest): Promise<AIServiceResponse<AIImageResult>> {
    console.log('🎭 开始融合图像:', { prompt: request.prompt, imageCount: request.sourceImages.length });

    if (!this.genAI) {
      return {
        success: false,
        error: this.createError(
          'CLIENT_NOT_INITIALIZED',
          'Google GenAI client is not initialized. Please check your API key.'
        )
      };
    }

    try {
      // 根据图片数量使用不同的提示词策略
      let prompt: string;
      
      if (request.sourceImages.length === 2) {
        // 两张图：将第一张图（较早上传的）融合到第二张图（最后上传的主场景）中
        // 注意：图片顺序会被反转，所以API收到的第一张是用户最后上传的
        prompt = `🌏 自然融合两张图片，请用中文描述处理过程：${request.prompt}`;
      } else {
        // 多张图（3张或以上）：混合所有图片
        prompt = `🌏 生成一张新图片，融合以下所有图片的元素，请用中文描述处理过程：${request.prompt}`;
      }

      // 构建包含多个图像的请求 - 反转顺序，让最后上传的图片作为主场景
      const reversedImages = [...request.sourceImages].reverse();
      const imageParts = reversedImages.map((imageData) => ({
        inlineData: {
          mimeType: 'image/jpeg', // 根据实际格式调整
          data: imageData.replace(/^data:image\/[a-z]+;base64,/, '')
        }
      }));

      console.log('🔄 图片顺序已反转，现在的顺序：', reversedImages.map((_, index) => `第${index + 1}张`));

      const startTime = Date.now();

      const result = await this.processWithTimeout(
        this.genAI.models.generateContent({
          model: request.model || this.DEFAULT_MODEL,
          contents: [{ text: prompt }, ...imageParts]
        })
      );

      const processingTime = Date.now() - startTime;

      // 处理新的响应格式
      if (!result.candidates || result.candidates.length === 0) {
        throw new Error('No candidates returned from API');
      }

      const candidate = result.candidates[0];
      if (!candidate.content || !candidate.content.parts) {
        throw new Error('No content parts in response');
      }

      // 查找图像数据
      let blendedImageData: string | null = null;
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          blendedImageData = part.inlineData.data;
          break;
        }
      }

      if (!blendedImageData) {
        throw new Error('No blended image data found in response');
      }

      const aiResult: AIImageResult = {
        id: uuidv4(),
        imageData: blendedImageData,
        prompt: request.prompt,
        model: request.model || this.DEFAULT_MODEL,
        createdAt: new Date(),
        metadata: {
          outputFormat: request.outputFormat,
          processingTime
        }
      };

      console.log('✅ 图像融合成功:', aiResult.id);

      // 🧠 记录操作到上下文
      contextManager.recordOperation({
        type: 'blend',
        input: request.prompt,
        output: `融合图像成功，ID: ${aiResult.id}`,
        imageData: aiResult.imageData,
        success: true,
        metadata: { 
          model: request.model || this.DEFAULT_MODEL,
          sourceImageCount: request.sourceImages.length,
          processingTime: Date.now() - startTime
        }
      });

      // 🖼️ 缓存融合后的图像
      contextManager.cacheLatestImage(aiResult.imageData, aiResult.id, request.prompt);

      // 🧠 添加图像历史
      contextManager.addImageHistory({
        imageData: aiResult.imageData,
        prompt: request.prompt,
        operationType: 'blend',
        thumbnail: aiResult.imageData
      });

      return {
        success: true,
        data: aiResult
      };

    } catch (error) {
      // 🔒 安全检查：防止Base64图像数据被输出到控制台
      const safeError = this.sanitizeErrorForLogging(error);
      console.error('❌ 图像融合失败:', safeError);

      // 详细的错误分析
      let errorCode = 'BLEND_FAILED';
      let errorMessage = error instanceof Error ? error.message : 'Failed to blend images';

      if (error.message) {
        if (error.message.includes('API_KEY_INVALID')) {
          errorCode = 'INVALID_API_KEY';
          errorMessage = 'API密钥无效，请检查密钥是否正确配置';
        } else if (error.message.includes('PERMISSION_DENIED')) {
          errorCode = 'PERMISSION_DENIED';
          errorMessage = 'API权限被拒绝，请检查密钥权限设置';
        } else if (error.message.includes('QUOTA_EXCEEDED')) {
          errorCode = 'QUOTA_EXCEEDED';
          errorMessage = 'API配额已用完，请检查账户余额';
        } else if (error.message.includes('User location is not supported')) {
          errorCode = 'LOCATION_NOT_SUPPORTED';
          errorMessage = '当前地区不支持此API功能，请尝试使用VPN或联系管理员';
        } else if (error.message.includes('billed users')) {
          errorCode = 'BILLING_REQUIRED';
          errorMessage = 'Gemini API需要付费账户，请升级您的Google Cloud账户';
        } else if (error.message.includes('fetch failed')) {
          errorCode = 'NETWORK_ERROR';
          errorMessage = '网络连接失败，请检查网络连接或API服务状态';
        }
      }

      return {
        success: false,
        error: this.createError(errorCode, errorMessage, error)
      };
    }
  }

  /**
   * 检查API是否可用
   */
  isAvailable(): boolean {
    const apiKey = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_GOOGLE_GEMINI_API_KEY
      : process.env.VITE_GOOGLE_GEMINI_API_KEY;
    const defaultApiKey = 'AIzaSyAWVrzl5s4JQDhrZN8iSPcxmbFmgEJTTxw';
    const finalApiKey = apiKey || defaultApiKey;
    const available = !!this.genAI && !!finalApiKey;
    console.log('🔍 API可用性检查:', available ? '✅ 可用' : '❌ 不可用');
    console.log('🔑 使用的API密钥:', finalApiKey ? `${finalApiKey.substring(0, 10)}...` : '无');
    return available;
  }

  /**
   * 估算成本（基于Gemini原生图片生成定价：每张图片1,290个token，$30/100万token）
   */
  estimateCost(imageCount: number): number {
    const tokensPerImage = 1290;
    const costPer1MTokens = 30; // $30 per 1M tokens
    return (imageCount * tokensPerImage * costPer1MTokens) / 1000000;
  }

  // 定义可用的工具
  private readonly AVAILABLE_TOOLS: AITool[] = [
    {
      name: 'generateImage',
      description: '根据文本描述生成新图像。适用于用户想要创建、画、生成图片的请求。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '图像生成的详细描述文字，包含风格、内容、色彩等信息'
          },
          aspectRatio: {
            type: 'string',
            description: '图像宽高比，如 16:9(横屏), 9:16(竖屏), 1:1(正方形), 4:3, 3:4',
            enum: ['1:1', '9:16', '16:9', '4:3', '3:4']
          }
        },
        required: ['prompt']
      }
    },
    {
      name: 'editImage',
      description: '编辑现有图像。适用于用户想要修改、编辑已有图片的请求。需要提供源图像。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '编辑指令，描述如何修改图像'
          },
          sourceImage: {
            type: 'string',
            description: '源图像的base64数据'
          }
        },
        required: ['prompt', 'sourceImage']
      }
    },
    {
      name: 'blendImages',
      description: '融合多张图像。适用于用户想要混合、合并、融合、组合、拼接、结合多张图片，或者将多个元素整合到一起的请求。需要2张或更多图像。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '融合指令，描述如何融合图像'
          },
          sourceImages: {
            type: 'array',
            description: '多张源图像的base64数据数组',
            items: { type: 'string' }
          }
        },
        required: ['prompt', 'sourceImages']
      }
    },
    {
      name: 'analyzeImage',
      description: '分析图像内容，提供详细描述。适用于用户想要了解、分析、描述图片内容的请求。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '分析问题或留空进行全面分析。例如：这是什么？分析构图？识别物体？'
          },
          sourceImage: {
            type: 'string',
            description: '要分析的图像base64数据'
          }
        },
        required: ['sourceImage']
      }
    },
    {
      name: 'chatResponse',
      description: '进行文本对话，回答问题或聊天。适用于数学计算、知识问答、日常对话等请求。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '用户的问题或对话内容'
          }
        },
        required: ['prompt']
      }
    }
  ];

  /**
   * 使用Gemini Function Calling选择合适的工具
   */
  async selectTool(request: ToolSelectionRequest): Promise<AIServiceResponse<ToolSelectionResult>> {
    const startTime = Date.now();
    
    console.log('🤖 ========== AI两层分类工具选择开始 ==========');
    console.log('📋 输入参数详情:', {
      用户输入: request.userInput,
      输入长度: request.userInput.length,
      是否有图像: request.hasImages,
      图像数量: request.imageCount,
      可用工具: request.availableTools?.join(', ') || '默认5个工具'
    });
    console.log('🔑 API密钥状态:', this.genAI ? '✅ 已初始化' : '❌ 未初始化');

    if (!this.genAI) {
      console.error('❌ GenAI客户端未初始化');
      return {
        success: false,
        error: this.createError('CLIENT_NOT_INITIALIZED', 'GenAI client not initialized')
      };
    }

    try {
      // 🧠 使用上下文构建增强提示
      console.log('🧠 开始构建上下文增强提示...');
      const contextualPrompt = contextManager.buildContextPrompt(request.userInput);
      console.log('🧠 上下文提示构建完成:', {
        提示长度: contextualPrompt.length,
        提示预览: contextualPrompt.substring(0, 200) + '...'
      });
      
      // 构建两层分类的系统提示
      const systemPrompt = `🌏 请用中文进行分析和回复。

你是一个智能助手，需要根据用户输入进行两层分类来选择最合适的工具。

${contextualPrompt}

基础信息:
- 是否有图像: ${request.hasImages}
- 图像数量: ${request.imageCount}

📋 两层分类法：

**第一层分类**（判断用户意图类别）：
A. 图像操作类 - 用户想要对图像进行修改、编辑、融合操作
B. 文字回复类 - 用户想要获得分析、解释、对话等文本回复

**第二层分类**（根据图片数量选择具体工具）：
如果是图像操作类：
  - 图片数量 = 1 → editImage（编辑图像）
  - 图片数量 ≥ 2 → blendImages（融合图像）
  - 图片数量 = 0 → generateImage（生成新图像）

如果是文字回复类：
  - 有图片 → analyzeImage（分析图像）
  - 无图片 → chatResponse（文本对话）

🎯 判断逻辑：
1. **图像操作类关键词**：编辑、修改、改变、融合、合并、结合、混合、生成、创建、画、制作等
2. **文字回复类关键词**：分析、描述、解释、什么、识别、看看、介绍、告诉我、计算、问答等

📏 特殊规则：
- 多张图片（≥2张）且非明确分析意图时，强制选择 blendImages
- 无图片时优先判断是否要生成新图像

⚠️ 重要：请先判断第一层分类，再根据图片数量确定具体工具，所有分析理由必须用中文表达。
🎯 回复格式：工具名称|第一层分类:中文理由,第二层选择:中文理由`;

      console.log('📤 准备发送AI请求:', {
        模型: 'gemini-2.0-flash',
        提示词长度: systemPrompt.length,
        安全设置: '已配置4个类别为BLOCK_NONE'
      });

      // 使用Gemini进行工具选择
      const aiCallStartTime = Date.now();
      const result = await this.processWithTimeout(
        this.genAI.models.generateContent({
          model: 'gemini-2.0-flash', // 使用文本模型进行工具选择
          contents: [{ text: systemPrompt }],  // 修正：contents应该是数组
          safetySettings: [
            {
              category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_HATE_SPEECH',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_HARASSMENT',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
              threshold: 'BLOCK_NONE'
            }
          ]
        })
      );
      
      const aiCallTime = Date.now() - aiCallStartTime;
      console.log(`📥 AI响应成功，耗时: ${aiCallTime}ms`);

      if (!result.text) {
        console.error('❌ AI响应中没有文本内容');
        throw new Error('No tool selection response from API');
      }

      console.log('🤖 AI工具选择原始响应:', {
        响应内容: result.text,
        响应长度: result.text.length,
        响应时间: aiCallTime + 'ms'
      });

      // 解析AI的选择
      console.log('🔍 开始解析AI响应...');
      const parseStartTime = Date.now();
      const toolSelection = this.parseToolSelection(result.text, request);
      const parseTime = Date.now() - parseStartTime;

      const totalTime = Date.now() - startTime;
      console.log('✅ 工具选择成功:', {
        选择结果: toolSelection,
        解析耗时: parseTime + 'ms',
        总耗时: totalTime + 'ms',
        AI调用占比: Math.round((aiCallTime / totalTime) * 100) + '%'
      });

      // 🧠 记录操作到上下文
      contextManager.recordOperation({
        type: 'chat',
        input: request.userInput,
        output: result.text,
        success: true,
        metadata: { 
          selectedTool: toolSelection.selectedTool,
          confidence: toolSelection.confidence,
          processingTime: totalTime,
          aiCallTime: aiCallTime
        }
      });

      console.log('🤖 ========== AI两层分类工具选择完成 ==========');

      return {
        success: true,
        data: toolSelection
      };

    } catch (error) {
      const totalTime = Date.now() - startTime;
      
      // 🔒 安全检查：防止Base64图像数据被输出到控制台
      const safeError = this.sanitizeErrorForLogging(error);
      console.error('❌ ========== AI工具选择失败，启动降级逻辑 ==========');
      console.error('❌ 失败详情:', {
        错误信息: safeError,
        失败时间: totalTime + 'ms',
        用户输入: request.userInput.substring(0, 50) + '...',
        图像数量: request.imageCount
      });

      // 降级处理：使用简单规则选择工具
      console.log('🔧 开始两层分类降级处理...');
      const fallbackStartTime = Date.now();
      const fallbackSelection = this.fallbackToolSelection(request);
      const fallbackTime = Date.now() - fallbackStartTime;
      
      console.log('✅ 降级处理完成:', {
        降级结果: fallbackSelection,
        降级耗时: fallbackTime + 'ms',
        总耗时: (totalTime + fallbackTime) + 'ms'
      });

      // 🧠 记录失败操作
      contextManager.recordOperation({
        type: 'chat',
        input: request.userInput,
        output: 'fallback',
        success: false,
        metadata: { 
          error: safeError,
          fallbackTool: fallbackSelection.selectedTool,
          processingTime: totalTime,
          fallbackTime: fallbackTime
        }
      });

      console.log('🤖 ========== 降级工具选择完成 ==========');

      return {
        success: true, // 即使AI失败，也返回降级结果
        data: fallbackSelection
      };
    }
  }

  /**
   * 解析AI的两层分类工具选择响应
   */
  private parseToolSelection(aiResponse: string, request: ToolSelectionRequest): ToolSelectionResult {
    const { userInput, imageCount } = request;

    console.log('🔍 开始解析AI响应:', aiResponse);

    // 解析两层分类响应格式：工具名称|第一层分类:理由,第二层选择:理由
    let selectedTool = '';
    let firstLayerReason = '';
    let secondLayerReason = '';
    let fullReasoning = aiResponse;

    // 尝试解析新格式
    const newFormatMatch = aiResponse.match(/(\w+)\|第一层分类:([^,]+),第二层选择:(.+)/);
    if (newFormatMatch) {
      selectedTool = newFormatMatch[1];
      firstLayerReason = newFormatMatch[2].trim();
      secondLayerReason = newFormatMatch[3].trim();
      fullReasoning = `第一层分类: ${firstLayerReason}, 第二层选择: ${secondLayerReason}`;
      
      console.log('✅ 解析新格式成功:', {
        selectedTool,
        firstLayerReason,
        secondLayerReason
      });
    } else {
      // 兼容旧格式：工具名称|理由
      const pipeMatch = aiResponse.match(/(\w+)\|(.+)/);
      if (pipeMatch) {
        selectedTool = pipeMatch[1];
        fullReasoning = pipeMatch[2].trim();
        console.log('⚠️ 使用旧格式解析:', { selectedTool, reasoning: fullReasoning });
      } else {
        // 尝试从文本中提取工具名称
        const toolNames = this.AVAILABLE_TOOLS.map(tool => tool.name);
        for (const toolName of toolNames) {
          if (aiResponse.toLowerCase().includes(toolName.toLowerCase())) {
            selectedTool = toolName;
            console.log('🔧 从文本中提取工具名称:', selectedTool);
            break;
          }
        }
      }
    }

    // 验证选择的工具是否存在
    const toolExists = this.AVAILABLE_TOOLS.some(tool => tool.name === selectedTool);
    if (!toolExists) {
      console.warn('❌ AI选择了不存在的工具:', selectedTool, '使用降级逻辑');
      return this.fallbackToolSelection(request);
    }

    // 计算置信度（新格式置信度更高）
    const confidence = newFormatMatch ? 0.95 : 0.8;

    // 验证工具选择的逻辑合理性
    const isLogicalChoice = this.validateToolChoice(selectedTool, imageCount, userInput);
    if (!isLogicalChoice) {
      console.warn('⚠️ AI选择的工具不符合逻辑规则:', {
        selectedTool,
        imageCount,
        userInput: userInput.substring(0, 50)
      }, '使用降级逻辑');
      return this.fallbackToolSelection(request);
    }

    // 构建参数
    const parameters: Record<string, string> = { prompt: userInput };

    // 检测宽高比（仅对generateImage）
    if (selectedTool === 'generateImage') {
      const aspectRatio = this.detectAspectRatio(userInput);
      if (aspectRatio) {
        parameters.aspectRatio = aspectRatio;
      }
    }

    // 注意：editImage, analyzeImage, blendImages的特殊参数需要在store层添加

    console.log('✅ 工具选择解析完成:', {
      selectedTool,
      confidence,
      reasoning: fullReasoning.substring(0, 100) + '...'
    });

    return {
      selectedTool,
      parameters,
      confidence,
      reasoning: fullReasoning || `AI选择了${selectedTool}`
    };
  }

  /**
   * 验证工具选择的逻辑合理性
   */
  private validateToolChoice(selectedTool: string, imageCount: number, userInput: string): boolean {
    const lowerInput = userInput.toLowerCase();

    // 验证规则
    switch (selectedTool) {
      case 'blendImages':
        // 融合必须有2张或以上图片
        if (imageCount < 2) {
          console.warn('blendImages选择不合理: 图片数量不足', imageCount);
          return false;
        }
        break;
        
      case 'editImage':
        // 编辑必须有且仅有1张图片
        if (imageCount !== 1) {
          console.warn('editImage选择不合理: 图片数量不是1', imageCount);
          return false;
        }
        break;
        
      case 'analyzeImage':
        // 分析必须有图片
        if (imageCount === 0) {
          console.warn('analyzeImage选择不合理: 没有图片');
          return false;
        }
        break;
        
      case 'generateImage':
        // 生成图像应该没有图片（或有图片但明确要求新生成）
        if (imageCount > 0) {
          const hasNewImageKeywords = ['新画', '新建', '新生成', '新创建', '画一张', '生成一张', 'new'].some(
            keyword => lowerInput.includes(keyword)
          );
          if (!hasNewImageKeywords) {
            console.warn('generateImage选择不合理: 有图片但没有新生成意图');
            return false;
          }
        }
        break;
        
      case 'chatResponse':
        // 对话功能合理性较宽松，主要检查是否误选
        if (imageCount >= 2) {
          const hasAnalysisKeywords = ['什么', '分析', '描述', '识别'].some(
            keyword => lowerInput.includes(keyword)
          );
          if (!hasAnalysisKeywords) {
            console.warn('chatResponse选择可能不合理: 多张图片但非明确分析意图');
            // 但不返回false，允许AI的判断
          }
        }
        break;
    }

    return true;
  }

  /**
   * 检测用户输入中的宽高比需求
   */
  private detectAspectRatio(input: string): string | undefined {
    const lowerInput = input.toLowerCase();

    if (lowerInput.includes('横屏') || lowerInput.includes('宽屏') || lowerInput.includes('landscape')) {
      return '16:9';
    }
    if (lowerInput.includes('竖屏') || lowerInput.includes('竖版') || lowerInput.includes('portrait')) {
      return '9:16';
    }
    if (lowerInput.includes('正方形') || lowerInput.includes('方形') || lowerInput.includes('square')) {
      return '1:1';
    }

    return undefined;
  }

  /**
   * 降级工具选择（基于两层分类规则）
   */
  private fallbackToolSelection(request: ToolSelectionRequest): ToolSelectionResult {
    const { userInput, hasImages, imageCount } = request;
    const lowerInput = userInput.toLowerCase();

    console.log('🔧 两层分类降级选择:', {
      用户输入: userInput.substring(0, 50) + '...',
      图片数量: imageCount,
      有图片: hasImages
    });

    // 第一层分类：判断意图类别
    const isImageOperation = this.detectImageOperationIntent(lowerInput);
    const firstLayerCategory = isImageOperation ? '图像操作类' : '文字回复类';
    
    console.log(`📋 第一层分类: ${firstLayerCategory}`, {
      是否图像操作: isImageOperation
    });

    // 第二层分类：根据第一层结果和图片数量选择工具
    let selectedTool: string;
    let reasoning: string;
    let confidence: number;

    if (isImageOperation) {
      // 图像操作类：根据图片数量选择
      if (imageCount >= 2) {
        selectedTool = 'blendImages';
        reasoning = `第一层: ${firstLayerCategory}, 第二层: ${imageCount}张图片→融合`;
        confidence = 0.95;
      } else if (imageCount === 1) {
        selectedTool = 'editImage';
        reasoning = `第一层: ${firstLayerCategory}, 第二层: 单张图片→编辑`;
        confidence = 0.9;
      } else {
        selectedTool = 'generateImage';
        reasoning = `第一层: ${firstLayerCategory}, 第二层: 无图片→生成`;
        confidence = 0.9;
      }
    } else {
      // 文字回复类：根据是否有图片选择
      if (hasImages) {
        selectedTool = 'analyzeImage';
        reasoning = `第一层: ${firstLayerCategory}, 第二层: 有图片→分析`;
        confidence = 0.85;
      } else {
        selectedTool = 'chatResponse';
        reasoning = `第一层: ${firstLayerCategory}, 第二层: 无图片→对话`;
        confidence = 0.8;
      }
    }

    console.log(`✅ 两层分类完成:`, {
      第一层: firstLayerCategory,
      第二层选择: selectedTool,
      置信度: confidence
    });

    // 构建参数
    const parameters: Record<string, string> = { prompt: userInput };
    
    // 为generateImage添加宽高比检测
    if (selectedTool === 'generateImage') {
      const aspectRatio = this.detectAspectRatio(userInput);
      if (aspectRatio) {
        parameters.aspectRatio = aspectRatio;
      }
    }

    return {
      selectedTool,
      parameters,
      confidence,
      reasoning
    };
  }

  /**
   * 检测是否为图像操作意图
   */
  private detectImageOperationIntent(lowerInput: string): boolean {
    // 图像操作关键词
    const imageOperationKeywords = [
      // 编辑类
      '编辑', '修改', '改变', '调整', '更改', '替换', '删除', '添加',
      'edit', 'modify', 'change', 'adjust', 'alter', 'replace',
      
      // 融合类
      '融合', '合并', '结合', '混合', '拼接', '组合', '整合',
      'blend', 'merge', 'combine', 'mix', 'join',
      
      // 生成类
      '生成', '创建', '画', '制作', '设计', '绘制', '新建',
      'generate', 'create', 'draw', 'make', 'design', 'paint', 'new'
    ];

    // 文字回复关键词（相对于图像操作）
    const textResponseKeywords = [
      // 分析类
      '什么', '分析', '描述', '解释', '识别', '看看', '介绍', '告诉我',
      'what', 'analyze', 'describe', 'explain', 'identify', 'tell', 'show',
      
      // 对话类
      '计算', '问题', '回答', '解答', '帮助', '怎么样', '如何',
      'calculate', 'question', 'answer', 'help', 'how', 'why'
    ];

    // 计算各类关键词的匹配数量
    const imageOperationMatches = imageOperationKeywords.filter(keyword => 
      lowerInput.includes(keyword)
    ).length;
    
    const textResponseMatches = textResponseKeywords.filter(keyword => 
      lowerInput.includes(keyword)
    ).length;

    // 特殊情况：数学表达式明确是文字回复
    const isMathExpression = lowerInput.match(/^\d+[+\-*/]\d+/) || 
                            lowerInput.includes('=') || 
                            lowerInput.includes('计算');
    
    if (isMathExpression) {
      console.log('🔢 检测到数学表达式，归类为文字回复');
      return false;
    }

    // 判断结果
    const isImageOperation = imageOperationMatches > textResponseMatches;
    
    console.log('🎯 意图检测结果:', {
      图像操作关键词: imageOperationMatches,
      文字回复关键词: textResponseMatches,
      最终判断: isImageOperation ? '图像操作类' : '文字回复类'
    });

    return isImageOperation;
  }

  /**
   * 分析图像内容
   */
  async analyzeImage(request: AIImageAnalyzeRequest): Promise<AIServiceResponse<AIImageAnalysisResult>> {
    console.log('🔍 开始分析图像:', { prompt: request.prompt, hasImage: !!request.sourceImage });

    if (!this.genAI) {
      return {
        success: false,
        error: this.createError('CLIENT_NOT_INITIALIZED', 'GenAI client not initialized')
      };
    }

    try {
      // 构建分析提示词
      const analysisPrompt = request.prompt || `请详细分析这张图片，包括：
1. 图片的主要内容和主题
2. 图片中的对象、人物、场景
3. 色彩和构图特点
4. 图片的风格和质量
5. 任何值得注意的细节

请用中文详细描述。`;

      // 将base64图像转换为适当的格式
      const imageData = request.sourceImage.replace(/^data:image\/[a-z]+;base64,/, '');

      const startTime = Date.now();

      // 使用 gemini-2.0-flash 进行图像分析
      const result = await this.processWithTimeout(
        this.genAI.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: [
            { text: analysisPrompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: imageData
              }
            }
          ]
        })
      );

      const processingTime = Date.now() - startTime;

      if (!result.text) {
        throw new Error('No analysis text returned from API');
      }

      const analysisResult: AIImageAnalysisResult = {
        analysis: result.text,
        confidence: 0.95,
        tags: this.extractTagsFromAnalysis(result.text)
      };

      console.log('✅ 图像分析成功');
      console.log(`⏱️ 分析耗时: ${processingTime}ms`);

      // 🧠 记录操作到上下文
      contextManager.recordOperation({
        type: 'analyze',
        input: request.prompt,
        output: analysisResult.description,
        success: true,
        metadata: { 
          model: request.model || this.DEFAULT_MODEL,
          processingTime,
          tags: analysisResult.tags
        }
      });

      return {
        success: true,
        data: analysisResult
      };

    } catch (error) {
      // 🔒 安全检查：防止Base64图像数据被输出到控制台
      const safeError = this.sanitizeErrorForLogging(error);
      console.error('❌ 图像分析失败:', safeError);
      return {
        success: false,
        error: this.createError('ANALYSIS_FAILED', error.message, error)
      };
    }
  }

  /**
   * 从分析文本中提取标签
   */
  private extractTagsFromAnalysis(analysisText: string): string[] {
    const tags: string[] = [];
    const commonTags = [
      '人物', '风景', '建筑', '动物', '植物', '食物', '交通工具', '艺术品',
      '室内', '室外', '白天', '夜晚', '彩色', '黑白', '现代', '古典'
    ];

    commonTags.forEach(tag => {
      if (analysisText.includes(tag)) {
        tags.push(tag);
      }
    });

    return tags.slice(0, 5); // 最多返回5个标签
  }

  /**
   * 纯文本对话生成
   */
  async generateTextResponse(request: AITextChatRequest): Promise<AIServiceResponse<AITextChatResult>> {

    if (!this.genAI) {
      return {
        success: false,
        error: this.createError('CLIENT_NOT_INITIALIZED', 'GenAI client not initialized')
      };
    }

    try {
      // 🧠 使用上下文构建增强提示
      const contextualPrompt = contextManager.buildContextPrompt(request.prompt);
      
      // 添加中文语言指令
      const finalPrompt = `🌏 请用中文回复以下内容：\n\n${contextualPrompt}`;
      
      console.log('🧠 文本对话使用上下文:', finalPrompt.substring(0, 200) + '...');

      const result = await this.processWithTimeout(
        this.genAI.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: [{ text: finalPrompt }],  // 修正：contents应该是数组
          safetySettings: [
            {
              category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_HATE_SPEECH',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_HARASSMENT',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
              threshold: 'BLOCK_NONE'
            }
          ]
        })
      );

      if (!result.text) {
        throw new Error('No text response from API');
      }

      // 🧠 记录操作到上下文
      contextManager.recordOperation({
        type: 'chat',
        input: request.prompt,
        output: result.text,
        success: true,
        metadata: { 
          model: 'gemini-2.0-flash'
        }
      });

      return {
        success: true,
        data: {
          text: result.text,
          model: 'gemini-2.0-flash'
        }
      };

    } catch (error) {
      // 🔒 安全检查：防止Base64图像数据被输出到控制台
      const safeError = this.sanitizeErrorForLogging(error);
      console.error('❌ 文本回复失败:', safeError);
      return {
        success: false,
        error: this.createError('TEXT_GENERATION_FAILED', error.message, error)
      };
    }
  }

  /**
   * 测试API连接
   */
  async testConnection(): Promise<boolean> {
    console.log('🔬 测试API连接...');

    if (!this.isAvailable()) {
      console.log('❌ API不可用');
      return false;
    }

    try {
      // 使用基础的文本生成来测试连接，避免图像生成的计费问题
      const result = await this.genAI!.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: 'Hello, this is a connection test. Please respond with "Connection successful!"'
      });

      const success = !!result.text;
      console.log('🔬 连接测试结果:', success ? '✅ 成功' : '❌ 失败');

      if (success) {
        console.log('📄 测试响应:', result.text);
      }

      return success;
    } catch (error) {
      // 🔒 安全检查：防止Base64图像数据被输出到控制台
      const safeError = this.sanitizeErrorForLogging(error);
      console.error('❌ 连接测试异常:', safeError);
      return false;
    }
  }
}

// 导出单例实例
export const aiImageService = new AIImageService();
export default aiImageService;