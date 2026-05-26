import { IsString, IsNotEmpty, IsOptional, IsArray, IsBoolean, IsEnum, IsObject, ValidateIf, IsNumber, ArrayMinSize, IsInt, Min, Max } from 'class-validator';

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
  'WIDE' = '2:1',
  'TALL' = '1:2',
  'PORTRAIT_CINEMA' = '9:21',
  'LONG_LANDSCAPE' = '4:1',
  'LONG_PORTRAIT' = '1:4',
  'ULTRA_LONG_LANDSCAPE' = '8:1',
  'ULTRA_LONG_PORTRAIT' = '1:8',
}

enum OutputFormat {
  JPEG = 'jpeg',
  PNG = 'png',
  WEBP = 'webp',
}

enum ThinkingLevel {
  HIGH = 'high',
  LOW = 'low',
}

enum SeedreamModelVersion {
  V4_0 = '4.0',
  V4_5 = '4.5',
  V5_0 = '5.0',
}

enum Hunyuan3DModelVersion {
  V3_0 = '3.0',
  V3_1 = '3.1',
}

enum GptImage2Quality {
  AUTO = 'auto',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

enum GptImage2Background {
  AUTO = 'auto',
  OPAQUE = 'opaque',
  TRANSPARENT = 'transparent',
}

enum GptImage2Moderation {
  AUTO = 'auto',
  LOW = 'low',
}

export class GenerateImageDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsEnum(SeedreamModelVersion)
  modelVersion?: '4.0' | '4.5' | '5.0';

  @IsOptional()
  @IsString()
  aiProvider?: 'gemini' | 'gemini-pro' | 'banana' | 'banana-2.5' | 'banana-3.1' | 'runninghub' | 'midjourney' | 'nano2' | 'seedream5';

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;

  @IsOptional()
  @IsEnum(OutputFormat)
  outputFormat?: 'jpeg' | 'png' | 'webp';

  @IsOptional()
  @IsEnum(AspectRatio)
  aspectRatio?:
    | '1:1'
    | '2:3'
    | '3:2'
    | '3:4'
    | '4:3'
    | '4:5'
    | '5:4'
    | '9:16'
    | '16:9'
    | '21:9'
    | '2:1'
    | '1:2'
    | '9:21'
    | '4:1'
    | '1:4'
    | '8:1'
    | '1:8';

  @IsOptional()
  @IsString()
  imageSize?: string;

  // 兼容别名：resolution 等价于 imageSize，size 等价于 aspectRatio
  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsEnum(ThinkingLevel)
  thinkingLevel?: 'high' | 'low';

  @IsOptional()
  @IsBoolean()
  imageOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  enableWebSearch?: boolean; // 閻㈢喎娴橀梼鑸殿唽閸氼垳鏁ら懕鏃傜秹閹兼粎鍌ㄩ敍鍫濐洤 147 Ultra閿?

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[]; // Nano2 閸欏倽鈧啫娴橀悧?URL 閸掓銆?

  @IsOptional()
  @IsBoolean()
  googleSearch?: boolean; // Nano2 Google 閺傚洦婀伴幖婊呭偍婢х偛宸?

  @IsOptional()
  @IsBoolean()
  googleImageSearch?: boolean; // Nano2 Google 閸ュ墽澧栭幖婊呭偍婢х偛宸?

  @IsOptional()
  @IsBoolean()
  batchMode?: boolean; // Seedream5 閹靛綊鍣洪悽鐔稿灇濡€崇础

  @IsOptional()
  @IsNumber()
  batchCount?: number; // Seedream5 閹靛綊鍣洪悽鐔稿灇閺佷即鍣?(2-10)

  @IsOptional()
  @IsString()
  parallelGroupId?: string;

  @IsOptional()
  @IsNumber()
  parallelGroupIndex?: number;

  @IsOptional()
  @IsNumber()
  parallelGroupTotal?: number;

  @IsOptional()
  @IsBoolean()
  officialFallback?: boolean; // gpt-image-2 閺勵垰鎯佹担璺ㄦ暏鐎规ɑ鏌熷〒鐘讳壕閸忔粌绨?

  @IsOptional()
  @IsEnum(GptImage2Quality)
  quality?: 'auto' | 'low' | 'medium' | 'high';

  @IsOptional()
  @IsEnum(GptImage2Background)
  background?: 'auto' | 'opaque' | 'transparent';

  @IsOptional()
  @IsEnum(GptImage2Moderation)
  moderation?: 'auto' | 'low';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  outputCompression?: number;

  @IsOptional()
  @IsString()
  maskUrl?: string;

  @IsOptional()
  @IsString()
  nodeConfigKey?: string;

  @IsOptional()
  @IsString()
  nodeConfigNameZh?: string;

  @IsOptional()
  @IsString()
  nodeConfigNameEn?: string;

  @IsOptional()
  @IsString()
  billingModeName?: string;

  @IsOptional()
  @IsString()
  billingTitleSource?: 'dialog' | 'node';

  @IsOptional()
  @IsString()
  nodeId?: string;
}

