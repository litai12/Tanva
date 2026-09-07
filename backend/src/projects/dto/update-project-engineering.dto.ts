import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsNumber, IsObject, IsOptional, Min } from 'class-validator';

export class UpdateProjectEngineeringDto {
  @ApiProperty({ description: '建筑/BIM/采购业务状态，不进入设计 JSON' })
  @IsDefined()
  @IsObject()
  state!: Record<string, unknown>;

  @ApiProperty({ required: false, description: '客户端读取到的工程状态版本' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  version?: number;
}
