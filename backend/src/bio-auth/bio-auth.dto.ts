import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class StartBioAuthDto {
  @ApiProperty({ description: '用于人脸比对的基准图片 URL', maxLength: 2048 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  imageUrl!: string;
}

export type BioAuthStatus = 'processing' | 'active' | 'failed';

export interface StartBioAuthResponse {
  taskId: string;
}

export interface BioAuthStatusResponse {
  status: BioAuthStatus;
  errorMessage?: string;
}
