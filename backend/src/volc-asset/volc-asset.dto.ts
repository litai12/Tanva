// backend/src/volc-asset/volc-asset.dto.ts
import { IsIn, IsString, MaxLength } from 'class-validator';

export class UploadAssetDto {
  @IsString()
  @MaxLength(2048)
  sourceUrl!: string;

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
