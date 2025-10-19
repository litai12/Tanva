/**
 * Google Gemini 2.0 Veo 视频生成服务
 * 使用 Gemini API 生成高质量视频
 */

import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import { contextManager } from '@/services/contextManager';
import type {
  VideoGenerateRequest,
  VideoExtendRequest,
  VideoGenerationResult,
  VideoGenerationStatus,
  AIServiceResponse,
  AIError
} from '@/types/video';

interface VideoTask {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
  resultUrl?: string;
  error?: string;
}

class VeoVideoService {
  private genAI: GoogleGenAI | null = null;
  private readonly DEFAULT_MODEL = 'gemini-2.0-flash';
  private readonly VIDEO_MODEL = 'veo-3.1-generate-preview'; // Veo 3.1 Preview 模型
  private readonly DEFAULT_TIMEOUT = 300000; // 5分钟超时
  private videoTasks: Map<string, VideoTask> = new Map();
  private pollInterval: number = 2000; // 轮询间隔（毫秒）

  constructor() {
    this.initializeClient();
  }

  private initializeClient(): void {
    const apiKey = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_GOOGLE_GEMINI_API_KEY
      : (typeof process !== 'undefined' ? (process as any).env?.VITE_GOOGLE_GEMINI_API_KEY : undefined);

    // ❌ 不再使用硬编码的默认 API Key
    // 必须通过环境变量设置你的真实 API Key
    const finalApiKey = apiKey;

    if (!finalApiKey) {
      console.error('❌ 严重错误：Google Gemini API Key 未设置！');
      console.warn('📋 请按以下步骤操作：');
      console.warn('1️⃣ 创建 .env.local 文件（项目根目录）');
      console.warn('2️⃣ 添加：VITE_GOOGLE_GEMINI_API_KEY=你的_API_Key');
      console.warn('3️⃣ 获取 API Key：https://console.cloud.google.com/apis/credentials');
      console.warn('4️⃣ 重启开发服务器：npm run dev');
      return;
    }

    console.log('🎬 初始化 Veo 视频服务...');
    console.log('🔑 使用API密钥:', finalApiKey.substring(0, 10) + '...');

    try {
      this.genAI = new GoogleGenAI({ apiKey: finalApiKey });
      console.log('✅ Veo 视频服务初始化成功');
      console.log('📹 当前使用模型: Veo 3.1 Preview (veo-3.1-generate-preview)');
    } catch (error) {
      console.error('❌ 初始化失败:', error);
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
   * 生成视频
   */
  async generateVideo(request: VideoGenerateRequest): Promise<AIServiceResponse<VideoGenerationResult>> {
    console.log('🎬 开始生成视频:', {
      prompt: request.prompt,
      duration: request.duration,
      resolution: request.resolution
    });

    if (!this.genAI) {
      return {
        success: false,
        error: this.createError(
          'CLIENT_NOT_INITIALIZED',
          'Google GenAI client is not initialized. Please check your API key.'
        )
      };
    }

    const videoId = uuidv4();
    const startTime = Date.now();

    try {
      // 构建 Veo 3.0 视频生成请求
      const config: any = {
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
        ]
      };

      // Veo 3.0 支持的分辨率：720p（推荐）或 1080p
      const resolution = request.resolution || '720p';
      console.log(`🎨 设置分辨率: ${resolution}`);

      // Veo 3.0 支持的时长：4, 6, 或 8 秒（可通过 Extend 功能扩展）
      const durationSeconds = request.duration || 8;
      if (![4, 6, 8].includes(durationSeconds)) {
        console.warn(`⚠️ 无效的时长: ${durationSeconds}秒，使用默认的 8 秒`);
      }
      console.log(`⏱️ 视频时长: ${durationSeconds}秒`);

      // 构建 Veo 3.0 专用的视频配置
      config.videoConfig = {
        resolution: resolution, // '720p' 或 '1080p'
        duration: durationSeconds + 's' // 时长格式：'4s', '6s', '8s'
      };

      // 如果提供了种子，用于可重复生成
      if (request.seed !== undefined) {
        config.seed = request.seed;
        console.log(`🌱 设置种子: ${request.seed}`);
      }

      // 构建提示词 - Veo 3.0 对提示词的质量要求很高
      const videoPrompt = `${request.prompt}`;

      console.log('📝 发送视频生成请求到 Veo 3.1 Preview:', {
        模型: this.VIDEO_MODEL,
        提示词长度: videoPrompt.length,
        时长: durationSeconds + '秒',
        分辨率: resolution,
        配置: config
      });

      // 创建任务记录
      const task: VideoTask = {
        id: videoId,
        status: 'processing',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.videoTasks.set(videoId, task);

      // 发送 Veo 3.1 Preview 视频生成请求
      // Veo 3.1 Preview 使用 generateContent API
      const response = await Promise.race([
        this.genAI.models.generateContent({
          model: this.VIDEO_MODEL,
          contents: videoPrompt,
          config
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), this.DEFAULT_TIMEOUT)
        )
      ]);

      console.log('📥 收到视频生成响应');

      // 解析响应获取视频数据
      const videoUrl = this.extractVideoUrl(response);
      const metadata = this.extractMetadata(response);

      if (!videoUrl) {
        throw new Error('No video URL returned from API');
      }

      // 更新任务状态
      task.status = 'completed';
      task.resultUrl = videoUrl;
      task.updatedAt = new Date();

      const processingTime = Date.now() - startTime;
      console.log(`✅ 视频生成成功 (耗时: ${processingTime}ms)`, {
        videoId,
        resolution,
        duration: durationSeconds,
        videoUrl: videoUrl.substring(0, 50) + '...'
      });

      // 构建生成结果
      const result: VideoGenerationResult = {
        id: videoId,
        videoUrl,
        prompt: request.prompt,
        model: this.VIDEO_MODEL,
        duration: durationSeconds,
        resolution: resolution,
        createdAt: new Date(),
        status: 'completed',
        metadata: {
          processingTime,
          ...metadata
        }
      };

      // 记录操作
      contextManager.recordOperation({
        type: 'video_generate',
        input: request.prompt,
        output: `视频生成成功，ID: ${videoId}`,
        success: true,
        metadata: {
          model: this.VIDEO_MODEL,
          duration: durationSeconds,
          resolution,
          processingTime,
          videoUrl
        }
      });

      return {
        success: true,
        data: result
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // 打印完整的错误对象用于诊断
      console.error('❌ 完整的错误对象:', error);
      console.error('❌ 错误消息:', errorMessage);
      console.error('❌ 错误类型:', error instanceof Error ? error.constructor.name : typeof error);

      // 如果是网络错误，打印详细信息
      if (error instanceof Error && error.message.includes('fetch')) {
        console.error('🔍 网络错误详情:', {
          message: error.message,
          stack: error.stack
        });
      }

      console.error('❌ 视频生成失败:', {
        错误: errorMessage,
        耗时: processingTime + 'ms',
        视频ID: videoId
      });

      // 更新任务状态为失败
      const task = this.videoTasks.get(videoId);
      if (task) {
        task.status = 'failed';
        task.error = errorMessage;
        task.updatedAt = new Date();
      }

      // 确定错误类型
      let errorCode = 'VIDEO_GENERATION_FAILED';
      let userMessage = errorMessage;

      if (errorMessage.includes('timeout')) {
        errorCode = 'REQUEST_TIMEOUT';
        userMessage = '视频生成超时，请重试';
      } else if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('INVALID_ARGUMENT')) {
        errorCode = 'INVALID_API_KEY';
        userMessage = 'API密钥无效或请求参数错误，请检查配置';
      } else if (errorMessage.includes('QUOTA_EXCEEDED') || errorMessage.includes('quota')) {
        errorCode = 'QUOTA_EXCEEDED';
        userMessage = 'API配额已用完，请检查账户余额';
      } else if (errorMessage.includes('billed users') || errorMessage.includes('billing')) {
        errorCode = 'BILLING_REQUIRED';
        userMessage = 'Gemini API需要付费账户，请升级您的Google Cloud账户';
      } else if (errorMessage.includes('MODEL_NOT_FOUND') || errorMessage.includes('model') || errorMessage.includes('not available')) {
        errorCode = 'MODEL_NOT_AVAILABLE';
        userMessage = '模型不可用或不存在。当前使用的模型: ' + this.VIDEO_MODEL;
      }

      return {
        success: false,
        error: this.createError(errorCode, userMessage, error)
      };
    }
  }

  /**
   * 扩展视频时长
   */
  async extendVideo(request: VideoExtendRequest): Promise<AIServiceResponse<VideoGenerationResult>> {
    console.log('🎬 开始扩展视频:', {
      sourceVideoId: request.sourceVideoId,
      extension: request.extensionSeconds + 's'
    });

    if (!this.genAI) {
      return {
        success: false,
        error: this.createError('CLIENT_NOT_INITIALIZED', 'GenAI client not initialized')
      };
    }

    const videoId = uuidv4();
    const startTime = Date.now();

    try {
      // 获取源视频信息
      const sourceTask = this.videoTasks.get(request.sourceVideoId);
      if (!sourceTask || !sourceTask.resultUrl) {
        throw new Error('Source video not found or not completed');
      }

      const config: any = {
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
        ]
      };

      // 构建扩展提示词
      const extendPrompt = `继续上一个视频的故事或场景，再生成${request.extensionSeconds}秒。${request.extensionPrompt || ''}`;

      console.log('📝 发送视频扩展请求:', {
        原视频ID: request.sourceVideoId,
        扩展时长: request.extensionSeconds + '秒',
        提示词: extendPrompt.substring(0, 100)
      });

      // 创建任务记录
      const task: VideoTask = {
        id: videoId,
        status: 'processing',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.videoTasks.set(videoId, task);

      // 发送请求
      const response = await Promise.race([
        this.genAI.models.generateContent({
          model: this.VIDEO_MODEL,
          contents: extendPrompt,
          config
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), this.DEFAULT_TIMEOUT)
        )
      ]);

      const videoUrl = this.extractVideoUrl(response);
      const metadata = this.extractMetadata(response);

      if (!videoUrl) {
        throw new Error('No extended video URL returned');
      }

      task.status = 'completed';
      task.resultUrl = videoUrl;
      task.updatedAt = new Date();

      const processingTime = Date.now() - startTime;
      console.log(`✅ 视频扩展成功 (耗时: ${processingTime}ms)`, {
        newVideoId: videoId,
        extensionSeconds: request.extensionSeconds
      });

      const result: VideoGenerationResult = {
        id: videoId,
        videoUrl,
        prompt: extendPrompt,
        model: this.VIDEO_MODEL,
        duration: request.extensionSeconds,
        createdAt: new Date(),
        status: 'completed',
        metadata: {
          processingTime,
          sourceVideoId: request.sourceVideoId,
          ...metadata
        }
      };

      return {
        success: true,
        data: result
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ 视频扩展失败:', errorMessage);

      return {
        success: false,
        error: this.createError('EXTEND_FAILED', errorMessage, error)
      };
    }
  }

  /**
   * 获取视频生成状态
   */
  getVideoStatus(videoId: string): VideoGenerationStatus {
    const task = this.videoTasks.get(videoId);

    if (!task) {
      return {
        videoId,
        status: 'unknown',
        progress: 0,
        createdAt: new Date()
      };
    }

    let progress = 0;
    switch (task.status) {
      case 'pending':
        progress = 10;
        break;
      case 'processing':
        progress = 50;
        break;
      case 'completed':
        progress = 100;
        break;
      case 'failed':
        progress = 0;
        break;
    }

    return {
      videoId,
      status: task.status,
      progress,
      resultUrl: task.resultUrl,
      error: task.error,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    };
  }

  /**
   * 轮询视频生成状态
   */
  async pollVideoStatus(videoId: string, maxDuration: number = 600000): Promise<boolean> {
    console.log(`⏳ 开始轮询视频 ${videoId} 的生成状态...`);

    const startTime = Date.now();

    while (Date.now() - startTime < maxDuration) {
      const status = this.getVideoStatus(videoId);

      console.log(`📊 当前进度: ${status.progress}% - ${status.status}`);

      if (status.status === 'completed') {
        console.log(`✅ 视频生成完成!`);
        return true;
      }

      if (status.status === 'failed') {
        console.error(`❌ 视频生成失败: ${status.error}`);
        return false;
      }

      // 等待一段时间后再次检查
      await new Promise(resolve => setTimeout(resolve, this.pollInterval));
    }

    console.warn(`⚠️ 轮询超时，未在 ${maxDuration}ms 内完成`);
    return false;
  }

  /**
   * 从响应中提取视频 URL
   */
  private extractVideoUrl(response: any): string | null {
    try {
      // 处理不同的响应格式
      if (response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];

        if (candidate.content && candidate.content.parts) {
          for (const part of candidate.content.parts) {
            // 检查是否有文件数据
            if (part.fileData && part.fileData.fileUri) {
              return part.fileData.fileUri;
            }

            // 检查是否有内联视频数据
            if (part.inlineData && part.inlineData.data) {
              return `data:video/mp4;base64,${part.inlineData.data}`;
            }

            // 检查文本中的 URL
            if (part.text) {
              const urlMatch = part.text.match(/https?:\/\/[^\s]+/);
              if (urlMatch) {
                return urlMatch[0];
              }
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.error('❌ 提取视频URL失败:', error);
      return null;
    }
  }

  /**
   * 从响应中提取元数据
   */
  private extractMetadata(response: any): Record<string, any> {
    const metadata: Record<string, any> = {};

    try {
      if (response.usageMetadata) {
        metadata.tokensUsed = response.usageMetadata.totalTokenCount;
      }

      if (response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        metadata.finishReason = candidate.finishReason;
      }

      return metadata;
    } catch (error) {
      console.warn('⚠️ 提取元数据失败:', error);
      return {};
    }
  }

  /**
   * 检查API是否可用
   */
  isAvailable(): boolean {
    const available = !!this.genAI;
    console.log('🔍 Veo 服务可用性:', available ? '✅ 可用' : '❌ 不可用');
    return available;
  }

  /**
   * 获取所有视频任务
   */
  getAllVideoTasks(): Map<string, VideoTask> {
    return this.videoTasks;
  }

  /**
   * 清理过期的任务记录
   */
  cleanupOldTasks(ageThreshold: number = 3600000): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [id, task] of this.videoTasks.entries()) {
      if (now - task.updatedAt.getTime() > ageThreshold) {
        this.videoTasks.delete(id);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 清理了 ${cleanedCount} 个过期任务记录`);
    }
  }
}

// 导出单例实例
export const veoVideoService = new VeoVideoService();
export default veoVideoService;
