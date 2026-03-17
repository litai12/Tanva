import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const MINIMAX_MUSIC_MODELS = ['music-2.5+', 'music-2.5'] as const;
export type MinimaxMusicModel = (typeof MINIMAX_MUSIC_MODELS)[number];

export class MinimaxMusicDto {
  @ApiPropertyOptional({
    description: '曲风/情绪提示词，纯音乐模式下必填（最长 2000 字）',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;

  @ApiPropertyOptional({
    description: '歌词内容（最长 3500 字）',
    maxLength: 3500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(3500)
  lyrics?: string;

  @ApiPropertyOptional({
    description: '纯音乐模式（true 时忽略 lyrics）',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isInstrumental?: boolean;

  @ApiPropertyOptional({
    description: '自动填词（lyrics 为空时根据 prompt 自动生成）',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  lyricsOptimizer?: boolean;

  @ApiPropertyOptional({
    description: '模型名称',
    enum: MINIMAX_MUSIC_MODELS,
    default: 'music-2.5+',
  })
  @IsOptional()
  @IsIn(MINIMAX_MUSIC_MODELS)
  model?: MinimaxMusicModel;
}

export interface MinimaxMusicResponse {
  audioUrl?: string;
  status?: number;
  requestId?: string;
  model?: string;
}
