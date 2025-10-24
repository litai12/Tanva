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
  @IsIn(['gemini', 'banana', 'kuai'], { message: 'aiProvider must be either gemini, banana or kuai' })
  aiProvider?: 'gemini' | 'banana' | 'kuai';

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
