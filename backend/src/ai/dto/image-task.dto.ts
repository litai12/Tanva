import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class CreateImageTaskResponseDto {
  @IsUUID()
  taskId!: string;

  @IsString()
  status!: 'queued' | 'processing' | 'succeeded' | 'failed';
}

export class QueryImageTaskDto {
  @IsUUID()
  @IsNotEmpty()
  taskId!: string;
}

export class ImageTaskStatusResponseDto {
  @IsString()
  status!: 'queued' | 'processing' | 'succeeded' | 'failed';

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  textResponse?: string;

  @IsOptional()
  @IsString()
  error?: string;

  @IsOptional()
  progress?: number;
}
