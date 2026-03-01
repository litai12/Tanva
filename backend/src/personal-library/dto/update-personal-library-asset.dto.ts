import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsObject } from 'class-validator';

export class UpdatePersonalLibraryAssetDto {
  @ApiProperty({ description: '要更新的字段 patch（部分 PersonalLibraryAsset 字段）' })
  @IsDefined()
  @IsObject()
  patch!: Record<string, unknown>;
}

