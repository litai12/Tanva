import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsObject } from 'class-validator';

export class UpsertUserTemplateDto {
  @ApiProperty({ description: '用户模板对象（FlowTemplate）' })
  @IsDefined()
  @IsObject()
  template!: Record<string, unknown>;
}

