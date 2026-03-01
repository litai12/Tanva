// DTOs for global image history create/query payloads.
import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateGlobalImageHistoryDto {
  @IsString()
  imageUrl!: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsString()
  sourceType!: string;

  @IsOptional()
  @IsString()
  sourceProjectId?: string;

  @IsOptional()
  @IsString()
  sourceProjectName?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class QueryGlobalImageHistoryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @IsString()
  sourceProjectId?: string;
}
