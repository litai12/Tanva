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
  ToolSelectionResult,
  AIStreamProgressEvent
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

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number = this.DEFAULT_TIMEOUT,
    operationType?: string
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
    );
    
    const startTime = Date.now();
    
    try {
      const result = await Promise.race([promise, timeoutPromise]);
      const duration = Date.now() - startTime;
      console.log(`✅ ${operationType || 'API调用'} 成功 (耗时: ${duration}ms)`);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ ${operationType || 'API调用'} 失败 (耗时: ${duration}ms):`, this.sanitizeErrorForLogging(error));
      throw error;
    }
  }





  /**
   * 发送进度更新事件给UI
   */
  private emitProgressUpdate(operationType: string, progress: Omit<AIStreamProgressEvent, 'operationType' | 'timestamp'>): void {
    const eventDetail: AIStreamProgressEvent = {
      operationType,
      ...progress,
      timestamp: Date.now()
    };

    // 发送自定义事件
    window.dispatchEvent(new CustomEvent<AIStreamProgressEvent>('aiStreamProgress', {
      detail: eventDetail
    }));

    console.log(`📢 UI进度更新 [${operationType}]:`, eventDetail);
  }

  /**
   * 处理流式响应的通用解析器
   */
  private async parseStreamResponse(
    stream: any,
    operationType: string
  ): Promise<{ imageBytes: string | null; textResponse: string }> {
    console.log(`🌊 开始${operationType}流式响应解析...`);

    // 发送开始事件
    this.emitProgressUpdate(operationType, {
      phase: 'starting',
      message: `开始接收${operationType}流式响应`
    });

    let textResponse: string = '';
    let imageBytes: string | null = null;
    let chunkCount = 0;
    let textChunks: string[] = [];
    let totalResponseSize = 0;
    let hasReceivedText = false;
    let hasReceivedImage = false;

    try {
      for await (const chunk of stream) {
        chunkCount++;
        console.log(`📦 ${operationType}响应块 #${chunkCount}`);

        // 验证响应块结构
        if (!chunk || typeof chunk !== 'object') {
          console.log(`⚠️ 响应块 #${chunkCount} 不是有效对象`);
          continue;
        }

        if (!chunk.candidates || !Array.isArray(chunk.candidates) || chunk.candidates.length === 0) {
          console.log(`⚠️ 响应块 #${chunkCount} 中没有有效的candidates`);
          continue;
        }

        const candidate = chunk.candidates[0];
        if (!candidate || typeof candidate !== 'object') {
          console.log(`⚠️ 响应块 #${chunkCount} 中candidate无效`);
          continue;
        }

        if (!candidate.content || !candidate.content.parts || !Array.isArray(candidate.content.parts)) {
          console.log(`⚠️ 响应块 #${chunkCount} 中没有有效的content parts`);
          continue;
        }

        // 处理每个part
        for (const part of candidate.content.parts) {
          if (!part || typeof part !== 'object') {
            console.log(`⚠️ 响应块 #${chunkCount} 中part无效`);
            continue;
          }

          // 处理文本数据
          if (part.text && typeof part.text === 'string') {
            const textLength = part.text.length;
            textChunks.push(part.text);
            textResponse += part.text;
            totalResponseSize += textLength;
            console.log(`📝 ${operationType}文本块 (+${textLength}字符):`, part.text.substring(0, 50) + (part.text.length > 50 ? '...' : ''));

            // 首次接收到文本时发送通知
            if (!hasReceivedText) {
              hasReceivedText = true;
              this.emitProgressUpdate(operationType, {
                phase: 'text_received',
                chunkCount,
                textLength: textResponse.length,
                message: `已接收到${operationType}文本确认`
              });
            }
          }

          // 处理图像数据
          if (part.inlineData && part.inlineData.data && typeof part.inlineData.data === 'string') {
            imageBytes = part.inlineData.data;
            const imageSize = imageBytes.length;
            totalResponseSize += imageSize;
            console.log(`🖼️ ${operationType}图像数据 (大小: ${imageSize}字符, MIME: ${part.inlineData.mimeType || 'unknown'})`);

            // 首次接收到图像时发送通知
            if (!hasReceivedImage) {
              hasReceivedImage = true;
              this.emitProgressUpdate(operationType, {
                phase: 'image_received',
                chunkCount,
                hasImage: true,
                message: `已接收到${operationType}图像数据`
              });
            }
          }
        }

        // 实时进度反馈
        if (chunkCount % 5 === 0) {
          console.log(`📊 ${operationType}进度更新: ${chunkCount}个块, 文本${textChunks.length}段, 图像${imageBytes ? '已接收' : '未接收'}`);
        }
      }

      // 最终统计
      console.log(`✅ ${operationType}流式响应完成:`, {
        总块数: chunkCount,
        文本段数: textChunks.length,
        文本总长度: textResponse.length,
        有图像数据: !!imageBytes,
        图像数据长度: imageBytes?.length || 0,
        总响应大小: totalResponseSize,
        平均块大小: chunkCount > 0 ? Math.round(totalResponseSize / chunkCount) : 0
      });

      // 数据验证
      if (!imageBytes && !textResponse) {
        console.error(`❌ ${operationType}响应为空: 没有接收到图像数据或文本响应`);
        throw new Error(`No ${operationType.toLowerCase()} data or text response found in stream`);
      }

      if (imageBytes && imageBytes.length < 100) {
        console.warn(`⚠️ ${operationType}图像数据疑似不完整: 长度仅${imageBytes.length}字符`);
      }

      if (textResponse && textResponse.length > 10000) {
        console.warn(`⚠️ ${operationType}文本响应异常长: ${textResponse.length}字符`);
      }

      // 发送完成事件
      this.emitProgressUpdate(operationType, {
        phase: 'completed',
        chunkCount,
        textLength: textResponse.length,
        hasImage: !!imageBytes,
        message: `${operationType}流式响应处理完成`
      });

      return { imageBytes, textResponse };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ ${operationType}流式响应解析出错:`, {
        错误: errorMessage,
        已处理块数: chunkCount,
        已获取文本长度: textResponse.length,
        已获取图像: !!imageBytes
      });

      // 发送错误事件
      this.emitProgressUpdate(operationType, {
        phase: 'error',
        chunkCount,
        textLength: textResponse.length,
        hasImage: !!imageBytes,
        message: `${operationType}流式响应处理失败: ${errorMessage}`
      });

      throw error;
    }
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
      // 直接使用用户原始提示词
      const prompt = request.prompt;

      console.log('📝 发送提示词:', prompt);

      const startTime = Date.now();

      // 使用流式API调用和数据解析
      const result = await this.withTimeout(
        (async () => {
          const stream = await this.genAI!.models.generateContentStream({
            model: request.model || this.DEFAULT_MODEL,
            contents: prompt,
            config: {
              safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
              ]
            }
          });

          return this.parseStreamResponse(stream, '图像生成');
        })(),
        this.DEFAULT_TIMEOUT,
        '流式图像生成'
      );

      const processingTime = Date.now() - startTime;
      console.log(`⏱️ 总处理耗时: ${processingTime}ms`);

      const imageBytes = result.imageBytes;
      const textResponse = result.textResponse;

      const aiResult: AIImageResult = {
        id: uuidv4(),
        imageData: imageBytes || undefined, // base64编码的图像数据（可选）
        textResponse: textResponse || undefined, // AI的文本回复，如"Okay, here's a cat for you!"
        hasImage: !!imageBytes, // 标识是否包含图像
        prompt: request.prompt,
        model: request.model || this.DEFAULT_MODEL,
        createdAt: new Date(),
        metadata: {
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
      const prompt = request.prompt;

      // 将base64图像转换为适当的格式
      const imageData = request.sourceImage.replace(/^data:image\/[a-z]+;base64,/, '');

      const startTime = Date.now();

      // 🌊 使用流式API调用进行图像编辑
      const result = await this.withTimeout(
        (async () => {
          const stream = await this.genAI!.models.generateContentStream({
            model: request.model || this.DEFAULT_MODEL,
            contents: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'image/jpeg', // 根据实际格式调整
                  data: imageData
                }
              }
            ],
            config: {
              safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
              ]
            }
          });

          return this.parseStreamResponse(stream, '图像编辑');
        })(),
        this.DEFAULT_TIMEOUT,
        '流式图像编辑'
      );

      const processingTime = Date.now() - startTime;
      console.log(`⏱️ 总处理耗时: ${processingTime}ms`);

      const editedImageData = result.imageBytes;
      const textResponse = result.textResponse;

      const aiResult: AIImageResult = {
        id: uuidv4(),
        imageData: editedImageData || undefined,
        textResponse: textResponse || undefined, // AI的文本回复，如"I've edited your image as requested!"
        hasImage: !!editedImageData, // 标识是否包含图像
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
      // 直接使用用户原始提示词
      const prompt = request.prompt;

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

      // 🌊 使用流式API调用进行图像融合
      const result = await this.withTimeout(
        (async () => {
          const stream = await this.genAI!.models.generateContentStream({
            model: request.model || this.DEFAULT_MODEL,
            contents: [{ text: prompt }, ...imageParts],
            config: {
              safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
              ]
            }
          });

          return this.parseStreamResponse(stream, '图像融合');
        })(),
        this.DEFAULT_TIMEOUT,
        '流式图像融合'
      );

      const processingTime = Date.now() - startTime;
      console.log(`⏱️ 总处理耗时: ${processingTime}ms`);

      const blendedImageData = result.imageBytes;
      const textResponse = result.textResponse;

      const aiResult: AIImageResult = {
        id: uuidv4(),
        imageData: blendedImageData || undefined,
        textResponse: textResponse || undefined, // AI的文本回复，如"I've blended your images together!"
        hasImage: !!blendedImageData, // 标识是否包含图像
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
      
      // 构建简化的意图识别系统提示
      const systemPrompt = `🌏 请用中文进行分析和回复。

