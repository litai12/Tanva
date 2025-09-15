/**
 * Google Gemini 2.5 Flash Image (Nano Banana) API 相关类型定义
 * 支持 gemini-2.5-flash-image-preview 模型
 */

// AI图像生成请求参数
export interface AIImageGenerateRequest {
  prompt: string;
  model?: string;
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
  imageData?: string; // base64 encoded image (可选，API可能只返回文本)
  textResponse?: string; // AI的文本回复，如"Okay, here's a cat for you!"
  prompt: string;
  model: string;
  createdAt: Date;
  hasImage: boolean; // 标识是否包含图像数据
  metadata?: {
    aspectRatio?: string;
    outputFormat?: string;
    processingTime?: number;
    tokenUsage?: number;
  };
}

// AI流式响应进度事件
export interface AIStreamProgressEvent {
  operationType: string;
  phase: 'starting' | 'text_received' | 'image_received' | 'completed' | 'error';
  chunkCount?: number;
  textLength?: number;
  hasImage?: boolean;
  message?: string;
  timestamp: number;
}

// AI生成状态
export const AIGenerationStatus = {
  IDLE: 'idle',
  GENERATING: 'generating',
  SUCCESS: 'success',
  ERROR: 'error'
} as const;

export type AIGenerationStatus = typeof AIGenerationStatus[keyof typeof AIGenerationStatus];

// AI错误类型
export interface AIError {
  code: string;
  message: string;
  details?: unknown;
  timestamp: Date;
}

// AI图像分析请求参数
export interface AIImageAnalyzeRequest {
  prompt?: string;
  sourceImage: string; // base64 encoded image
  model?: string;
}

// AI图像分析结果
export interface AIImageAnalysisResult {
  analysis: string;
  confidence?: number;
  tags?: string[];
}

// AI文本对话请求参数
export interface AITextChatRequest {
  prompt: string;
  model?: string;
  context?: string[];
}

// AI文本对话结果
export interface AITextChatResult {
  text: string;
  model: string;
  tokenUsage?: number;
}

// Function Calling 工具定义
export interface AITool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

// 工具选择请求
export interface ToolSelectionRequest {
  userInput: string;
  hasImages: boolean;
  imageCount: number;
  hasCachedImage?: boolean; // 是否有缓存图像
  availableTools: string[];
  context?: string;
}

// 工具选择结果
export interface ToolSelectionResult {
  selectedTool: string;
  parameters: Record<string, any>;
  confidence: number;
  reasoning: string;
}

// AI服务响应
export interface AIServiceResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: AIError;
}