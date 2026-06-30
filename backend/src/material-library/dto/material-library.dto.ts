import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const MATERIAL_KINDS = [
  'character',
  'scene',
  'prop',
  'style',
  'text',
] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export class CreateMaterialAssetDto {
  @ApiProperty({ enum: MATERIAL_KINDS })
  @IsIn(MATERIAL_KINDS as unknown as string[])
  kind!: MaterialKind;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: '素材数据（imageUrl / url / thumbnailUrl / ossKey 等）' })
  @IsObject()
  initialData!: Record<string, unknown>;

  @ApiPropertyOptional({ description: '自定义文件夹 ID' })
  @IsOptional()
  @IsString()
  folderId?: string;
}

export class CreateTeamMaterialAssetDto extends CreateMaterialAssetDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  teamId!: string;
}

export class UpdateMaterialAssetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  favorite?: boolean;

  @ApiPropertyOptional({ description: '移动到的自定义文件夹 ID；null 表示移出到固定文件夹' })
  @IsOptional()
  @IsString()
  folderId?: string | null;

  @ApiPropertyOptional({ enum: MATERIAL_KINDS })
  @IsOptional()
  @IsIn(MATERIAL_KINDS as unknown as string[])
  kind?: MaterialKind;
}

export class CreateMaterialFolderDto {
  @ApiPropertyOptional({ description: '团队 ID；不传则为个人文件夹' })
  @IsOptional()
  @IsString()
  teamId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

export class UpdateMaterialFolderDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}
