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

export interface MidjourneyActionRequest {
  taskId: string;
  customId: string;
  state?: string;
  notifyHook?: string;
  chooseSameChannel?: string | boolean;
  accountFilter?: MidjourneyAccountFilter;
}

export interface MidjourneyModalRequest {
  taskId: string;
  prompt?: string;
  maskBase64?: string;
}

export interface ProviderOptionsPayload {
  runningHub?: RunningHubGenerateOptions;
  midjourney?: MidjourneyProviderOptions;
  [key: string]: any;
}

export interface ImageGenerationRequest {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  imageOnly?: boolean;
  providerOptions?: ProviderOptionsPayload;
}

export interface ImageEditRequest {
  prompt: string;
  sourceImage: string; // base64
  model?: string;
  aspectRatio?: string;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  imageOnly?: boolean;
  providerOptions?: ProviderOptionsPayload;
}

export interface ImageBlendRequest {
  prompt: string;
  sourceImages: string[]; // base64 array
  model?: string;
  aspectRatio?: string;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  imageOnly?: boolean;
  providerOptions?: ProviderOptionsPayload;
}

export interface ImageAnalysisRequest {
  prompt?: string;
  sourceImage: string; // base64
  model?: string;
  providerOptions?: ProviderOptionsPayload;
}

export interface TextChatRequest {
  prompt: string;
  model?: string;
  enableWebSearch?: boolean;
  language?: string;
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
}

export interface ToolSelectionRequest {
  prompt: string;
  availableTools?: string[];
  hasImages?: boolean;
  imageCount?: number;
  hasCachedImage?: boolean;
  context?: string;
  model?: string;
}

export interface ToolSelectionResult {
  selectedTool: string;
  reasoning: string;
  confidence: number;
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
