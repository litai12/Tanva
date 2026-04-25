import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class StartBioAuthDto {
  @ApiProperty({ description: '用于人脸比对的基准图片 URL', maxLength: 2048 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  imageUrl!: string;
}

export class CreateAssetInGroupDto {
  @ApiProperty({ description: '已认证的 LivenessFace GroupId' })
  @IsString()
  @IsNotEmpty()
  groupId!: string;

  @ApiProperty({ description: '素材图片 URL', maxLength: 2048 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  imageUrl!: string;
}

export type BioAuthStatus = 'processing' | 'active' | 'failed';

export interface StartBioAuthResponse {
  taskId: string;
  h5Link: string;
}

export interface BioAuthStatusResponse {
  status: BioAuthStatus;
  errorMessage?: string;
  assetId?: string;
  groupId?: string;
}

export interface BioAuthGroupItem {
  groupId: string;
  imageUrl: string;
  createdAt: string;
}

export interface ListGroupsResponse {
  groups: BioAuthGroupItem[];
}

export interface CreateAssetInGroupResponse {
  taskId: string;
}
