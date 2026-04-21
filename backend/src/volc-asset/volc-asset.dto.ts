// backend/src/volc-asset/volc-asset.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UploadAssetDto {
  @ApiProperty({ description: '素材源 URL', maxLength: 2048 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  sourceUrl!: string;

  @ApiProperty({ description: '素材类型', enum: ['image'] })
  @IsIn(['image'])
  assetType!: 'image';
}

export type VolcAssetStatus = 'processing' | 'active' | 'failed';

export interface UploadAssetResponse {
  assetId: string;
  status: VolcAssetStatus;
  errorMessage?: string;
}

export interface AssetStatusResponse {
  status: VolcAssetStatus;
  errorMessage?: string;
}
