/**
 * Google Gemini Veo 视频生成相关类型定义
 */

// 视频生成请求参数
export interface VideoGenerateRequest {
  prompt: string;
  model?: string;
  duration?: number; // 视频时长（4, 6, 8 秒），默认 8 秒
  resolution?: '720p' | '1080p'; // 分辨率，默认 720p
  format?: 'mp4' | 'webm'; // 视频格式
  quality?: 'standard' | 'high'; // 质量等级
  seed?: number; // 随机种子（用于可重复性）
}

// 视频扩展请求参数
export interface VideoExtendRequest {
  sourceVideoId: string; // 源视频 ID
  extensionSeconds: number; // 扩展时长（秒），最多148秒
  extensionPrompt?: string; // 扩展提示词
}

// 视频生成结果
export interface VideoGenerationResult {
  id: string; // 视频 ID
  videoUrl: string; // 视频 URL 或 base64 数据
  prompt: string; // 原始提示词
  model: string; // 使用的模型
  duration: number; // 视频时长（秒）
  resolution?: string; // 分辨率
  createdAt: Date; // 创建时间
  status: 'pending' | 'processing' | 'completed' | 'failed'; // 状态
  metadata?: {
    processingTime?: number; // 处理耗时（毫秒）
    tokensUsed?: number; // 使用的 tokens 数
    sourceVideoId?: string; // 源视频 ID（扩展时）
    [key: string]: any;
  };
}

// 视频生成状态
export interface VideoGenerationStatus {
  videoId: string;
  status: 'unknown' | 'pending' | 'processing' | 'completed' | 'failed';
  progress: number; // 0-100
  resultUrl?: string;
  error?: string;
  createdAt: Date;
  updatedAt?: Date;
}

// AI 错误类型
export interface AIError {
  code: string;
  message: string;
  details?: unknown;
  timestamp: Date;
}

// AI 服务响应
export interface AIServiceResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: AIError;
}

// 视频任务进度事件
export interface VideoProgressEvent {
  videoId: string;
  phase: 'starting' | 'processing' | 'completed' | 'error';
  progress: number; // 0-100
  status?: string;
  message?: string;
  timestamp: number;
}

// 视频列表项
export interface VideoListItem {
  id: string;
  prompt: string;
  thumbnail?: string; // 视频缩略图
  duration: number;
  resolution: string;
  createdAt: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
}

// 视频配置选项
export interface VideoConfig {
  defaultDuration: number; // 默认时长
  defaultResolution: '720p' | '1080p'; // 默认分辨率
  maxDuration: number; // 最大时长（148秒）
  supportedResolutions: Array<'720p' | '1080p'>; // 支持的分辨率
  pollInterval: number; // 轮询间隔（毫秒）
  maxPollDuration: number; // 最大轮询时长（毫秒）
}

// 视频编辑选项
export interface VideoEditOptions {
  trim?: {
    start: number; // 开始时间（秒）
    end: number; // 结束时间（秒）
  };
  speed?: number; // 播放速度（0.5-2.0）
  format?: string; // 输出格式
  quality?: string; // 输出质量
}

// 视频导出配置
export interface VideoExportConfig {
  format: 'mp4' | 'webm' | 'gif';
  quality: 'low' | 'medium' | 'high';
  frameRate?: number; // 帧率（fps）
  bitrate?: string; // 比特率
}
