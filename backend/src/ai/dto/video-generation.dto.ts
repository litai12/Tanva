import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
