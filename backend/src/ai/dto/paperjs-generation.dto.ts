import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Paper.js 代码生成请求 DTO
 */
export class PaperJSGenerateRequestDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsOptional()
  @IsString()
  @IsIn(['gemini', 'gemini-pro', 'banana'], {
    message: 'aiProvider must be either gemini, gemini-pro, or banana',
  })
  aiProvider?: 'gemini' | 'gemini-pro' | 'banana';

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
}

/**
 * Paper.js 代码生成响应 DTO
 */
export interface PaperJSGenerateResponseDto {
  code: string;
  explanation?: string;
  model: string;
  provider: string;
  createdAt: string;
  metadata?: {
    canvasSize?: { width: number; height: number };
    processingTime?: number;
    [key: string]: unknown;
  };
}
