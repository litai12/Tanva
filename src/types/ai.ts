/**
 * Google Gemini 2.5 Flash Image (Nano Banana) API 相关类型定义
 * 支持 gemini-2.5-flash-image-preview 模型
 */

// AI图像生成请求参数
export interface AIImageGenerateRequest {
  prompt: string;
  model?: string;
  aspectRatio?: '1:1' | '9:16' | '16:9' | '4:3' | '3:4';
  outputFormat?: 'jpeg' | 'png' | 'webp';
}

// AI图像编辑请求参数
export interface AIImageEditRequest {
  prompt: string;
  sourceImage: string; // base64 encoded image
  model?: string;
  outputFormat?: 'jpeg' | 'png' | 'webp';
}

// AI图像融合请求参数
export interface AIImageBlendRequest {
  prompt: string;
  sourceImages: string[]; // base64 encoded images
  model?: string;
  outputFormat?: 'jpeg' | 'png' | 'webp';
}

// AI生成结果
export interface AIImageResult {
  id: string;
  imageData: string; // base64 encoded image
  prompt: string;
  model: string;
  createdAt: Date;
  metadata?: {
    aspectRatio?: string;
    outputFormat?: string;
    processingTime?: number;
    tokenUsage?: number;
  };
}

// AI生成状态
export enum AIGenerationStatus {
  IDLE = 'idle',
  GENERATING = 'generating',
  SUCCESS = 'success',
  ERROR = 'error'
}

// AI错误类型
export interface AIError {
  code: string;
  message: string;
  details?: unknown;
  timestamp: Date;
}

// AI服务响应
export interface AIServiceResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: AIError;
}