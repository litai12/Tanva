import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export const PROMPT_MEDIA_TYPES = ['image', 'video'] as const;
export const PROMPT_LIBRARY_SORTS = ['name_asc', 'time_asc', 'time_desc'] as const;
export const PROMPT_LIBRARY_SOURCES = ['official', 'custom'] as const;

export type PromptMediaType = (typeof PROMPT_MEDIA_TYPES)[number];
export type PromptLibrarySort = (typeof PROMPT_LIBRARY_SORTS)[number];
export type PromptLibrarySource = (typeof PROMPT_LIBRARY_SOURCES)[number];

export class ListOfficialPromptsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsIn(PROMPT_MEDIA_TYPES)
  mediaType?: PromptMediaType;

  @IsOptional()
  @IsIn(PROMPT_LIBRARY_SORTS)
  sort: PromptLibrarySort = 'time_desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  pageSize = 24;
}

export class ListUserPromptsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;

  @IsOptional()
  @IsIn(PROMPT_MEDIA_TYPES)
  mediaType?: PromptMediaType;
}

export class CreateUserPromptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50_000)
  promptText!: string;

  @IsIn(PROMPT_MEDIA_TYPES)
  mediaType!: PromptMediaType;

  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  previewUrl?: string;
}

export class UpdateUserPromptDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  description?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50_000)
  promptText?: string;

  @IsOptional()
  @IsIn(PROMPT_MEDIA_TYPES)
  mediaType?: PromptMediaType;

  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  previewUrl?: string;
}

export class SetPromptFavoriteDto {
  @IsBoolean()
  favorite!: boolean;
}
