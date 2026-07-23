import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export type ReferenceImageItem =
  | string
  | {
      url: string;
      volcAssetId?: string;
      volcAssetStatus?: 'processing' | 'active' | 'failed';
      volcAssetKind?: 'bio-auth';
    };

export class VideoProviderRequestDto {
  @ApiProperty({ description: 'Provider' })
  @IsEnum(['kling', 'kling-2.6', 'kling-o3', 'vidu', 'viduq3-pro', 'doubao', 'wan2.7'])
  provider!: 'kling' | 'kling-2.6' | 'kling-o3' | 'vidu' | 'viduq3-pro' | 'doubao' | 'wan2.7';

  @ApiProperty({
    description:
      'Video generation mode (Vidu/Kling/Seedance specific values)',
    required: false,
  })
  @IsOptional()
  @IsString()
  videoMode?: string;

  @ApiProperty({ description: 'Prompt', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  prompt?: string;

  @ApiProperty({ description: 'Negative prompt (Kling omni)', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2500)
  negativePrompt?: string;

  @ApiProperty({ description: 'Reference image URL list', required: false, type: [String] })
  @IsOptional()
  @IsArray()
  referenceImages?: ReferenceImageItem[];

  @ApiProperty({
    description: 'Element/character reference image URL list (Kling omni element_list)',
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  elementImages?: ReferenceImageItem[];

  @ApiProperty({ description: 'Element/character name referenced via @name (Kling omni)', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  elementName?: string;

  @ApiProperty({ description: 'Element/character description (Kling omni)', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  elementDescription?: string;

  @ApiProperty({ description: 'Audio URL list', required: false, type: [String] })
  @IsOptional()
  @IsString({ each: true })
  audioUrls?: string[];

  @ApiProperty({ description: 'Reference video URL list', required: false, type: [String] })
  @IsOptional()
  @IsString({ each: true })
  referenceVideos?: string[];

  @ApiProperty({ description: 'Reference video URL', required: false })
  @IsOptional()
  @IsString()
  referenceVideo?: string;

  @ApiProperty({ description: 'Reference video type (feature/base)', required: false })
  @IsOptional()
  @IsString()
  referenceVideoType?: 'feature' | 'base';

  @ApiProperty({ description: 'Keep original sound (yes/no)', required: false })
  @IsOptional()
  @IsString()
  keepOriginalSound?: 'yes' | 'no';

  @ApiProperty({ description: 'Aspect ratio', required: false })
  @IsOptional()
  @IsString()
  aspectRatio?: string;

  @ApiProperty({ description: 'Duration in seconds', required: false })
  @IsOptional()
  @IsNumber()
  duration?: number;

  @ApiProperty({ description: 'Resolution', required: false })
  @IsOptional()
  @IsString()
  resolution?: string;

  @ApiProperty({ description: 'Style (Vidu)', required: false })
  @IsOptional()
  @IsString()
  style?: string;

  @ApiProperty({ description: 'Provider mode (e.g. Kling std/pro)', required: false })
  @IsOptional()
  @IsString()
  mode?: string;

  @ApiProperty({ description: 'Kling model version', required: false })
  @IsOptional()
  @IsString()
  klingModel?: string;

  @ApiProperty({ description: 'Vidu model version (q2/q3)', required: false })
  @IsOptional()
  @IsString()
  viduModel?: string;

  @ApiProperty({ description: 'Vidu concrete model variant for billing/logging', required: false })
  @IsOptional()
  @IsString()
  viduModelVariant?: string;

  @ApiProperty({ description: 'Seedance model version', required: false })
  @IsOptional()
  @IsString()
  seedanceModel?: string;

  @ApiProperty({
    description: 'Seed2 token pricing tier for input context window (le32k/gt32k_le128k/gt128k_le256k)',
    required: false,
  })
  @IsOptional()
  @IsString()
  seed2InputTier?: string;

  @ApiProperty({ description: 'Off-peak generation (Vidu)', required: false })
  @IsOptional()
  @IsBoolean()
  offPeak?: boolean;

  @ApiProperty({ description: 'Camera fixed (Seedance 1.5 Pro)', required: false })
  @IsOptional()
  @IsBoolean()
  camerafixed?: boolean;

  @ApiProperty({ description: 'Watermark (Seedance)', required: false })
  @IsOptional()
  @IsBoolean()
  watermark?: boolean;

  @ApiProperty({ description: 'Generate audio (Seedance 2.0)', required: false })
  @IsOptional()
  @IsBoolean()
  generateAudio?: boolean;

  @ApiProperty({ description: 'Generate sound (Kling)', required: false })
  @IsOptional()
  @IsString()
  sound?: string;

  @ApiProperty({
    description: 'Tencent Kling 3.0/3.0-Omni storyboard mode: single/intelligence/customize',
    required: false,
  })
  @IsOptional()
  @IsString()
  klingStoryboardMode?: string;

  @ApiProperty({
    description: 'Tencent Kling custom storyboard script JSON array',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(6000)
  klingStoryboardScript?: string;

  @ApiProperty({ description: 'Managed routing modelKey', required: false })
  @IsOptional()
  @IsString()
  managedModelKey?: string;

  @ApiProperty({ description: 'Managed routing vendorKey', required: false })
  @IsOptional()
  @IsString()
  vendorKey?: string;

  @ApiProperty({ description: 'Managed routing platformKey', required: false })
  @IsOptional()
  @IsString()
  platformKey?: string;

  @ApiProperty({ description: 'Explicit video channel tier', required: false, enum: ['default', 'vip'] })
  @IsOptional()
  @IsEnum(['default', 'vip'])
  channelTier?: 'default' | 'vip';

  @ApiProperty({ description: 'Client project identity for active-node gating', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientProjectId?: string;

  @ApiProperty({ description: 'Client Flow node identity for active-node gating', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientNodeId?: string;

  @ApiProperty({ description: 'Client run identity for diagnostics', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientRunId?: string;

  @ApiProperty({ description: 'Client run source for diagnostics', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  runSource?: string;

  @ApiProperty({ description: 'Browser tab identity for diagnostics', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientTabId?: string;
}