export class EditImageDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @ValidateIf((o) => !o.sourceImageUrl)
  @IsString()
  @IsNotEmpty()
  sourceImage?: string; // base64

  @ValidateIf((o) => !o.sourceImage)
  @IsString()
  @IsNotEmpty()
  sourceImageUrl?: string; // remote URL to be fetched by backend

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  aiProvider?: 'gemini' | 'gemini-pro' | 'banana' | 'banana-2.5' | 'banana-3.1' | 'runninghub' | 'midjourney' | 'nano2' | 'seedream5';

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;

  @IsOptional()
  @IsEnum(OutputFormat)
  outputFormat?: 'jpeg' | 'png' | 'webp';

  @IsOptional()
  @IsEnum(AspectRatio)
  aspectRatio?:
    | '1:1'
    | '2:3'
    | '3:2'
    | '3:4'
    | '4:3'
    | '4:5'
    | '5:4'
    | '9:16'
    | '16:9'
    | '21:9'
    | '2:1'
    | '1:2'
    | '9:21'
    | '4:1'
    | '1:4'
    | '8:1'
    | '1:8';

  @IsOptional()
  @IsString()
  imageSize?: string;

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsEnum(ThinkingLevel)
  thinkingLevel?: 'high' | 'low';

  @IsOptional()
  @IsBoolean()
  imageOnly?: boolean;

  @IsOptional()
  @IsString()
  parallelGroupId?: string;

  @IsOptional()
  @IsNumber()
  parallelGroupIndex?: number;

  @IsOptional()
  @IsNumber()
  parallelGroupTotal?: number;

  @IsOptional()
  @IsString()
  nodeConfigKey?: string;

  @IsOptional()
  @IsString()
  nodeConfigNameZh?: string;

  @IsOptional()
  @IsString()
  nodeConfigNameEn?: string;

  @IsOptional()
  @IsString()
  billingModeName?: string;

  @IsOptional()
  @IsString()
  billingTitleSource?: 'dialog' | 'node';

  @IsOptional()
  @IsString()
  nodeId?: string;
}

export class BlendImagesDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @ValidateIf((o) => !o.sourceImageUrls || o.sourceImageUrls.length === 0)
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  sourceImages?: string[]; // base64 array

  @ValidateIf((o) => !o.sourceImages || o.sourceImages.length === 0)
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  sourceImageUrls?: string[]; // remote URLs to be fetched by backend

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  aiProvider?: 'gemini' | 'gemini-pro' | 'banana' | 'banana-2.5' | 'banana-3.1' | 'runninghub' | 'midjourney' | 'nano2' | 'seedream5';

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;

  @IsOptional()
  @IsEnum(OutputFormat)
  outputFormat?: 'jpeg' | 'png' | 'webp';

  @IsOptional()
  @IsEnum(AspectRatio)
  aspectRatio?:
    | '1:1'
    | '2:3'
    | '3:2'
    | '3:4'
    | '4:3'
    | '4:5'
    | '5:4'
    | '9:16'
    | '16:9'
    | '21:9'
    | '2:1'
    | '1:2'
    | '9:21'
    | '4:1'
    | '1:4'
    | '8:1'
    | '1:8';

  @IsOptional()
  @IsString()
  imageSize?: string;

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsEnum(ThinkingLevel)
  thinkingLevel?: 'high' | 'low';

  @IsOptional()
  @IsBoolean()
  imageOnly?: boolean;

  @IsOptional()
  @IsString()
  parallelGroupId?: string;

  @IsOptional()
  @IsNumber()
  parallelGroupIndex?: number;

  @IsOptional()
  @IsNumber()
  parallelGroupTotal?: number;

  @IsOptional()
  @IsString()
  nodeConfigKey?: string;

  @IsOptional()
  @IsString()
  nodeConfigNameZh?: string;

  @IsOptional()
  @IsString()
  nodeConfigNameEn?: string;

  @IsOptional()
  @IsString()
  billingModeName?: string;

  @IsOptional()
  @IsString()
  billingTitleSource?: 'dialog' | 'node';

  @IsOptional()
  @IsString()
  nodeId?: string;
}

export class AnalyzeImageDto {
  @IsOptional()
  @IsString()
  prompt?: string;

  @ValidateIf((o) => !o.sourceImages || o.sourceImages.length === 0)
  @IsString()
  @IsNotEmpty()
  sourceImage?: string; // base64

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  sourceImages?: string[]; // base64/url array

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  aiProvider?: 'gemini' | 'gemini-pro' | 'banana' | 'banana-2.5' | 'banana-3.1' | 'runninghub' | 'midjourney' | 'nano2' | 'seedream5';

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
  aiProvider?: 'gemini' | 'gemini-pro' | 'banana' | 'banana-2.5' | 'banana-3.1' | 'runninghub' | 'midjourney' | 'nano2' | 'seedream5';

  @IsOptional()
  @IsObject()
  providerOptions?: Record<string, any>;

  @IsOptional()
  @IsString()
  billingTag?: 'text_chat' | 'prompt_optimize';

  @IsOptional()
  @IsBoolean()
  enableWebSearch?: boolean;

  @IsOptional()
  @IsEnum(ThinkingLevel)
  thinkingLevel?: 'high' | 'low';
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
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsEnum(Hunyuan3DModelVersion)
  model?: '3.0' | '3.1';

  @IsOptional()
  @IsBoolean()
  lowPoly?: boolean;

  @IsOptional()
  @IsBoolean()
  sketch?: boolean;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  nodeId?: string;
}

export class ExpandImageDto {
  @IsString()
  @IsNotEmpty()
  imageUrl!: string; // OSS閸樼喓鏁撻崣顖濐問闂傤喚娈戦崶鍓уURL

  @IsNotEmpty()
  @IsObject()
  expandRatios!: {
    left: number; // 瀹革缚鏅堕幍鈺佹禈闁劌鍨?閸樼喎娴橀梹鍨
    top: number; // 娑撳﹣鏅堕幍鈺佹禈闁劌鍨?閸樼喎娴樻妯哄
    right: number; // 閸欏厖鏅堕幍鈺佹禈闁劌鍨?閸樼喎娴橀梹鍨
    bottom: number; // 娑撳鏅堕幍鈺佹禈闁劌鍨?閸樼喎娴樻妯哄
  };

  @IsOptional()
  @IsString()
  prompt?: string; // 閹绘劗銇氱拠宥忕礉姒涙顓绘稉?閹碘晛娴?
}

