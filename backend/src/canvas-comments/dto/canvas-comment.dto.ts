import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const BODY_MAX = 10_000;
const MENTIONS_MAX = 50;

export class CreateThreadDto {
  @IsString() @MaxLength(128) nodeId!: string;
  @IsString() @MaxLength(BODY_MAX) body!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(MENTIONS_MAX) @IsString({ each: true })
  mentions?: string[];
  /** 发起者连接 id（可选）：用于抑制对自身其他无关回声，本端 mutation 已直接更新本地。 */
  @IsOptional() @IsString() connId?: string;
}

export class CreateReplyDto {
  @IsString() @MaxLength(BODY_MAX) body!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(MENTIONS_MAX) @IsString({ each: true })
  mentions?: string[];
  @IsOptional() @IsString() connId?: string;
}

export class EditCommentDto {
  @IsString() @MaxLength(BODY_MAX) body!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(MENTIONS_MAX) @IsString({ each: true })
  mentions?: string[];
  @IsOptional() @IsString() connId?: string;
}

export class ResolveThreadDto {
  @IsBoolean() resolved!: boolean;
  @IsOptional() @IsString() connId?: string;
}
