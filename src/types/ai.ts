/**
 * Google Gemini 2.5 Flash Image API 相关类型定义
 * 支持 gemini-2.5-flash-image 模型
 */

// AI图像生成请求参数
export interface AIImageGenerateRequest {
  prompt: string;
  model?: string;
  aiProvider?: 'gemini' | 'banana';
  outputFormat?: 'jpeg' | 'png' | 'webp';
  aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9'; // 长宽比（官方支持枚举）
  imageOnly?: boolean; // 新增：仅返回图像，不返回文本
}

// AI图像编辑请求参数
export interface AIImageEditRequest {
  prompt: string;
  sourceImage: string; // base64 encoded image
  model?: string;
  aiProvider?: 'gemini' | 'banana';
  outputFormat?: 'jpeg' | 'png' | 'webp';
  aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9'; // 长宽比（官方支持枚举）
  imageOnly?: boolean; // 新增：仅返回图像，不返回文本
}

// AI图像融合请求参数
export interface AIImageBlendRequest {
  prompt: string;
  sourceImages: string[]; // base64 encoded images
  model?: string;
  aiProvider?: 'gemini' | 'banana';
  outputFormat?: 'jpeg' | 'png' | 'webp';
  aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9'; // 长宽比（官方支持枚举）
  imageOnly?: boolean; // 新增：仅返回图像，不返回文本
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
  phase: 'starting' | 'text_received' | 'text_delta' | 'image_received' | 'completed' | 'error';
  chunkCount?: number;
  textLength?: number;
  hasImage?: boolean;
  message?: string;
  // 新增：文本增量与完整文本（可选）
  deltaText?: string;
  fullText?: string;
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
  aiProvider?: 'gemini' | 'banana';
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
  aiProvider?: 'gemini' | 'banana';
  context?: string[];
  enableWebSearch?: boolean; // 是否启用联网搜索
}

// 网络搜索结果
export interface WebSearchResult {
  searchQueries: string[]; // 执行的搜索查询
  sources: WebSearchSource[]; // 搜索来源
  hasSearchResults: boolean; // 是否包含搜索结果
}

// 搜索来源信息
export interface WebSearchSource {
  title: string;
  url: string;
  snippet: string;
  relevanceScore?: number;
}

// AI文本对话结果
export interface AITextChatResult {
  text: string;
  model: string;
  tokenUsage?: number;
  webSearchResult?: WebSearchResult; // 联网搜索结果
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
  prompt?: string;
  aiProvider?: 'gemini' | 'banana';
  model?: string;
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
