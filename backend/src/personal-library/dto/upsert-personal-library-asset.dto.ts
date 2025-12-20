import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsObject } from 'class-validator';

export class UpsertPersonalLibraryAssetDto {
  @ApiProperty({ description: '要写入个人库的资源对象（前端 PersonalLibraryAsset）' })
  @IsDefined()
  @IsObject()
  asset!: Record<string, unknown>;
}

