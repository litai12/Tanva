import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateSora2CharacterDto {
  @ApiProperty({
    description: '角色生成模型',
    required: false,
    enum: ['sora-2', 'sora-2-pro'],
    default: 'sora-2',
  })
  @IsOptional()
  @IsEnum(['sora-2', 'sora-2-pro'])
  model?: 'sora-2' | 'sora-2-pro';

  @ApiProperty({
    description: '角色时间戳，格式: 起始秒,结束秒',
    required: true,
    example: '1,3',
  })
  @IsString()
  timestamps!: string;

  @ApiProperty({
    description: '用于提取角色的视频 URL（与 fromTask 二选一）',
    required: false,
  })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiProperty({
    description: '已生成的视频任务 ID（与 url 二选一）',
    required: false,
  })
  @IsOptional()
  @IsString()
  fromTask?: string;
}

