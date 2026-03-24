import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class TencentSpeechDto {
  @ApiProperty({
    description: '输入视频 URL（建议使用无字幕视频）',
  })
  @IsString()
  inputVideoUrl!: string;

  @ApiPropertyOptional({
    description: '配音文本（自动转字幕并上传 OSS）',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  text?: string;

  @ApiPropertyOptional({
    description: 'Speaker 文件 URL，与 subtitleUrls 模式二选一',
  })
  @IsOptional()
  @IsString()
  speakerUrl?: string;

  @ApiPropertyOptional({
    description: '指定音色 ID（text 模式下可自动生成 speakerUrl）',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  voiceId?: string;

  @ApiPropertyOptional({
    description: '说话人性别（male/female，text+voiceId 模式）',
    default: 'male',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  speakerGender?: string;

  @ApiPropertyOptional({
    description: '源语言（subtitleUrls 模式）',
    default: 'zh',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  srcLang?: string;

  @ApiPropertyOptional({
    description: '目标语言列表（subtitleUrls 模式）',
    type: [String],
    example: ['en'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dstLangs?: string[];

  @ApiPropertyOptional({
    description: '目标语言（subtitleUrls 模式，单语言快捷字段）',
    default: 'en',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  dstLang?: string;

  @ApiPropertyOptional({
    description: '源字幕 URL（subtitleUrls 模式）',
  })
  @IsOptional()
  @IsString()
  srcSubtitleUrl?: string;

  @ApiPropertyOptional({
    description: '目标字幕映射（key=语言，value=字幕 URL）',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  dstSubtitleUrls?: Record<string, string>;

  @ApiPropertyOptional({
    description: '目标字幕 URL（subtitleUrls 模式，单语言快捷字段）',
  })
  @IsOptional()
  @IsString()
  dstSubtitleUrl?: string;

  @ApiPropertyOptional({
    description: '是否压制字幕',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  embedSubtitle?: boolean;

  @ApiPropertyOptional({
    description: '字幕字体，不填或 auto 使用默认字体',
    default: 'auto',
  })
  @IsOptional()
  @IsString()
  font?: string;

  @ApiPropertyOptional({
    description: '字幕字号',
    default: 50,
  })
  @IsOptional()
  @IsNumber()
  fontSize?: number;

  @ApiPropertyOptional({
    description: '字幕底部边距',
    default: 50,
  })
  @IsOptional()
  @IsNumber()
  marginV?: number;

  @ApiPropertyOptional({
    description: '输出文件名前缀',
  })
  @IsOptional()
  @IsString()
  outputPattern?: string;

  @ApiPropertyOptional({
    description: '任务回调 URL（可选）',
  })
  @IsOptional()
  @IsString()
  notifyUrl?: string;
}

export type TencentSpeechSynthesisResult = {
  taskId: string;
  status?: string;
  requestId?: string;
  audioUrl?: string;
  videoUrl?: string;
  speakerUrl?: string;
  failReason?: string;
  output?: Record<string, any>;
};

export type TencentSpeechAsyncTaskResult = {
  taskId: string;
  status?: string;
  requestId?: string;
};

export type TencentSpeechAsyncQueryResult = {
  taskId: string;
  status?: string;
  requestId?: string;
  audioUrl?: string;
  videoUrl?: string;
  speakerUrl?: string;
  failReason?: string;
  output?: Record<string, any>;
};
