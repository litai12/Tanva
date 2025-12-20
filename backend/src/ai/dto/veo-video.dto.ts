import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export type VeoModelType = 'veo3-fast' | 'veo3-pro' | 'veo3-pro-frames';

export class VeoGenerateVideoDto {
  @ApiProperty({ description: '视频描述提示词' })
  @IsString()
  @MaxLength(2000)
  prompt!: string;

  @ApiProperty({
    description: '模型选择：veo3-fast(快速), veo3-pro(高质量), veo3-pro-frames(支持垫图)',
    enum: ['veo3-fast', 'veo3-pro', 'veo3-pro-frames'],
    default: 'veo3-fast',
  })
  @IsEnum(['veo3-fast', 'veo3-pro', 'veo3-pro-frames'])
  model!: VeoModelType;

  @ApiProperty({
    description: '参考图片 URL（仅 veo3-pro-frames 模式支持）',
    required: false,
  })
  @IsOptional()
  @IsString()
  referenceImageUrl?: string;
}

export class VeoVideoResponseDto {
  @ApiProperty({ description: '是否成功' })
  success!: boolean;

  @ApiProperty({ description: '任务 ID', required: false })
  taskId?: string;

  @ApiProperty({ description: '视频在线观看 URL', required: false })
  videoUrl?: string;

  @ApiProperty({ description: '视频下载 URL', required: false })
  downloadUrl?: string;

  @ApiProperty({ description: '数据预览 URL', required: false })
  previewUrl?: string;

  @ApiProperty({ description: '原始响应内容', required: false })
  rawContent?: string;

  @ApiProperty({ description: '错误信息', required: false })
  error?: string;
}

export class VeoModelsResponseDto {
  @ApiProperty({ description: '模型标识' })
  model!: string;

  @ApiProperty({ description: '模型描述' })
  description!: string;

  @ApiProperty({ description: '是否支持图片输入' })
  supportsImage!: boolean;
}
