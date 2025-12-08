import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 图像转矢量请求 DTO
 */
export class Img2VectorRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50 * 1024 * 1024) // 允许最大 50MB 的 base64 数据
  sourceImage!: string; // base64 图像数据

  @IsOptional()
  @IsString()
  prompt?: string; // 额外的描述提示词

  @IsOptional()
  @IsString()
  @IsIn(['gemini', 'gemini-pro', 'banana', 'banana-2.5'], {
    message: 'aiProvider must be either gemini, gemini-pro, banana, or banana-2.5',
  })
  aiProvider?: 'gemini' | 'gemini-pro' | 'banana' | 'banana-2.5';

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  @IsIn(['high', 'low'])
  thinkingLevel?: 'high' | 'low';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(10000)
  canvasWidth?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(10000)
  canvasHeight?: number;

  @IsOptional()
  @IsString()
  @IsIn(['simple', 'detailed', 'artistic'], {
    message: 'style must be either simple, detailed, or artistic',
  })
  style?: 'simple' | 'detailed' | 'artistic'; // 矢量风格
}

/**
 * 图像转矢量响应 DTO
 */
export interface Img2VectorResponseDto {
  code: string; // Paper.js 矢量代码
  imageAnalysis: string; // 图像分析结果
  explanation?: string; // 代码解释
  model: string;
  provider: string;
  createdAt: string;
  metadata?: {
    canvasSize?: { width: number; height: number };
    processingTime?: number;
    style?: string;
    [key: string]: unknown;
  };
}
