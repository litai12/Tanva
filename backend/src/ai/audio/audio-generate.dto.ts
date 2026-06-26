import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  MINIMAX_AUDIO_MODES,
  MINIMAX_SOUND_EFFECTS,
  MINIMAX_SPEECH_EMOTIONS,
  MINIMAX_SPEECH_OUTPUT_FORMATS,
  MinimaxSpeechAudioMode,
  MinimaxSpeechEmotion,
  MinimaxSpeechOutputFormat,
  MinimaxSpeechSoundEffect,
} from '../dto/minimax-speech.dto';
import { MINIMAX_MUSIC_MODELS, MinimaxMusicModel } from '../dto/minimax-music.dto';
import { AudioMode } from './audio-provider.interface';

export const AUDIO_MODES: readonly AudioMode[] = [
  'seed-audio',
  'minimax-speech',
  'minimax-music',
  'tencent-dub',
  'upload',
] as const;

export const SEED_AUDIO_FORMATS = ['wav', 'mp3', 'pcm', 'ogg_opus'] as const;
export type SeedAudioFormat = (typeof SEED_AUDIO_FORMATS)[number];

/**
 * 统一音频生成 DTO。由 `mode` 判别，并集了各 mode 的字段（除 mode 外全为可选）。
 * 每个 provider 只读取与自身相关的字段。
 */
export class AudioGenerateDto {
  @ApiProperty({ description: '音频模式', enum: AUDIO_MODES })
  @IsString()
  @IsIn(AUDIO_MODES as unknown as string[])
  mode!: AudioMode;

  @ApiPropertyOptional({ description: '项目 ID（用于 OSS 目录归档）' })
  @IsOptional()
  @IsString()
  projectId?: string;

  // ---- seed-audio / minimax-speech 公共：合成文本 ----
  @ApiPropertyOptional({ description: '要合成的文本 / 提示词' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  text?: string;

  // ---- seed-audio ----
  @ApiPropertyOptional({ description: 'seed-audio 音色 ID（speaker）' })
  @IsOptional()
  @IsString()
  voice?: string;

  @ApiPropertyOptional({ description: 'seed-audio 输出格式', enum: SEED_AUDIO_FORMATS })
  @IsOptional()
  @IsIn(SEED_AUDIO_FORMATS as unknown as string[])
  format?: SeedAudioFormat;

  @ApiPropertyOptional({ description: 'seed-audio 采样率' })
  @IsOptional()
  @IsNumber()
  sampleRate?: number;

  @ApiPropertyOptional({ description: 'seed-audio 语速 [-50,100]' })
  @IsOptional()
  @IsNumber()
  speechRate?: number;

  @ApiPropertyOptional({ description: 'seed-audio 音调 [-12,12]' })
  @IsOptional()
  @IsNumber()
  pitchRate?: number;

  @ApiPropertyOptional({ description: 'seed-audio 响度 [-50,100]' })
  @IsOptional()
  @IsNumber()
  loudnessRate?: number;

  @ApiPropertyOptional({ description: 'seed-audio 参考音频 URL（最多 3 个，@音频N）', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  referenceAudioUrls?: string[];

  @ApiPropertyOptional({ description: 'seed-audio 参考图片 URL（与参考音频互斥）' })
  @IsOptional()
  @IsString()
  referenceImageUrl?: string;

  // ---- minimax-speech ----
  @ApiPropertyOptional({ description: 'minimax 音色 ID' })
  @IsOptional()
  @IsString()
  voiceId?: string;

  @ApiPropertyOptional({ description: '模型名（minimax-speech / minimax-music）' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: 'minimax 输出格式', enum: MINIMAX_SPEECH_OUTPUT_FORMATS })
  @IsOptional()
  @IsIn(MINIMAX_SPEECH_OUTPUT_FORMATS)
  outputFormat?: MinimaxSpeechOutputFormat;

  @ApiPropertyOptional({ description: 'minimax 返回模式', enum: MINIMAX_AUDIO_MODES })
  @IsOptional()
  @IsIn(MINIMAX_AUDIO_MODES)
  audioMode?: MinimaxSpeechAudioMode;

  @ApiPropertyOptional({ description: 'minimax 情感', enum: MINIMAX_SPEECH_EMOTIONS })
  @IsOptional()
  @IsIn(MINIMAX_SPEECH_EMOTIONS)
  emotion?: MinimaxSpeechEmotion;

  @ApiPropertyOptional({ description: 'minimax 音效列表', enum: MINIMAX_SOUND_EFFECTS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(MINIMAX_SOUND_EFFECTS, { each: true })
  soundEffects?: MinimaxSpeechSoundEffect[];

  // ---- minimax-music ----
  @ApiPropertyOptional({ description: '音乐：曲风/情绪提示词', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;

  @ApiPropertyOptional({ description: '音乐：歌词', maxLength: 3500 })
  @IsOptional()
  @IsString()
  @MaxLength(3500)
  lyrics?: string;

  @ApiPropertyOptional({ description: '音乐：纯音乐模式' })
  @IsOptional()
  @IsBoolean()
  isInstrumental?: boolean;

  @ApiPropertyOptional({ description: '音乐：自动填词' })
  @IsOptional()
  @IsBoolean()
  lyricsOptimizer?: boolean;

  @ApiPropertyOptional({ description: '音乐模型', enum: MINIMAX_MUSIC_MODELS })
  @IsOptional()
  @IsIn(MINIMAX_MUSIC_MODELS)
  musicModel?: MinimaxMusicModel;

  // ---- tencent-dub（视频配音）----
  @ApiPropertyOptional({ description: '配音：输入视频 URL' })
  @IsOptional()
  @IsString()
  inputVideoUrl?: string;

  @ApiPropertyOptional({ description: '配音：speaker 文件 URL' })
  @IsOptional()
  @IsString()
  speakerUrl?: string;

  @ApiPropertyOptional({ description: '配音：说话人性别 male/female' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  speakerGender?: string;

  @ApiPropertyOptional({ description: '配音：源语言' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  srcLang?: string;

  @ApiPropertyOptional({ description: '配音：目标语言列表', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dstLangs?: string[];

  @ApiPropertyOptional({ description: '配音：目标语言（单语言快捷字段）' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  dstLang?: string;

  @ApiPropertyOptional({ description: '配音：源字幕 URL' })
  @IsOptional()
  @IsString()
  srcSubtitleUrl?: string;

  @ApiPropertyOptional({ description: '配音：目标字幕映射' })
  @IsOptional()
  @IsObject()
  dstSubtitleUrls?: Record<string, string>;

  @ApiPropertyOptional({ description: '配音：目标字幕 URL（单语言快捷字段）' })
  @IsOptional()
  @IsString()
  dstSubtitleUrl?: string;

  @ApiPropertyOptional({ description: '配音：是否压制字幕' })
  @IsOptional()
  @IsBoolean()
  embedSubtitle?: boolean;

  @ApiPropertyOptional({ description: '配音：字幕字体' })
  @IsOptional()
  @IsString()
  font?: string;

  @ApiPropertyOptional({ description: '配音：字幕字号' })
  @IsOptional()
  @IsNumber()
  fontSize?: number;

  @ApiPropertyOptional({ description: '配音：字幕底部边距' })
  @IsOptional()
  @IsNumber()
  marginV?: number;

  @ApiPropertyOptional({ description: '配音：输出文件名前缀' })
  @IsOptional()
  @IsString()
  outputPattern?: string;

  @ApiPropertyOptional({ description: '配音：任务回调 URL' })
  @IsOptional()
  @IsString()
  notifyUrl?: string;
}
