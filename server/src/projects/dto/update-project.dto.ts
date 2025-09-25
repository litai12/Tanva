import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  isDeleted?: boolean;
}

