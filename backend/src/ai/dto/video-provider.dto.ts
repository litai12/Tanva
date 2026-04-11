import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class VideoProviderRequestDto {
  @ApiProperty({ description: '供应商' })
  @IsEnum(['kling', 'kling-2.6', 'kling-o3', 'vidu', 'viduq3-pro', 'doubao'])
  provider!: 'kling' | 'kling-2.6' | 'kling-o3' | 'vidu' | 'viduq3-pro' | 'doubao';

  @ApiProperty({
    description:
      '视频生成模式 (Vidu: text2video/img2video/start-end2video/reference2video; Kling: text2video/image2video/image2video-tail/multi-image2video; Seedance 2.0: text/first_frame/start_end/reference_images/smart_frames/reference_video/image_audio/image_video/video_audio/image_video_audio; Kling-O1: omni-video)',
    required: false,
  })
  @IsOptional()
  @IsString()
  videoMode?: string;

  @ApiProperty({ description: '视频描述提示词', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2500)
  prompt?: string;

  @ApiProperty({ description: '参考图像 URL 列表', required: false, type: [String] })
  @IsOptional()
  @IsString({ each: true })
  referenceImages?: string[];

  @ApiProperty({ description: 'Audio URL list', required: false, type: [String] })
  @IsOptional()
  @IsString({ each: true })
  audioUrls?: string[];

  @ApiProperty({ description: '参考视频 URL 列表', required: false, type: [String] })
  @IsOptional()
  @IsString({ each: true })
  referenceVideos?: string[];

  @ApiProperty({ description: '参考视频 URL', required: false })
  @IsOptional()
  @IsString()
  referenceVideo?: string;

  @ApiProperty({ description: '参考视频类型 (feature/base)', required: false })
  @IsOptional()
  @IsString()
  referenceVideoType?: 'feature' | 'base';

  @ApiProperty({ description: '保留原声 (yes/no)', required: false })
  @IsOptional()
  @IsString()
  keepOriginalSound?: 'yes' | 'no';

  @ApiProperty({ description: '画面比例', required: false })
  @IsOptional()
  @IsString()
  aspectRatio?: string;

  @ApiProperty({ description: '视频时长（秒）', required: false })
  @IsOptional()
  @IsNumber()
  duration?: number;

  @ApiProperty({ description: '分辨率 (Vidu)', required: false })
  @IsOptional()
  @IsString()
  resolution?: string;

  @ApiProperty({ description: '风格 (Vidu)', required: false })
  @IsOptional()
  @IsString()
  style?: string;

  @ApiProperty({ description: '供应商特定模式 (Kling: std/pro)', required: false })
  @IsOptional()
  @IsString()
  mode?: string;

  @ApiProperty({ description: 'Kling 模型版本 (如 kling-v2-1/kling-v2-6/kling-v3-0)', required: false })
  @IsOptional()
  @IsString()
  klingModel?: string;

  @ApiProperty({
    description: 'Vidu 模型版本 (如 q2/q3)',
    required: false,
  })
  @IsOptional()
  @IsString()
  viduModel?: string;

  @ApiProperty({
    description: 'Vidu 实际模型版本 (如 q2-pro/q3-turbo，仅用于计费与日志展示)',
    required: false,
  })
  @IsOptional()
  @IsString()
  viduModelVariant?: string;

  @ApiProperty({
    description: 'Seedance 模型版本 (如 seedance-1.5-pro/seedance-2.0/seedance-2.0-fast)',
    required: false,
  })
  @IsOptional()
  @IsString()
  seedanceModel?: string;

  @ApiProperty({ description: '错峰生成 (Vidu)', required: false })
  @IsOptional()
  @IsBoolean()
  offPeak?: boolean;

  @ApiProperty({ description: '镜头固定 (Seedance 1.5 Pro)', required: false })
  @IsOptional()
  @IsBoolean()
  camerafixed?: boolean;

  @ApiProperty({ description: '添加水印 (Seedance 1.5 Pro)', required: false })
  @IsOptional()
  @IsBoolean()
  watermark?: boolean;

  @ApiProperty({ description: '是否生成音频/音效 (Seedance 2.0)', required: false })
  @IsOptional()
  @IsBoolean()
  generateAudio?: boolean;

  @ApiProperty({ description: '是否生成音效 (Kling)', required: false })
  @IsOptional()
  @IsString()
  sound?: string;

  @ApiProperty({ description: '模型管理 modelKey', required: false })
  @IsOptional()
  @IsString()
  managedModelKey?: string;

  @ApiProperty({ description: '模型管理 vendorKey / 线路标识', required: false })
  @IsOptional()
  @IsString()
  vendorKey?: string;

  @ApiProperty({ description: '模型管理 platformKey / 渠道标识', required: false })
  @IsOptional()
  @IsString()
  platformKey?: string;
}
