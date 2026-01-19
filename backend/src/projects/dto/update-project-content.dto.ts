import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDefined, IsNumber, IsObject, IsOptional } from 'class-validator';

export class UpdateProjectContentDto {
  @ApiProperty({ description: '项目内容快照' })
  @IsDefined()
  @IsObject()
  content!: Record<string, unknown>;

  @ApiProperty({ required: false, description: '客户端当前内容版本号' })
  @IsOptional()
  @IsNumber()
  version?: number;

  @ApiProperty({ required: false, description: '是否写入工作流历史版本（仅保存 Flow 图快照）' })
  @IsOptional()
  @IsBoolean()
  createWorkflowHistory?: boolean;
}
