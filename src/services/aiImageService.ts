// @ts-nocheck
/**
 * Google Gemini 2.5 Flash Image API 服务层
 * 处理AI图像生成、编辑和融合功能
 * 使用 gemini-2.5-flash-image 模型
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
  private readonly DEFAULT_MODEL = 'gemini-2.5-flash-image';
  private readonly DEFAULT_TIMEOUT = 120000; // 增加到120秒
  private readonly MAX_IMAGE_RETRIES = 5; // 图像生成最大重试次数（针对无图像返回）
  private readonly IMAGE_RETRY_DELAY_BASE = 500; // 固定重试延迟（毫秒，压缩等待时间）

  constructor() {
    this.initializeClient();
  }

  private initializeClient(): void {
    // 兼容 Vite 和 Node.js 环境
    const apiKey = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_GOOGLE_GEMINI_API_KEY
      : (typeof process !== 'undefined' ? (process as any).env?.VITE_GOOGLE_GEMINI_API_KEY : undefined);

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
   * 验证图像数据的完整性和格式
   */
  private validateImageData(imageData: string, operationType: string): {
    isValid: boolean;
    reason?: string;
    severity?: 'warning' | 'error';
    info?: string;
    debugInfo?: any;
  } {
    // 🔍 调试信息收集
    const debugInfo = {
      数据长度: imageData.length,
      前100字符: imageData.substring(0, 100),
      后100字符: imageData.substring(Math.max(0, imageData.length - 100)),
      是否为空: imageData === '',
      是否包含空格: imageData.includes(' '),
      是否包含换行: imageData.includes('\n')
    };

    // 基本检查：是否为空
    if (!imageData || imageData.length === 0) {
      return {
        isValid: false,
        reason: '图像数据为空',
        severity: 'error',
        debugInfo
      };
    }

    // 更宽松的长度检查（降低到100字符，因为可能是小图标）
    if (imageData.length < 100) {
      return {
        isValid: false,
        reason: `图像数据太短 (${imageData.length}字符)，可能不完整`,
        severity: 'error',
        debugInfo
      };
    }

    // Base64格式验证 - 更宽松，只检查前1000字符
    const sampleForValidation = imageData.substring(0, 1000);
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(sampleForValidation)) {
      // 检查是否包含非法字符
      const illegalChars = sampleForValidation.match(/[^A-Za-z0-9+/=]/g);
      return {
        isValid: false,
        reason: `图像数据包含非Base64字符: ${illegalChars ? illegalChars.slice(0, 5).join(', ') : 'unknown'}`,
        severity: 'error',
        debugInfo
      };
    }

    // 检查常见图像格式的文件头
    const headerChecks = [
      { format: 'PNG', header: 'iVBORw0KGgo' }, // PNG header
      { format: 'JPEG', header: '/9j/' },       // JPEG header
      { format: 'GIF', header: 'R0lGODlh' },   // GIF header
      { format: 'WebP', header: 'UklGR' },      // WebP header
      { format: 'BMP', header: 'Qk' },          // BMP header
      { format: 'ICO', header: 'AAABAA' }       // ICO header
    ];

    const detectedFormat = headerChecks.find(check => 
      imageData.startsWith(check.header)
    );

    if (!detectedFormat) {
      // 不再作为错误，只是警告
      console.warn('⚠️ 未检测到常见图像格式标识符，但数据可能仍然有效');
      debugInfo['格式检测'] = '未知格式';
    } else {
      debugInfo['格式检测'] = detectedFormat.format;
    }

    // 估算图像大小（Base64编码后的大小约为原始大小的4/3）
    const estimatedSizeBytes = (imageData.length * 3) / 4;
    const estimatedSizeKB = Math.round(estimatedSizeBytes / 1024);

    return {
      isValid: true,
      info: `${detectedFormat?.format || '未知'}格式, 约${estimatedSizeKB}KB, ${imageData.length}字符`,
      debugInfo
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

  /**
   * 带重试机制的异步操作包装器
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationType: string,
    maxRetries: number = 2,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        console.log(`🔄 ${operationType} 尝试 ${attempt}/${maxRetries + 1}`);
        const result = await operation();
        
        if (attempt > 1) {
          console.log(`✅ ${operationType} 在第${attempt}次尝试成功`);
        }
        
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt <= maxRetries) {
          const delay = baseDelay; // 使用固定延迟，避免无谓的逐步拉长等待
          console.warn(`⚠️ ${operationType} 第${attempt}次尝试失败: ${lastError.message}, ${delay}ms后重试...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error(`❌ ${operationType} 所有尝试失败`);
        }
      }
    }
    
    throw lastError!;
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
   * 使用 generateImages 接口执行图像生成（支持官方的 aspectRatio 枚举）
   */
  private async generateImageWithAspectRatio(
    prompt: string,
    request: AIImageGenerateRequest
  ): Promise<{ imageBytes: string | null; textResponse: string }> {
    if (!this.genAI) {
      throw new Error('Google GenAI client is not initialized');
    }

    const model = request.model || this.DEFAULT_MODEL;
    const config: Record<string, unknown> = {
      numberOfImages: 1,
      safetyFilterLevel: 'BLOCK_NONE'
    };

    if (request.aspectRatio) {
      config.aspectRatio = request.aspectRatio;
      console.log(`🎨 generateImages 接口设置长宽比: ${request.aspectRatio}`);
    }

    if (request.outputFormat) {
      config.outputMimeType = `image/${request.outputFormat}`;
    }

    // 发送开始事件
    this.emitProgressUpdate('图像生成', {
      phase: 'starting',
      message: '通过 generateImages 发起请求'
    });

    const response = await this.genAI.models.generateImages({
      model,
      prompt,
      config
    });

    const generatedImage = response.generatedImages?.[0];
    const imageBytes = generatedImage?.image?.imageBytes || null;

    if (imageBytes) {
      this.emitProgressUpdate('图像生成', {
        phase: 'image_received',
        chunkCount: 1,
        hasImage: true,
        message: 'generateImages 返回图像数据'
      });
    } else {
      console.warn('⚠️ generateImages 未返回图像数据', {
        hasGeneratedImages: !!response.generatedImages,
        generatedImagesLength: response.generatedImages?.length || 0,
        positivePromptSafetyAttributes: response.positivePromptSafetyAttributes
      });
    }

    this.emitProgressUpdate('图像生成', {
      phase: 'completed',
      chunkCount: 1,
      textLength: 0,
      hasImage: !!imageBytes,
      message: 'generateImages 请求完成'
    });

    // generateImages 不会返回额外文本，这里保持空字符串以兼容后续流程
    return {
      imageBytes,
      textResponse: ''
    };
  }

  /**
   * 处理流式响应的通用解析器
   */
  private async parseStreamResponse(
    stream: any,
    operationType: string
  ): Promise<{ imageBytes: string | null; textResponse: string }> {
    console.log(`🌊 开始${operationType}流式响应解析...`);

    // 精确计时：首包/首图/总耗时
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    let tFirstChunk: number | null = null;
    let tFirstImage: number | null = null;

    // 发送开始事件
    this.emitProgressUpdate(operationType, {
      phase: 'starting',
      message: `开始接收${operationType}流式响应`
    });

    let textResponse: string = '';
    let imageBytes: string | null = null;
    let imageDataChunks: string[] = []; // 用于累积图像数据块
    let chunkCount = 0;
    let textChunks: string[] = [];
    let totalResponseSize = 0;
    let hasReceivedText = false;
    let hasReceivedImage = false;
    let currentImageMimeType: string | null = null;
    
    // 🔍 增强调试：追踪每个chunk的详细信息
    const debugChunks: Array<{
      index: number;
      hasText: boolean;
      textLength: number;
      hasImageData: boolean;
      imageDataLength: number;
      mimeType?: string;
    }> = [];

    try {
      for await (const chunk of stream) {
        chunkCount++;
        if (tFirstChunk == null) {
          tFirstChunk = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
          console.log(`⏱️ ${operationType}首个响应块耗时: ${Math.round(tFirstChunk)}ms`);
        }
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

            // 文本增量事件：逐段通知UI进行流式渲染
            this.emitProgressUpdate(operationType, {
              phase: 'text_delta',
              chunkCount,
              textLength: textResponse.length,
              deltaText: part.text,
              message: `收到${operationType}文本增量`
            });

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

          // 处理图像数据 - 修复：累积而不是覆盖
          if (part.inlineData && part.inlineData.data && typeof part.inlineData.data === 'string') {
            const currentChunk = part.inlineData.data;
            const chunkSize = currentChunk.length;
            
            // 🔍 增强调试：检查数据是否真的是有效的Base64
            const isValidBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(currentChunk.substring(0, 100));
            const chunkPreview = currentChunk.substring(0, 50);
            
            // 累积图像数据块
            imageDataChunks.push(currentChunk);
            totalResponseSize += chunkSize;
            
            // 记录MIME类型（通常在第一个块中）
            if (part.inlineData.mimeType && !currentImageMimeType) {
              currentImageMimeType = part.inlineData.mimeType;
            }
            
            console.log(`🖼️ ${operationType}图像数据块 #${imageDataChunks.length}:`, {
              大小: `${chunkSize}字符`,
              累积: `${imageDataChunks.reduce((sum, chunk) => sum + chunk.length, 0)}字符`,
              MIME: part.inlineData.mimeType || 'unknown',
              有效Base64: isValidBase64,
              数据预览: chunkPreview,
              是否为空: chunkSize === 0
            });

            // 首次接收到图像时发送通知
            if (!hasReceivedImage) {
              tFirstImage = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
              console.log(`⏱️ ${operationType}首个图像数据块耗时: ${Math.round(tFirstImage)}ms`);
              hasReceivedImage = true;
              this.emitProgressUpdate(operationType, {
                phase: 'image_received',
                chunkCount,
                hasImage: true,
                message: `已接收到${operationType}图像数据 (首图耗时 ${Math.round(tFirstImage)}ms)`
              });
            }
          }
        }

        // 实时进度反馈
        if (chunkCount % 5 === 0) {
          const totalImageLength = imageDataChunks.reduce((sum, chunk) => sum + chunk.length, 0);
          console.log(`📊 ${operationType}进度更新: ${chunkCount}个块, 文本${textChunks.length}段, 图像数据块${imageDataChunks.length}个(累积${totalImageLength}字符)`);
        }
      }

      // 合并所有图像数据块
      if (imageDataChunks.length > 0) {
        imageBytes = imageDataChunks.join('');
        
        // 🔍 关键调试：检查合并后的数据
        const mergedDataValid = imageBytes && imageBytes.length > 0;
        const isEmptyString = imageBytes === '';
        const actualLength = imageBytes ? imageBytes.length : 0;
        
        console.log(`🔧 图像数据合并分析:`, {
          块数量: imageDataChunks.length,
          每块长度: imageDataChunks.map(chunk => chunk.length),
          合并后长度: actualLength,
          是否为空字符串: isEmptyString,
          是否为null: imageBytes === null,
          是否有效: mergedDataValid,
          前50字符: imageBytes ? imageBytes.substring(0, 50) : 'N/A'
        });
        
        // 如果合并后是空字符串，置为null
        if (imageBytes === '' || imageBytes.length === 0) {
          console.warn('⚠️ 合并后的图像数据为空字符串，置为null');
          imageBytes = null;
        }
      }

      // 最终统计 - 增强调试信息
      const finalImageStatus = {
        有图像块: imageDataChunks.length > 0,
        图像数据非null: imageBytes !== null,
        图像数据非空串: imageBytes !== '',
        图像数据长度: imageBytes?.length || 0,
        最终判定: !!imageBytes && imageBytes.length > 0
      };
      
      console.log(`✅ ${operationType}流式响应完成:`, {
        总块数: chunkCount,
        文本段数: textChunks.length,
        文本总长度: textResponse.length,
        图像数据块数: imageDataChunks.length,
        图像状态: finalImageStatus,
        图像MIME类型: currentImageMimeType || 'unknown',
        总响应大小: totalResponseSize,
        平均块大小: chunkCount > 0 ? Math.round(totalResponseSize / chunkCount) : 0
      });

      // 数据验证
      if (!imageBytes && !textResponse) {
        console.error(`❌ ${operationType}响应为空: 没有接收到图像数据或文本响应`);
        throw new Error(`No ${operationType.toLowerCase()} data or text response found in stream`);
      }

      // 增强的图像数据验证
      if (imageBytes) {
        const validationResult = this.validateImageData(imageBytes, operationType);
        
        // 🔍 总是打印详细的验证结果
        console.log(`🔍 ${operationType}图像数据验证结果:`, {
          是否有效: validationResult.isValid,
          原因: validationResult.reason || '通过',
          严重性: validationResult.severity || 'ok',
          信息: validationResult.info,
          调试信息: validationResult.debugInfo
        });
        
        if (!validationResult.isValid) {
          console.warn(`⚠️ ${operationType}图像数据验证失败: ${validationResult.reason}`);
          
          // 根据验证失败的原因决定是否抛出错误
          if (validationResult.severity === 'error') {
            console.error(`❌ ${operationType}图像数据严重损坏，无法使用`);
            console.error('❌ 验证失败详情:', validationResult.debugInfo);
            throw new Error(`Invalid image data: ${validationResult.reason}`);
          }
        } else {
          console.log(`✅ ${operationType}图像数据验证通过: ${validationResult.info}`);
        }
      } else {
        console.warn(`⚠️ ${operationType}没有图像数据可验证 (imageBytes为null或undefined)`);
      }

      if (textResponse && textResponse.length > 10000) {
        console.warn(`⚠️ ${operationType}文本响应异常长: ${textResponse.length}字符`);
      }

      // 发送完成事件
      const tTotal = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
      console.log(`⏱️ ${operationType}阶段耗时统计:`, {
        首包耗时ms: tFirstChunk != null ? Math.round(tFirstChunk) : null,
        首图耗时ms: tFirstImage != null ? Math.round(tFirstImage) : null,
        总耗时ms: Math.round(tTotal)
      });
      this.emitProgressUpdate(operationType, {
        phase: 'completed',
        chunkCount,
        textLength: textResponse.length,
        hasImage: !!imageBytes,
        message: `${operationType}流式响应处理完成 (总耗时 ${Math.round(tTotal)}ms)`,
        fullText: textResponse
      });

      return { imageBytes, textResponse };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const totalImageLength = imageDataChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      
      console.error(`❌ ${operationType}流式响应解析出错:`, {
        错误: errorMessage,
        已处理块数: chunkCount,
        已获取文本长度: textResponse.length,
        图像数据块数: imageDataChunks.length,
        图像累积长度: totalImageLength,
        最终图像状态: !!imageBytes ? `有(${imageBytes.length}字符)` : '无'
      });

      // 发送错误事件
      this.emitProgressUpdate(operationType, {
        phase: 'error',
        chunkCount,
        textLength: textResponse.length,
        hasImage: !!imageBytes,
        message: `${operationType}流式响应处理失败: ${errorMessage} (已处理${imageDataChunks.length}个图像块)`
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
      
      // 🔄 专门针对"无图像返回"的重试机制
      const maxImageRetries = this.MAX_IMAGE_RETRIES;
      let imageGenerationAttempt = 0;
      let lastResult: any = null;
      
      while (imageGenerationAttempt < maxImageRetries) {
        imageGenerationAttempt++;
        console.log(`🎯 图像生成尝试 ${imageGenerationAttempt}/${maxImageRetries}`);
        
        // 使用带重试的流式API调用和数据解析
        const result = await this.withRetry(
          async () => {
            return await this.withTimeout(
              (async () => {
                // 统一使用 generateContentStream API，支持长宽比和仅图像模式
                // if (request.aspectRatio) {
                //   return await this.generateImageWithAspectRatio(prompt, request);
                // }

                // 🎨 构建配置对象（流式接口）
                const config: any = {
                  safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
                  ]
                };

                // 🎨 仅图像模式：只返回图像，不返回文本
                const responseModalities = request.imageOnly ? ['Image'] : ['Text', 'Image'];
                config.responseModalities = responseModalities;
                if (request.imageOnly) {
                  console.log('🎨 启用仅图像模式 (Image only)');
                } else {
                  console.log('📝 启用图文模式 (Text + Image)');
                }

                // 🔍 调试：检查request.aspectRatio的值
                console.log('🔍 检查request.aspectRatio:', {
                  aspectRatio: request.aspectRatio,
                  type: typeof request.aspectRatio,
                  isTruthy: !!request.aspectRatio
                });

                // 🎨 长宽比配置 - 严格按照官方格式
                if (request.aspectRatio) {
                  config.imageConfig = {
                    aspectRatio: request.aspectRatio
                  };
                  console.log(`🎨 设置长宽比: ${request.aspectRatio}`);
                } else {
                  console.log('⚠️ request.aspectRatio为空，跳过长宽比设置');
                }
                
                console.log('🔍 完整config对象:', JSON.stringify(config, null, 2));
                
                // 🔍 显示实际的JavaScript对象（无转义）
                console.log('🔍 实际config对象:', config);
                
                // 🔍 详细调试：API调用前的参数检查
                // 🔍 打印完整的API请求信息（与demo页面格式一致）
                const apiRequestInfo = {
                  model: request.model || this.DEFAULT_MODEL,
                  prompt: prompt,
                  aspectRatio: request.aspectRatio || '自动',
                  imageOnly: request.imageOnly || false,
                  responseModalities,
                  config: config,
                  timestamp: new Date().toISOString()
                };
                
                console.log('🔍 发送给API的完整请求信息:', apiRequestInfo);
                console.log('🔍 发送的配置:', JSON.stringify(apiRequestInfo, null, 2));
                
                // 🛰️ 向调试面板发送API配置信息
                try { 
                  window.dispatchEvent(new CustomEvent('apiConfigUpdate', { detail: apiRequestInfo })); 
                } catch {}
                // 🛰️ 广播请求开始（包含输出模式信息）
                try { 
                  window.dispatchEvent(new CustomEvent('aiRequestStart', { detail: { type: 'generate', aspectRatio: request.aspectRatio || null, imageOnly: !!request.imageOnly, responseModalities } }));
                } catch {}

                const stream = await this.genAI!.models.generateContentStream({
                  model: request.model || this.DEFAULT_MODEL,
                  contents: prompt,  // 与demo页面保持一致
                  config
                });

                // 🔍 API调用后调试
                console.log('🔍 API调用完成，开始解析流式响应...');
                console.log('🔍 最终发送的config:', JSON.stringify(config, null, 2));

                return this.parseStreamResponse(stream, '图像生成');
              })(),
              this.DEFAULT_TIMEOUT,
              '图像生成请求'
            );
          },
          '图像生成',
          3, // API调用失败时的重试次数
          1000 // 1秒延迟
        );
        
        lastResult = result;
        
        // 🔍 检查是否成功获取到图像
        if (result.imageBytes && result.imageBytes.length > 0) {
          console.log(`✅ 第${imageGenerationAttempt}次尝试成功获取到图像`);
          lastResult = result;
          break; // 成功获取到图像，退出重试循环
        } else {
          console.warn(`⚠️ 第${imageGenerationAttempt}次尝试未返回图像数据`);
          
          if (imageGenerationAttempt < maxImageRetries) {
            const retryDelay = this.IMAGE_RETRY_DELAY_BASE; // 固定1s等待
            console.log(`⏳ ${retryDelay}ms后进行第${imageGenerationAttempt + 1}次尝试...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          } else {
            console.error(`❌ 所有${maxImageRetries}次尝试均未能获取到图像`);
          }
        }
      }
      
      const result = lastResult;

      const processingTime = Date.now() - startTime;
      console.log(`⏱️ 总处理耗时: ${processingTime}ms`);

      const imageBytes = result.imageBytes;
      const textResponse = result.textResponse;

      // 🔍 关键调试点：检查API返回的原始数据
      console.log('🔍 API原始返回数据分析:', {
        imageBytes类型: typeof imageBytes,
        imageBytes是否为null: imageBytes === null,
        imageBytes是否为空串: imageBytes === '',
        imageBytes长度: imageBytes?.length || 0,
        textResponse类型: typeof textResponse,
        textResponse长度: textResponse?.length || 0
      });

      // 详细的结果分析和调试信息
      console.log('🔍 图像生成结果分析:', {
        有图像数据: !!imageBytes,
        图像数据长度: imageBytes?.length || 0,
        有文本响应: !!textResponse,
        文本响应长度: textResponse?.length || 0,
        文本响应预览: textResponse?.substring(0, 100) || 'N/A'
      });

      // 如果有图像数据，进行额外验证
      if (imageBytes) {
        const validationResult = this.validateImageData(imageBytes, '图像生成最终结果');
        console.log('🔍 最终图像数据验证:', validationResult);
      } else {
        console.error('❌ 图像生成失败：API未返回图像数据');
        console.error('❌ 仅获取到文本响应:', textResponse?.substring(0, 200) || '无');
      }

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

      console.log('✅ 图像生成成功:', {
        结果ID: aiResult.id,
        包含图像: aiResult.hasImage,
        图像数据大小: aiResult.imageData?.length || 0,
        文本响应: aiResult.textResponse?.substring(0, 50) || 'N/A'
      });

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
      
      // 🔄 专门针对"无图像返回"的重试机制
      const maxImageRetries = this.MAX_IMAGE_RETRIES;
      let imageEditAttempt = 0;
      let lastResult: any = null;
      
      while (imageEditAttempt < maxImageRetries) {
        imageEditAttempt++;
        console.log(`🎯 图像编辑尝试 ${imageEditAttempt}/${maxImageRetries}`);

        // 🌊 使用流式API调用进行图像编辑
        const result = await this.withTimeout(
          (async () => {
            // 🎨 构建配置对象
            const config: any = {
              safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
              ]
            };

            // 🎨 仅图像模式：只返回图像，不返回文本
            const responseModalities = request.imageOnly ? ['Image'] : ['Text', 'Image'];
            config.responseModalities = responseModalities;
            if (request.imageOnly) {
              console.log('🎨 启用仅图像模式 (Image only)');
            } else {
              console.log('📝 启用图文模式 (Text + Image)');
            }

            // 🎨 长宽比配置
            if (request.aspectRatio) {
              config.imageConfig = {
                aspectRatio: request.aspectRatio
              };
              console.log(`🎨 设置长宽比: ${request.aspectRatio}`);
            }

            // 🛰️ 向调试面板广播：请求开始（编辑）
            try { window.dispatchEvent(new CustomEvent('aiRequestStart', { detail: { type: 'edit', aspectRatio: request.aspectRatio || null, imageOnly: !!request.imageOnly, responseModalities } })); } catch {}

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
              config
            });

            return this.parseStreamResponse(stream, '图像编辑');
          })(),
          this.DEFAULT_TIMEOUT,
          '流式图像编辑'
        );
        
        lastResult = result;
        
        // 🔍 检查是否成功获取到图像
        if (result.imageBytes && result.imageBytes.length > 0) {
          console.log(`✅ 第${imageEditAttempt}次编辑尝试成功获取到图像`);
          lastResult = result;
          break; // 成功获取到图像，退出重试循环
        } else {
          console.warn(`⚠️ 第${imageEditAttempt}次编辑尝试未返回图像数据`);
          
          if (imageEditAttempt < maxImageRetries) {
            const retryDelay = this.IMAGE_RETRY_DELAY_BASE; // 固定1s等待
            console.log(`⏳ ${retryDelay}ms后进行第${imageEditAttempt + 1}次编辑尝试...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          } else {
            console.error(`❌ 所有${maxImageRetries}次编辑尝试均未能获取到图像`);
          }
        }
      }
      
      const result = lastResult;

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
      
      // 🔄 专门针对"无图像返回"的重试机制
      const maxImageRetries = this.MAX_IMAGE_RETRIES;
      let imageBlendAttempt = 0;
      let lastResult: any = null;
      
      while (imageBlendAttempt < maxImageRetries) {
        imageBlendAttempt++;
        console.log(`🎯 图像融合尝试 ${imageBlendAttempt}/${maxImageRetries}`);

        // 🌊 使用流式API调用进行图像融合
        const result = await this.withTimeout(
          (async () => {
            // 🎨 构建配置对象
            const config: any = {
              safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
              ]
            };

            // 🎨 仅图像模式：只返回图像，不返回文本
            const responseModalities = request.imageOnly ? ['Image'] : ['Text', 'Image'];
            config.responseModalities = responseModalities;
            if (request.imageOnly) {
              console.log('🎨 启用仅图像模式 (Image only)');
            } else {
              console.log('📝 启用图文模式 (Text + Image)');
            }

            // 🎨 长宽比配置
            if (request.aspectRatio) {
              config.imageConfig = {
                aspectRatio: request.aspectRatio
              };
              console.log(`🎨 设置长宽比: ${request.aspectRatio}`);
            }

            // 🛰️ 向调试面板广播：请求开始（融合）
            try { window.dispatchEvent(new CustomEvent('aiRequestStart', { detail: { type: 'blend', aspectRatio: request.aspectRatio || null, imageOnly: !!request.imageOnly, responseModalities } })); } catch {}

            const stream = await this.genAI!.models.generateContentStream({
              model: request.model || this.DEFAULT_MODEL,
              contents: [{ text: prompt }, ...imageParts],
              config
            });

            return this.parseStreamResponse(stream, '图像融合');
          })(),
          this.DEFAULT_TIMEOUT,
          '流式图像融合'
        );
        
        lastResult = result;
        
        // 🔍 检查是否成功获取到图像
        if (result.imageBytes && result.imageBytes.length > 0) {
          console.log(`✅ 第${imageBlendAttempt}次融合尝试成功获取到图像`);
          lastResult = result;
          break; // 成功获取到图像，退出重试循环
        } else {
          console.warn(`⚠️ 第${imageBlendAttempt}次融合尝试未返回图像数据`);
          
          if (imageBlendAttempt < maxImageRetries) {
            const retryDelay = this.IMAGE_RETRY_DELAY_BASE; // 固定1s等待
            console.log(`⏳ ${retryDelay}ms后进行第${imageBlendAttempt + 1}次融合尝试...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          } else {
            console.error(`❌ 所有${maxImageRetries}次融合尝试均未能获取到图像`);
          }
        }
      }
      
      const result = lastResult;

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
      : (typeof process !== 'undefined' ? (process as any).env?.VITE_GOOGLE_GEMINI_API_KEY : undefined);
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

      // 使用Gemini进行工具选择（带重试机制）
      const aiCallStartTime = Date.now();
      const result = await this.withRetry(
        async () => {
          return await this.withTimeout(
            this.genAI!.models.generateContent({
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
            '工具选择API调用'
          );
        },
        'AI工具选择',
        3, // API调用失败时的重试次数
          1000 // 1秒延迟
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
    const input = (userInput || '').trim();
    const lower = input.toLowerCase();

    // 更宽松的中英文匹配：允许“分析/看看/识别/描述/讲讲/说说 + (一下|下) + (这张)?(图/图片/照片/截图)”等可选词
    const cnPatterns: RegExp[] = [
      /(分[析解]|看|看看|看下|看一下|识别|描述|讲讲|说说|解释|评价).{0,8}((这张)?(图|图片|照片|截图))/i,
      /((这张)?(图|图片|照片|截图)).{0,8}(分[析解]|看|看看|识别|描述|解释|评价)/i,
      /(图中|图上|画面).{0,6}(是什么|有什|包含|描述|讲讲|说说)/i
    ];

    const enPatterns: RegExp[] = [
      /(analy[sz]e|describe|explain|identify|what\s+is\s+in|look\s+at).{0,20}(image|photo|picture|screenshot)/i,
      /(image|photo|picture|screenshot).{0,20}(analy[sz]e|describe|explain|identify)/i
    ];

    const matchesCN = cnPatterns.some((re) => re.test(input));
    const matchesEN = enPatterns.some((re) => re.test(lower));

    // 排除明显的非图片分析指令（数学/编程等）
    const notImage = /[\d\+\-\*\/\=]/.test(input) || /代码|程序|计算|算|证明/.test(input);

    const result = (matchesCN || matchesEN) && !notImage;
    console.log('🔍 图片分析明确性检测(宽松):', {
      输入: input.substring(0, 50),
      匹配中文: matchesCN,
      匹配英文: matchesEN,
      非图片意图: notImage,
      最终: result
    });
    return result;
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
    // 用户显式选择优先级最高，不计算缓存图像
    const userSelectedImageCount = imageCount; // 只计算用户显式选择的图片
    const hasCachedForFallback = hasCachedImage && imageCount === 0; // 只有没有显式选择时才考虑缓存
    let selectedTool = '';
    let logicReasoning = '';

    console.log('🔧 第二层逻辑判断:', {
      AI意图类别: intentCategory,
      用户显式选择数量: userSelectedImageCount,
      有缓存图像: hasCachedImage,
      缓存作为后备: hasCachedForFallback
    });

    switch (intentCategory) {
      case 'generation':
        selectedTool = 'generateImage';
        logicReasoning = '生成新图像，忽略现有图像';
        break;
        
      case 'editing':
        if (userSelectedImageCount === 0 && !hasCachedForFallback) {
          selectedTool = 'generateImage';
          logicReasoning = '无图片可编辑，转为生成新图像';
        } else if (userSelectedImageCount === 1 || hasCachedForFallback) {
          selectedTool = 'editImage';
          logicReasoning = userSelectedImageCount === 1 ? '用户选择单张图片，执行图片编辑' : '使用缓存图片，执行图片编辑';
        } else if (userSelectedImageCount >= 2) {
          selectedTool = 'blendImages';
          logicReasoning = `用户选择${userSelectedImageCount}张图片，执行图片融合`;
        }
        break;
        
      case 'text':
        // 如果用户上传了图片，并且用户输入明显与“分析图片”相关，则转为图片分析
        // 放宽判定，常见“你分析一下这张图”也命中
        const isExplicitImageRequest = this.isExplicitImageAnalysisRequest(userInput);
        const mentionsImageWord = /(图|图片|照片|截图|image|photo|picture|screenshot)/i.test(userInput);

        if ((userSelectedImageCount > 0 || hasCachedForFallback) && (isExplicitImageRequest || mentionsImageWord)) {
          selectedTool = 'analyzeImage';
          logicReasoning = isExplicitImageRequest
            ? '明确要求分析图片，执行图片分析'
            : '检测到上传图片且文本提到图片，优先进行图片分析';
        } else {
          selectedTool = 'chatResponse';
          logicReasoning = (userSelectedImageCount > 0 || hasCachedForFallback)
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

    // 简单默认策略（无关键词检测） - 用户显式选择优先
    const userSelectedImageCount = imageCount; // 只计算用户显式选择的图片
    const hasCachedForFallback = hasCachedImage && imageCount === 0; // 只有没有显式选择时才考虑缓存
    
    const wantAnalysis = this.isExplicitImageAnalysisRequest(userInput) || /(图|图片|照片|截图|image|photo|picture|screenshot)/i.test(userInput);

    if ((userSelectedImageCount > 0 || hasCachedForFallback) && wantAnalysis) {
      // 有图片且有明显分析意图 → 分析
      selectedCategory = '图像分析类';
      selectedTool = 'analyzeImage';
      reasoning = '检测到上传图片且文本包含分析相关词，执行图片分析';
      confidence = 0.95;
    } else if (userSelectedImageCount === 0 && !hasCachedForFallback) {
      // 没有图片，默认生成
      selectedCategory = '图像生成类';
      selectedTool = 'generateImage';
      reasoning = '无图片，默认生成新图像';
      confidence = 0.95;
    } else if (userSelectedImageCount === 1 || hasCachedForFallback) {
      // 单张图片，默认编辑
      selectedCategory = '图像编辑类';
      selectedTool = 'editImage';
      reasoning = userSelectedImageCount === 1 ? '用户选择单张图片，默认编辑' : '使用缓存图片，默认编辑';
      confidence = 0.95;
    } else {
      // 多张图片，默认融合
      selectedCategory = '图像编辑类';
      selectedTool = 'blendImages';
      reasoning = `用户选择${userSelectedImageCount}张图片，默认融合`;
      confidence = 0.95;
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
      console.log('🔍 是否启用联网搜索:', request.enableWebSearch ? '✅ 是' : '❌ 否');
      
      // 构建API配置
      const apiConfig: any = {
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
        ]
      };

      // 🔍 如果启用联网搜索，添加Google搜索工具
      if (request.enableWebSearch) {
        apiConfig.tools = [{ googleSearch: {} }];
        console.log('🔍 已添加Google搜索工具到API配置');
      }

      // 🌊 使用流式API进行文本对话
      const result = await this.withTimeout(
        (async () => {
          const stream = await this.genAI.models.generateContentStream({
            model: 'gemini-2.0-flash',
            contents: [{ text: finalPrompt }],
            config: apiConfig
          });

          const streamResult = await this.parseStreamResponse(stream, '文本对话');
          // 文本对话只返回文本，不期望图像数据
          return { 
            text: streamResult.textResponse,
            metadata: streamResult.metadata // 包含搜索元数据
          };
        })(),
        this.DEFAULT_TIMEOUT,
        '流式文本对话'
      );

      if (!result.text) {
        throw new Error('No text response from API');
      }

      // 🔍 处理搜索结果元数据
      let webSearchResult: any = undefined;
      if (request.enableWebSearch && result.metadata) {
        webSearchResult = this.parseWebSearchMetadata(result.metadata);
        if (webSearchResult.hasSearchResults) {
          console.log('🔍 联网搜索成功:', {
            查询数量: webSearchResult.searchQueries.length,
            来源数量: webSearchResult.sources.length
          });
        }
      }

      // 🧠 记录操作到上下文
      contextManager.recordOperation({
        type: 'chat',
        input: request.prompt,
        output: result.text,
        success: true,
        metadata: { 
          model: 'gemini-2.0-flash',
          enableWebSearch: request.enableWebSearch,
          hasSearchResults: webSearchResult?.hasSearchResults || false
        }
      });

      return {
        success: true,
        data: {
          text: result.text,
          model: 'gemini-2.0-flash',
          webSearchResult
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

  /**
   * 解析网络搜索元数据
   */
  private parseWebSearchMetadata(metadata: any): any {
    try {
      const webSearchResult = {
        searchQueries: [],
        sources: [],
        hasSearchResults: false
      };

      // 解析搜索查询
      if (metadata.webSearchQueries && Array.isArray(metadata.webSearchQueries)) {
        webSearchResult.searchQueries = metadata.webSearchQueries;
        console.log('🔍 解析到搜索查询:', webSearchResult.searchQueries);
      }

      // 解析搜索来源
      if (metadata.groundingChunks && Array.isArray(metadata.groundingChunks)) {
        webSearchResult.sources = metadata.groundingChunks.map((chunk: any) => ({
          title: chunk.web?.title || '未知标题',
          url: chunk.web?.uri || '',
          snippet: chunk.text || '',
          relevanceScore: chunk.confidence || 0
        }));
        console.log('🔍 解析到搜索来源:', webSearchResult.sources.length + '个');
      }

      // 判断是否有搜索结果
      webSearchResult.hasSearchResults = webSearchResult.searchQueries.length > 0 || webSearchResult.sources.length > 0;

      return webSearchResult;
    } catch (error) {
      console.warn('⚠️ 解析搜索元数据失败:', error);
      return {
        searchQueries: [],
        sources: [],
        hasSearchResults: false
      };
    }
  }
}

// 导出单例实例
export const aiImageService = new AIImageService();
export default aiImageService;
