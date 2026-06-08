import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

const SUPPORTED_TOOLS = [
  'generateImage',
  'editImage',
  'blendImages',
  'analyzeImage',
  'chatResponse',
  'generateVideo',
  'generatePaperJS',
] as const;

export class CreateAgentRunDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  aiProvider?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;

  @IsOptional()
  @IsIn(['high', 'low'])
  thinkingLevel?: 'high' | 'low';

  @IsOptional()
  @IsString()
  manualMode?: string;

  @IsOptional()
  @IsArray()
  @IsIn(SUPPORTED_TOOLS, { each: true })
  availableTools?: string[];

  @IsOptional()
  @IsBoolean()
  hasImages?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  imageCount?: number;

  @IsOptional()
  @IsBoolean()
  enableWebSearch?: boolean;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
