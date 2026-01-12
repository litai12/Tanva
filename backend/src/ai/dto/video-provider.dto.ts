import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class VideoProviderRequestDto {
  @ApiProperty({ description: '供应商' })
  @IsEnum(['kling', 'vidu', 'doubao'])
  provider!: 'kling' | 'vidu' | 'doubao';

  @ApiProperty({ description: '视频描述提示词' })
  @IsString()
  @MaxLength(2000)
  prompt!: string;

  @ApiProperty({ description: '参考图像 URL 列表', required: false, type: [String] })
  @IsOptional()
  @IsString({ each: true })
  referenceImages?: string[];

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

  @ApiProperty({ description: '错峰生成 (Vidu)', required: false })
  @IsOptional()
  @IsBoolean()
  offPeak?: boolean;

  @ApiProperty({ description: '镜头固定 (豆包)', required: false })
  @IsOptional()
  @IsBoolean()
  camerafixed?: boolean;

  @ApiProperty({ description: '添加水印 (豆包)', required: false })
  @IsOptional()
  @IsBoolean()
  watermark?: boolean;
}
