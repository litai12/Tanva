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

  @IsOptional()
  @IsIn(['research', 'canvasAgent'])
  mode?: 'research' | 'canvasAgent';

  @IsOptional()
  @IsObject()
  canvasContext?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  capabilityManifest?: Record<string, unknown>;

  // 风格锚定：生成契约（facade 认 <generation_contract> 段）
  @IsOptional()
  @IsObject()
  generationContract?: {
    version: 'v1';
    lockedAnchors: string[];
    editableVariable: string | null;
    forbiddenChanges: string[];
    approvedKeyframeId: string | null;
  };

  // 风格参考图原始 URL（小T把它接入生成节点 img 输入作为风格参考）
  @IsOptional()
  @IsString()
  styleReferenceUrl?: string;
}
