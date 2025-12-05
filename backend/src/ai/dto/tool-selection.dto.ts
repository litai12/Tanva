import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ToolSelectionRequestDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsOptional()
  @IsString()
  @IsIn(['gemini', 'gemini-pro', 'banana', 'banana-2.5', 'runninghub', 'midjourney'], {
    message: 'aiProvider must be either gemini, gemini-pro, banana, banana-2.5, runninghub or midjourney',
  })
  aiProvider?: 'gemini' | 'gemini-pro' | 'banana' | 'banana-2.5' | 'runninghub' | 'midjourney';

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsBoolean()
  hasImages?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  imageCount?: number;

  @IsOptional()
  @IsBoolean()
  hasCachedImage?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  availableTools?: string[];

  @IsOptional()
  @IsString()
  context?: string;
}
