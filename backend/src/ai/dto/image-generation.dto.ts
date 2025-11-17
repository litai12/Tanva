import { IsString, IsNotEmpty, IsOptional, IsArray, IsBoolean, IsEnum, IsObject } from 'class-validator';

enum AspectRatio {
  'SQUARE' = '1:1',
  'PORTRAIT_TALL' = '2:3',
  'LANDSCAPE_SHORT' = '3:2',
  'PORTRAIT_MEDIUM' = '3:4',
  'LANDSCAPE_MEDIUM' = '4:3',
  'PORTRAIT_SHORT' = '4:5',
  'LANDSCAPE_TALL' = '5:4',
  'PORTRAIT_ULTRA' = '9:16',
  'LANDSCAPE_ULTRA' = '16:9',
  'CINEMA' = '21:9',
}

enum OutputFormat {
  JPEG = 'jpeg',
  PNG = 'png',
  WEBP = 'webp',
}

export class GenerateImageDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  aiProvider?: 'gemini' | 'banana' | 'runninghub' | 'midjourney';

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;

  @IsOptional()
  @IsEnum(OutputFormat)
  outputFormat?: 'jpeg' | 'png' | 'webp';

  @IsOptional()
  @IsEnum(AspectRatio)
  aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';

  @IsOptional()
  @IsBoolean()
  imageOnly?: boolean;
}

export class EditImageDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsString()
  @IsNotEmpty()
  sourceImage!: string; // base64

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  aiProvider?: 'gemini' | 'banana' | 'runninghub' | 'midjourney';

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;

  @IsOptional()
  @IsEnum(OutputFormat)
  outputFormat?: 'jpeg' | 'png' | 'webp';

  @IsOptional()
  @IsEnum(AspectRatio)
  aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';

  @IsOptional()
  @IsBoolean()
  imageOnly?: boolean;
}

export class BlendImagesDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  sourceImages!: string[]; // base64 array

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  aiProvider?: 'gemini' | 'banana' | 'runninghub' | 'midjourney';

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;

  @IsOptional()
  @IsEnum(OutputFormat)
  outputFormat?: 'jpeg' | 'png' | 'webp';

  @IsOptional()
  @IsEnum(AspectRatio)
  aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';

  @IsOptional()
  @IsBoolean()
  imageOnly?: boolean;
}

export class AnalyzeImageDto {
  @IsOptional()
  @IsString()
  prompt?: string;

  @IsString()
  @IsNotEmpty()
  sourceImage!: string; // base64

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  aiProvider?: 'gemini' | 'banana' | 'runninghub' | 'midjourney';

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;
}

export class TextChatDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  aiProvider?: 'gemini' | 'banana' | 'runninghub' | 'midjourney';

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  enableWebSearch?: boolean;
}

export class MidjourneyActionDto {
  @IsString()
  @IsNotEmpty()
  taskId!: string;

  @IsString()
  @IsNotEmpty()
  customId!: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  notifyHook?: string;

  @IsOptional()
  @IsString()
  chooseSameChannel?: string;

  @IsOptional()
  @IsObject()
  accountFilter?: Record<string, any>;
}

export class MidjourneyModalDto {
  @IsString()
  @IsNotEmpty()
  taskId!: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  maskBase64?: string;
}

export class Convert2Dto3DDto {
  @IsString()
  @IsNotEmpty()
  imageUrl!: string; // OSS原生可访问的图片URL
}export class ExpandImageDto {
  @IsString()
  @IsNotEmpty()
  imageUrl!: string; // OSS原生可访问的图片URL

  @IsNotEmpty()
  @IsObject()
  expandRatios!: {
    left: number; // 左侧扩图部分/原图长度
    top: number; // 上侧扩图部分/原图高度
    right: number; // 右侧扩图部分/原图长度
    bottom: number; // 下侧扩图部分/原图高度
  };

  @IsOptional()
  @IsString()
  prompt?: string; // 提示词，默认为"扩图"
}
