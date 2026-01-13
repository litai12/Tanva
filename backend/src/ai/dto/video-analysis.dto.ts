import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class AnalyzeVideoDto {
  @IsOptional()
  @IsString()
  prompt?: string;

  @IsString()
  @IsNotEmpty()
  videoUrl!: string; // OSS URL

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  aiProvider?: 'gemini' | 'gemini-pro' | 'banana' | 'banana-2.5' | 'runninghub' | 'midjourney';

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;
}

export class VideoAnalysisResultDto {
  analysis!: string;
  model?: string;
  provider?: string;
}
