import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsNumber, IsObject, IsOptional } from 'class-validator';

export class UpdateProjectContentDto {
  @ApiProperty({ description: '项目内容快照' })
  @IsDefined()
  @IsObject()
  content!: Record<string, unknown>;

  @ApiProperty({ required: false, description: '客户端当前内容版本号' })
  @IsOptional()
  @IsNumber()
  version?: number;
}
