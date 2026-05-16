import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';

export class VolcEnhanceVideoDto {
  @ApiProperty({ description: '待增强视频 URL（需公网可访问）' })
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  videoUrl!: string;

  @ApiProperty({
    description: '增强版本：standard（标准）或 professional（专业）',
    required: false,
    enum: ['standard', 'professional'],
  })
  @IsOptional()
  @IsEnum(['standard', 'professional'])
  toolVersion?: 'standard' | 'professional';

  @ApiProperty({
    description: '场景预设',
    required: false,
    enum: ['aigc', 'short_series', 'ugc', 'old_film'],
  })
  @IsOptional()
  @IsEnum(['aigc', 'short_series', 'ugc', 'old_film'])
  scene?: 'aigc' | 'short_series' | 'ugc' | 'old_film';

  @ApiProperty({
    description: '输出分辨率（与 resolutionLimit 互斥）',
    required: false,
    enum: ['720p', '1080p', '4k'],
  })
  @IsOptional()
  @IsEnum(['720p', '1080p', '4k'])
  resolution?: '720p' | '1080p' | '4k';

  @ApiProperty({
    description: '输出短边像素限制（64-2160，与 resolution 互斥）',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(2160)
  resolutionLimit?: number;

  @ApiProperty({ description: '输出帧率（1-120）', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  fps?: number;
}

