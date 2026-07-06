import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const BODY_MAX = 10_000;
const MENTIONS_MAX = 50;
const IMAGES_MAX = 9;
const IMAGE_URL_MAX = 2_000;

export class CreateThreadDto {
  /** 画布坐标（flow 坐标系）；自由落点评论用此锚定。 */
  @IsOptional() @IsNumber() x?: number;
  @IsOptional() @IsNumber() y?: number;
  /** 可选：锚定到某节点（历史/扩展用途）。 */
  @IsOptional() @IsString() @MaxLength(128) nodeId?: string;
  @IsString() @MaxLength(BODY_MAX) body!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(MENTIONS_MAX) @IsString({ each: true })
  mentions?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(IMAGES_MAX) @IsString({ each: true }) @MaxLength(IMAGE_URL_MAX, { each: true })
  imageUrls?: string[];
  /** 发起者连接 id（可选）：本端 mutation 已直接更新本地。 */
  @IsOptional() @IsString() connId?: string;
}

export class CreateReplyDto {
  @IsString() @MaxLength(BODY_MAX) body!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(MENTIONS_MAX) @IsString({ each: true })
  mentions?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(IMAGES_MAX) @IsString({ each: true }) @MaxLength(IMAGE_URL_MAX, { each: true })
  imageUrls?: string[];
  @IsOptional() @IsString() connId?: string;
}

export class EditCommentDto {
  @IsString() @MaxLength(BODY_MAX) body!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(MENTIONS_MAX) @IsString({ each: true })
  mentions?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(IMAGES_MAX) @IsString({ each: true }) @MaxLength(IMAGE_URL_MAX, { each: true })
  imageUrls?: string[];
  @IsOptional() @IsString() connId?: string;
}

export class ResolveThreadDto {
  @IsBoolean() resolved!: boolean;
  @IsOptional() @IsString() connId?: string;
}

export class MoveThreadDto {
  @IsNumber() x!: number;
  @IsNumber() y!: number;
  @IsOptional() @IsString() connId?: string;
}
