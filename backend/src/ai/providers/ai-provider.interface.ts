/**
 * AI 提供商统一接口定义
 * 所有 AI 提供商(Gemini, OpenAI, Claude等)都需要实现此接口
 */

export interface AIProviderConfig {
  apiKey: string;
  model?: string;
  [key: string]: any;
}

export interface RunningHubNodeInfo {
  nodeId: string;
  fieldName: string;
  fieldValue: string;
  description?: string;
}

export interface RunningHubGenerateOptions {
  webappId?: string;
  webhookUrl?: string;
  nodeInfoList: RunningHubNodeInfo[];
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

export interface MidjourneyAccountFilter {
  channelId?: string;
  instanceId?: string;
  modes?: string[];
  remark?: string;
  remix?: string;
  remixAutoConsidered?: boolean;
}

export interface MidjourneyProviderOptions {
  mode?: 'FAST' | 'RELAX';
  botType?: string;
  notifyHook?: string;
  state?: string;
  dimensions?: 'PORTRAIT' | 'SQUARE' | 'LANDSCAPE';
  base64Array?: string[];
  base64?: string;
  maskBase64?: string;
  remix?: boolean;
  accountFilter?: MidjourneyAccountFilter;
}

export interface MidjourneyButtonInfo {
  customId: string;
  label: string;
  emoji?: string | null;
  type?: number;
  style?: number;
  disabled?: boolean;
}

export type BananaImageRoute = 'normal' | 'stable' | 'ultra';

export interface BananaProviderOptions {
  imageRoute?: BananaImageRoute;
}

export interface ProviderOptionsPayload {
  banana?: BananaProviderOptions;
  runningHub?: RunningHubGenerateOptions;
  midjourney?: MidjourneyProviderOptions;
  [key: string]: any;
}

export interface ImageGenerationRequest {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  quality?: 'auto' | 'low' | 'medium' | 'high';
  background?: 'auto' | 'opaque' | 'transparent';
  moderation?: 'auto' | 'low';
  outputCompression?: number;
  maskUrl?: string;
  thinkingLevel?: 'high' | 'low';
  outputFormat?: 'jpeg' | 'png' | 'webp';
  imageOnly?: boolean;
  enableWebSearch?: boolean;
  providerOptions?: ProviderOptionsPayload;
  imageUrls?: string[];
  googleSearch?: boolean;
  googleImageSearch?: boolean;
  batchMode?: boolean;
  batchCount?: number;
  officialFallback?: boolean;
}

export interface ImageEditRequest {
  prompt: string;
  sourceImage: string; // base64
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  thinkingLevel?: 'high' | 'low';
  outputFormat?: 'jpeg' | 'png' | 'webp';
  imageOnly?: boolean;
  providerOptions?: ProviderOptionsPayload;
}

export interface ImageBlendRequest {
  prompt: string;
  sourceImages: string[]; // base64 array
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  thinkingLevel?: 'high' | 'low';
  outputFormat?: 'jpeg' | 'png' | 'webp';
  imageOnly?: boolean;
  providerOptions?: ProviderOptionsPayload;
}

export interface ImageAnalysisRequest {
  prompt?: string;
  sourceImage: string; // base64
  sourceImages?: string[]; // base64/url array (optional, multi-image analysis)
  model?: string;
  providerOptions?: ProviderOptionsPayload;
}

export interface VideoAnalysisRequest {
  prompt?: string;
  videoUrl?: string; // persisted input remains a remote URL; used by Responses input_video
  videoData?: string; // runtime-only raw base64; never persist in project/task data
  mimeType?: string;
  fileName?: string;
  model?: string;
  providerOptions?: ProviderOptionsPayload;
}

export interface VideoAnalysisResult {
  text: string;
  metadata?: Record<string, any>;
}

export interface TextChatRequest {
  prompt: string;
  model?: string;
  imageUrl?: string;
  imageUrls?: string[];
  enableWebSearch?: boolean;
  language?: string;
  thinkingLevel?: 'high' | 'low';
  providerOptions?: ProviderOptionsPayload;
}

export interface AIProviderResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface ImageResult {
  imageData?: string; // base64 编码的图像数据
  imageUrl?: string; // 图像 URL
  textResponse: string; // AI 的文本回复
  hasImage: boolean;
  metadata?: Record<string, any>;
}

export interface AnalysisResult {
  text: string;
  tags?: string[];
}

export interface TextResult {
  text: string;
  webSearchResult?: any;
  metadata?: Record<string, any>;
}

export interface ToolSelectionRequest {
  prompt: string;
  availableTools?: string[];
  hasImages?: boolean;
  imageCount?: number;
  hasCachedImage?: boolean;
  context?: string;
  model?: string;
  providerOptions?: ProviderOptionsPayload;
}

export interface ToolSelectionResult {
  selectedTool: string;
  reasoning: string;
  confidence: number;
}

export interface PaperJSGenerateRequest {
  prompt: string;
  model?: string;
  thinkingLevel?: 'high' | 'low';
  canvasWidth?: number;
  canvasHeight?: number;
}

export interface PaperJSResult {
  code: string;
  explanation?: string;
  metadata?: Record<string, any>;
}

/**
 * AI 提供商接口 - 所有提供商必须实现
 */
export interface IAIProvider {
  /**
   * 初始化提供商
   */
  initialize(): Promise<void>;

  /**
   * 生成图像
   */
  generateImage(
    request: ImageGenerationRequest
  ): Promise<AIProviderResponse<ImageResult>>;

  /**
   * 编辑图像
   */
  editImage(
    request: ImageEditRequest
  ): Promise<AIProviderResponse<ImageResult>>;

  /**
   * 融合多张图像
   */
  blendImages(
    request: ImageBlendRequest
  ): Promise<AIProviderResponse<ImageResult>>;

  /**
   * 分析图像
   */
  analyzeImage(
    request: ImageAnalysisRequest
  ): Promise<AIProviderResponse<AnalysisResult>>;

  /**
   * 分析完整视频。仅支持运行时内联数据的 provider 实现该可选能力；
   * 调用方不得把 videoData 写入设计 JSON、DB、Redis 或任务持久化字段。
   */
  analyzeVideo?(
    request: VideoAnalysisRequest
  ): Promise<AIProviderResponse<VideoAnalysisResult>>;

  /**
   * 文本对话
   */
  generateText(
    request: TextChatRequest
  ): Promise<AIProviderResponse<TextResult>>;

  /**
   * 工具选择 - AI 意图识别
   */
  selectTool(
    request: ToolSelectionRequest
  ): Promise<AIProviderResponse<ToolSelectionResult>>;

  /**
   * 生成 Paper.js 代码
   */
  generatePaperJS(
    request: PaperJSGenerateRequest
  ): Promise<AIProviderResponse<PaperJSResult>>;

  /**
   * 检查提供商是否可用
   */
  isAvailable(): boolean;

  /**
   * 获取提供商信息
   */
  getProviderInfo(): {
    name: string;
    version: string;
    supportedModels: string[];
  };
}

/**
 * 提供商成本信息
 */
export interface ProviderCostInfo {
  provider: string;
  model: string;
  operation: 'generate' | 'edit' | 'blend' | 'analyze' | 'text';
  inputCost: number; // 输入成本
  outputCost: number; // 输出成本
  estimatedTotalCost: number; // 估计总成本
}
