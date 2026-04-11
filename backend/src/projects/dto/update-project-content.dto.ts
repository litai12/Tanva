import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsDefined, IsNumber, IsObject, IsOptional, ValidateNested } from 'class-validator';

class WorkflowHistoryMetaDto {
  @ApiProperty({ required: false, description: '若本次保存源于恢复历史，则记录源版本时间戳' })
  @IsOptional()
  @IsDateString()
  restoredFromUpdatedAt?: string;

  @ApiProperty({ required: false, description: '若本次保存源于恢复历史，则记录源版本号' })
  @IsOptional()
  @IsNumber()
  restoredFromVersion?: number;
}

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

  @ApiProperty({ required: false, description: '工作流历史附加元数据（例如恢复来源）' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WorkflowHistoryMetaDto)
  workflowHistoryMeta?: WorkflowHistoryMetaDto;
}