你是一个智能助手，需要根据用户输入识别用户的主要意图。

${contextualPrompt}

🎯 **意图分类**（只需要识别用户想要做什么）：

**generation** - 用户想要创建全新的图像
- 例：画一张图、生成图像、创建新图片、重新画等

**editing** - 用户想要修改、编辑或融合现有图像  
- 例：编辑图片、修改图像、融合图片、调整图像等

**text** - 用户想要获得文字分析、解释或对话
- 例：分析图片、解释内容、对话交流、回答问题等

🚨 **重要原则**：
- 即使有现有图像，如果用户明确表达生成新图的意图，选择 generation
- 只有当用户想要修改/处理现有图像时，选择 editing
- 对于询问、分析、解释类需求，选择 text

⚠️ 请仔细理解用户意图，不要被现有图像数量影响判断。
🎯 回复格式：意图类别(generation/editing/text)|理由:中文说明`;

      console.log('📤 准备发送AI请求:', {
        模型: 'gemini-2.0-flash',
        提示词长度: systemPrompt.length,
        安全设置: '已配置4个类别为BLOCK_NONE'
      });

      // 使用Gemini进行工具选择
      const aiCallStartTime = Date.now();
      const result = await this.withTimeout(
        this.genAI.models.generateContent({
          model: 'gemini-2.0-flash', // 使用文本模型进行工具选择
          contents: [{ text: systemPrompt }],
          config: {
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
            ]
          }
        }),
        this.DEFAULT_TIMEOUT,
        '工具选择'
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
   * 检测用户是否明确要求分析图片
   */
  private isExplicitImageAnalysisRequest(userInput: string): boolean {
    const lowerInput = userInput.toLowerCase();
    
    // 明确的图片分析关键词
    const imageAnalysisKeywords = [
      '分析图片', '分析这张图', '分析图像', '看图', '识别图片', '图片内容',
      '这图片', '图中', '图上', '画面', '照片', '截图',
      'analyze image', 'what is in', 'describe image', 'image content',
      'picture shows', 'photo contains', 'image analysis'
    ];
    
    // 检查是否包含明确的图片分析关键词
    const hasImageKeyword = imageAnalysisKeywords.some(keyword => 
      lowerInput.includes(keyword)
    );
    
    // 排除数学计算、对话等非图片分析意图
    const isNonImageIntent = /[\d\+\-\*\/\=]/.test(userInput) || // 数学计算
                             lowerInput.includes('计算') ||
                             lowerInput.includes('算') ||
                             lowerInput.includes('问题') ||
                             lowerInput.includes('解释');
    
    console.log('🔍 图片分析明确性检测:', {
      用户输入: userInput.substring(0, 50),
      有图片关键词: hasImageKeyword,
      是非图片意图: isNonImageIntent,
      最终判断: hasImageKeyword && !isNonImageIntent
    });
    
    return hasImageKeyword && !isNonImageIntent;
  }

  /**
   * 解析AI意图识别并进行第二层逻辑判断
   */
  private parseToolSelection(aiResponse: string, request: ToolSelectionRequest): ToolSelectionResult {
    const { userInput, imageCount, hasCachedImage } = request;

    console.log('🔍 开始解析AI意图识别响应:', aiResponse);

    // 解析意图识别格式：意图类别(generation/editing/text)|理由:中文说明
    let intentCategory = '';
    let aiReasoning = '';
    
    const intentMatch = aiResponse.match(/(generation|editing|text)\|理由:(.+)/);
    if (intentMatch) {
      intentCategory = intentMatch[1];
      aiReasoning = intentMatch[2].trim();
      
      console.log('✅ AI意图识别成功:', {
        意图类别: intentCategory,
        AI理由: aiReasoning
      });
    } else {
      // 兜底：从文本中提取意图类别
      if (aiResponse.includes('generation')) {
        intentCategory = 'generation';
      } else if (aiResponse.includes('editing')) {
        intentCategory = 'editing';
      } else if (aiResponse.includes('text')) {
        intentCategory = 'text';
      }
      
      aiReasoning = aiResponse;
      console.log('⚠️ 使用兜底解析:', { 意图类别: intentCategory, 原始响应: aiResponse });
    }

    // 如果无法识别意图类别，使用降级逻辑
    if (!intentCategory) {
      console.warn('❌ 无法识别AI意图类别，使用降级逻辑');
      return this.fallbackToolSelection(request);
    }

    // 第二层：基于意图类别和图片数量的纯逻辑判断
    const totalImageCount = imageCount + (hasCachedImage ? 1 : 0);
    let selectedTool = '';
    let logicReasoning = '';

    console.log('🔧 第二层逻辑判断:', {
      AI意图类别: intentCategory,
      显式图片数量: imageCount,
      有缓存图像: hasCachedImage,
      总图片数量: totalImageCount
    });

    switch (intentCategory) {
      case 'generation':
        selectedTool = 'generateImage';
        logicReasoning = '生成新图像，忽略现有图像';
        break;
        
      case 'editing':
        if (totalImageCount === 0) {
          selectedTool = 'generateImage';
          logicReasoning = '无图片可编辑，转为生成新图像';
        } else if (totalImageCount === 1) {
          selectedTool = 'editImage';
          logicReasoning = '单张图片，执行图片编辑';
        } else {
          selectedTool = 'blendImages';
          logicReasoning = `${totalImageCount}张图片，执行图片融合`;
        }
        break;
        
      case 'text':
        // 🎯 优先尊重AI的判断：既然AI说是text，通常就应该执行文字处理
        // 只有在用户明确要求分析图片时，才执行图片分析
        const isExplicitImageRequest = this.isExplicitImageAnalysisRequest(userInput);
        
        if (isExplicitImageRequest && totalImageCount > 0) {
          selectedTool = 'analyzeImage';
          logicReasoning = '明确要求分析图片，执行图片分析';
        } else {
          selectedTool = 'chatResponse';
          logicReasoning = totalImageCount > 0 
            ? 'AI判断为文字处理，尊重AI判断执行文字对话'
            : '无图片，执行文字对话';
        }
        break;
        
      default:
        console.warn('❌ 未知意图类别:', intentCategory, '使用降级逻辑');
        return this.fallbackToolSelection(request);
    }

    console.log('✅ 第二层逻辑判断完成:', {
      选择工具: selectedTool,
      逻辑理由: logicReasoning
    });

    // 构建参数
    const parameters: Record<string, string> = { prompt: userInput };


    // 构建完整推理过程
    const fullReasoning = `AI意图识别: ${intentCategory} (${aiReasoning}), 逻辑判断: ${logicReasoning}`;
    
    // 计算置信度（基于解析成功率）
    const confidence = intentMatch ? 0.95 : 0.8;

    console.log('✅ 工具选择解析完成:', {
      selectedTool,
      confidence,
      reasoning: fullReasoning.substring(0, 100) + '...'
    });

    return {
      selectedTool,
      parameters,
      confidence,
      reasoning: fullReasoning
    };
  }



  /**
   * 降级工具选择（基于三分类规则）
   */
  private fallbackToolSelection(request: ToolSelectionRequest): ToolSelectionResult {
    const { userInput, hasImages, imageCount, hasCachedImage } = request;

    console.log('🔧 三分类降级选择:', {
      用户输入: userInput.substring(0, 50) + '...',
      显式图片数量: imageCount,
      有缓存图像: hasCachedImage,
      总图像情况: hasImages
    });

    // 第一层分类：三分类判断
    let selectedCategory: string;
    let selectedTool: string;
    let reasoning: string;
    let confidence: number;

    // 简单默认策略（无关键词检测）
    const totalImageCount = imageCount + (hasCachedImage ? 1 : 0);
    
    if (totalImageCount === 0) {
      // 没有图片，默认生成
      selectedCategory = '图像生成类';
      selectedTool = 'generateImage';
      reasoning = '无图片，默认生成新图像';
      confidence = 0.6;
    } else if (totalImageCount === 1) {
      // 单张图片，默认编辑
      selectedCategory = '图像编辑类';
      selectedTool = 'editImage';
      reasoning = '单张图片，默认编辑';
      confidence = 0.6;
    } else {
      // 多张图片，默认融合
      selectedCategory = '图像编辑类';
      selectedTool = 'blendImages';
      reasoning = `${totalImageCount}张图片，默认融合`;
      confidence = 0.6;
    }

    console.log(`✅ 三分类完成:`, {
      第一层: selectedCategory,
      选择工具: selectedTool,
      置信度: confidence
    });

    // 构建参数
    const parameters: Record<string, string> = { prompt: userInput };
    

    return {
      selectedTool,
      parameters,
      confidence,
      reasoning
    };
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
      const analysisPrompt = request.prompt 
        ? `🌏 请用中文进行分析和回复。\n\n${request.prompt}`
        : `🌏 请用中文进行分析和回复。

