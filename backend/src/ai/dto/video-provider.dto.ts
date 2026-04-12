import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class VideoProviderRequestDto {
  @ApiProperty({ description: 'Provider' })
  @IsEnum(['kling', 'kling-2.6', 'kling-o3', 'vidu', 'viduq3-pro', 'doubao'])
  provider!: 'kling' | 'kling-2.6' | 'kling-o3' | 'vidu' | 'viduq3-pro' | 'doubao';

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
  @MaxLength(2500)
  prompt?: string;

  @ApiProperty({ description: 'Reference image URL list', required: false, type: [String] })
  @IsOptional()
  @IsString({ each: true })
  referenceImages?: string[];

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
}
