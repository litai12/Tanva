import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 统一 Chat 接口 - 用户输入模式
 */
export enum ChatMode {
  AUTO = 'auto',           // 自动判断意图
  TEXT = 'text',           // 纯文本对话
  GENERATE = 'generate',   // 文生图
  EDIT = 'edit',           // 图片编辑
  BLEND = 'blend',         // 图片融合
  ANALYZE = 'analyze',     // 图片分析
  VIDEO = 'video',         // 视频生成
  VECTOR = 'vector',       // 矢量图生成
  PDF = 'pdf',             // PDF 分析
}

/**
 * 工具类型 - 后端执行的实际操作
 */
export type ChatTool =
  | 'generateImage'
  | 'editImage'
  | 'blendImages'
  | 'analyzeImage'
  | 'chatResponse'
  | 'generateVideo'
  | 'generatePaperJS'
  | 'analyzePdf';

/**
 * 附件类型
 */
export class ChatAttachmentsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[]; // base64 图片数组

  @IsOptional()
  @IsString()
  pdf?: string; // base64 PDF

  @IsOptional()
  @IsString()
  pdfFileName?: string; // PDF 文件名
}

/**
 * 图片生成选项
 */
export class ImageOptionsDto {
  @IsOptional()
  @IsString()
  aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';

  @IsOptional()
  @IsString()
  imageSize?: '1K' | '2K' | '4K';

  @IsOptional()
  @IsString()
  outputFormat?: 'jpeg' | 'png' | 'webp';

  @IsOptional()
  @IsString()
  thinkingLevel?: 'high' | 'low';

  @IsOptional()
  @IsBoolean()
  imageOnly?: boolean;
}

/**
 * 视频生成选项
 */
export class VideoOptionsDto {
  @IsOptional()
  @IsString()
  quality?: 'hd' | 'sd';

  @IsOptional()
  @IsString()
  aspectRatio?: '16:9' | '9:16';

  @IsOptional()
  @IsString()
  duration?: '10' | '15' | '25';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  referenceImageUrls?: string[];
}

/**
 * 矢量图生成选项
 */
export class VectorOptionsDto {
  @IsOptional()
  @IsString()
  thinkingLevel?: 'high' | 'low';

  @IsOptional()
  canvasWidth?: number;

  @IsOptional()
  canvasHeight?: number;
}

/**
 * 统一 Chat 请求 DTO
 */
export class UnifiedChatDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsOptional()
  @IsEnum(ChatMode)
  mode?: ChatMode;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChatAttachmentsDto)
  attachments?: ChatAttachmentsDto;

  @IsOptional()
  @IsString()
  aiProvider?: 'gemini' | 'gemini-pro' | 'banana' | 'banana-2.5' | 'runninghub' | 'midjourney';

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImageOptionsDto)
  imageOptions?: ImageOptionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => VideoOptionsDto)
  videoOptions?: VideoOptionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => VectorOptionsDto)
  vectorOptions?: VectorOptionsDto;

  @IsOptional()
  @IsString()
  context?: string;

  @IsOptional()
  @IsBoolean()
  enableWebSearch?: boolean;

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;
}

/**
 * 统一 Chat 响应数据
 */
export interface UnifiedChatResponseData {
  // 文本响应 (所有工具都可能有)
  text?: string;

  // 图片响应 (generateImage, editImage, blendImages)
  imageData?: string;

  // 视频响应 (generateVideo)
  videoUrl?: string;
  thumbnailUrl?: string;

  // 矢量代码响应 (generatePaperJS)
  code?: string;
  explanation?: string;

  // 分析响应 (analyzeImage, analyzePdf)
  analysis?: string;

  // 元数据
  metadata?: Record<string, any>;

  // Web 搜索结果
  webSearchResult?: unknown;
}

/**
 * 统一 Chat 响应
 */
export interface UnifiedChatResponse {
  success: boolean;

  // 执行的工具
  tool: ChatTool;

  // 响应数据
  data: UnifiedChatResponseData;

  // 工具选择的推理过程
  reasoning?: string;

  // 模型信息
  model?: string;
  provider?: string;

  // 错误信息
  error?: {
    code: string;
    message: string;
  };
}

/**
 * SSE 流式事件类型
 */
export type SSEEventType =
  | 'start'      // 开始处理
  | 'tool'       // 工具选择完成
  | 'chunk'      // 文本内容块
  | 'image'      // 图片数据
  | 'video'      // 视频数据
  | 'code'       // 代码数据
  | 'done'       // 完成
  | 'error';     // 错误

/**
 * SSE 流式事件数据
 */
export interface SSEEventData {
  type: SSEEventType;

  // start 事件
  tool?: ChatTool;
  model?: string;
  provider?: string;

  // chunk 事件 - 增量文本
  text?: string;

  // image 事件
  imageData?: string;

  // video 事件
  videoUrl?: string;
  thumbnailUrl?: string;

  // code 事件
  code?: string;
  explanation?: string;

  // done 事件 - 完整响应
  data?: UnifiedChatResponseData;
  reasoning?: string;

  // error 事件
  error?: {
    code: string;
    message: string;
  };
}