请详细分析这张图片，包括：
1. 图片的主要内容和主题
2. 图片中的对象、人物、场景
3. 色彩和构图特点
4. 图片的风格和质量
5. 任何值得注意的细节

请用中文详细描述。`;

      // 将base64图像转换为适当的格式
      const imageData = request.sourceImage.replace(/^data:image\/[a-z]+;base64,/, '');

      const startTime = Date.now();

      // 🌊 使用流式API进行图像分析
      const result = await this.withTimeout(
        (async () => {
          const stream = await this.genAI.models.generateContentStream({
            model: 'gemini-2.0-flash',
            contents: [
              { text: analysisPrompt },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: imageData
                }
              }
            ],
            config: {
              safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
              ]
            }
          });

          const streamResult = await this.parseStreamResponse(stream, '图像分析');
          // 图像分析只返回文本，不期望图像数据
          return { text: streamResult.textResponse };
        })(),
        this.DEFAULT_TIMEOUT,
        '流式图像分析'
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
        input: request.prompt || '分析图像',
        output: analysisResult.analysis,
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
      const finalPrompt = `请用中文回复以下内容：\n\n${contextualPrompt}`;
      
      console.log('🧠 文本对话使用上下文:', finalPrompt.substring(0, 200) + '...');

      // 🌊 使用流式API进行文本对话
      const result = await this.withTimeout(
        (async () => {
          const stream = await this.genAI.models.generateContentStream({
            model: 'gemini-2.0-flash',
            contents: [{ text: finalPrompt }],
            config: {
              safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
              ]
            }
          });

          const streamResult = await this.parseStreamResponse(stream, '文本对话');
          // 文本对话只返回文本，不期望图像数据
          return { text: streamResult.textResponse };
        })(),
        this.DEFAULT_TIMEOUT,
        '流式文本对话'
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
        error: this.createError('TEXT_GENERATION_FAILED', error instanceof Error ? error.message : 'Text generation failed', error)
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
      const result = await this.withTimeout(
        this.genAI!.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: 'Hello, this is a connection test. Please respond with "Connection successful!"'
        }),
        this.DEFAULT_TIMEOUT,
        'API连接测试'
      );

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