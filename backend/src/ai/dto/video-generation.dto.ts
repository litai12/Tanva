import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class GenerateVideoDto {
  @ApiProperty({ description: '视频描述提示词' })
  @IsString()
  @MaxLength(2000)
  prompt!: string;

  @ApiProperty({ description: '参考图像 URL', required: false })
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
