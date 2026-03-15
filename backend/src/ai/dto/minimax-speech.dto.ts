import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export const MINIMAX_SPEECH_OUTPUT_FORMATS = ['hex', 'url'] as const;
export type MinimaxSpeechOutputFormat = (typeof MINIMAX_SPEECH_OUTPUT_FORMATS)[number];

export const MINIMAX_AUDIO_MODES = ['json', 'hex'] as const;
export type MinimaxSpeechAudioMode = (typeof MINIMAX_AUDIO_MODES)[number];

export const MINIMAX_SPEECH_EMOTIONS = [
  'happy',
  'sad',
  'angry',
  'fearful',
  'disgusted',
  'surprised',
  'calm',
  'fluent',
  'whisper',
] as const;
export type MinimaxSpeechEmotion = (typeof MINIMAX_SPEECH_EMOTIONS)[number];

export const MINIMAX_SOUND_EFFECTS = [
  'spacious_echo',
  'auditorium_echo',
  'lofi_telephone',
  'robotic',
] as const;
export type MinimaxSpeechSoundEffect = (typeof MINIMAX_SOUND_EFFECTS)[number];

export class MinimaxSpeechDto {
  @ApiProperty({ description: '要合成的文本' })
  @IsString()
  text!: string;

  @ApiProperty({ description: '音色ID', required: false, default: 'male-qn-qingse' })
  @IsOptional()
  @IsString()
  voiceId?: string;

  @ApiProperty({ description: '模型', required: false, default: 'speech-2.6-hd' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({
    description: '输出格式（非流式）',
    enum: MINIMAX_SPEECH_OUTPUT_FORMATS,
    default: 'url',
  })
  @IsOptional()
  @IsIn(MINIMAX_SPEECH_OUTPUT_FORMATS)
  outputFormat?: MinimaxSpeechOutputFormat;

  @ApiPropertyOptional({
    description: '返回模式（渠道参数）',
    enum: MINIMAX_AUDIO_MODES,
    default: 'json',
  })
  @IsOptional()
  @IsIn(MINIMAX_AUDIO_MODES)
  audioMode?: MinimaxSpeechAudioMode;

  @ApiPropertyOptional({
    description: '情感',
    enum: MINIMAX_SPEECH_EMOTIONS,
  })
  @IsOptional()
  @IsIn(MINIMAX_SPEECH_EMOTIONS)
  emotion?: MinimaxSpeechEmotion;

  @ApiPropertyOptional({
    description: '音效列表',
    enum: MINIMAX_SOUND_EFFECTS,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(MINIMAX_SOUND_EFFECTS, { each: true })
  soundEffects?: MinimaxSpeechSoundEffect[];
}

export interface MinimaxSpeechResponse {
  audioUrl?: string;
  taskId?: string;
  status?: string;
  requestId?: string;
  voiceId?: string;
  voiceAlias?: string;
  emotion?: string;
  model?: string;
}
