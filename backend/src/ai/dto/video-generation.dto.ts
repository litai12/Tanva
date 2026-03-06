import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class GenerateVideoDto {
  @ApiProperty({ description: '视频描述提示词' })
  @IsString()
  @MaxLength(2000)
  prompt!: string;

  @ApiProperty({ description: '参考图像 URL 列表', required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  referenceImageUrls?: string[];

  @ApiProperty({ description: '单张参考图像 URL（兼容旧版）', required: false })
  @IsOptional()
  @IsString()
  referenceImageUrl?: string;

  @ApiProperty({
    description: '视频质量（hd 收费更高，sd 为省成本选项）',
    required: false,
    enum: ['hd', 'sd'],
  })
  @IsOptional()
  @IsEnum(['hd', 'sd'])
  quality?: 'hd' | 'sd';

  @ApiProperty({
    description: '画面比例（仅极速 Sora2 支持）',
    required: false,
    enum: ['16:9', '9:16'],
  })
  @IsOptional()
  @IsEnum(['16:9', '9:16'])
  aspectRatio?: '16:9' | '9:16';

  @ApiProperty({
    description: '视频时长（秒，仅极速 Sora2 支持；sora-2-pro 支持 25s）',
    required: false,
    enum: ['10', '15', '25'],
  })
  @IsOptional()
  @IsEnum(['10', '15', '25'])
  duration?: '10' | '15' | '25';

  @ApiProperty({
    description: 'Sora2 模型（Pro 节点可选）',
    required: false,
    enum: ['sora-2', 'sora-2-vip', 'sora-2-pro'],
  })
  @IsOptional()
  @IsEnum(['sora-2', 'sora-2-vip', 'sora-2-pro'])
  model?: 'sora-2' | 'sora-2-vip' | 'sora-2-pro';

  @ApiProperty({ description: '是否添加官方水印', required: false })
  @IsOptional()
  @IsBoolean()
  watermark?: boolean;

  @ApiProperty({ description: '是否生成缩略图', required: false })
  @IsOptional()
  @IsBoolean()
  thumbnail?: boolean;

  @ApiProperty({ description: '是否开启隐私模式', required: false })
  @IsOptional()
  @IsBoolean()
  privateMode?: boolean;

  @ApiProperty({
    description: '视频风格（感谢节、漫画、新闻、自拍、复古、动漫等）',
    required: false,
  })
  @IsOptional()
  @IsString()
  style?: string;

  @ApiProperty({ description: '是否启用故事板', required: false })
  @IsOptional()
  @IsBoolean()
  storyboard?: boolean;

  @ApiProperty({ description: '角色引用 ID/URL', required: false })
  @IsOptional()
  @IsString()
  characterUrl?: string;

  @ApiProperty({ description: '角色时间戳，格式: 起始秒,结束秒', required: false })
  @IsOptional()
  @IsString()
  characterTimestamps?: string;

  @ApiProperty({ description: '角色任务 ID（可用于自动解析角色）', required: false })
  @IsOptional()
  @IsString()
  characterTaskId?: string;
}
