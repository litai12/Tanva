import { IsString, IsOptional, IsNumber, IsEnum, IsDateString, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UsersQueryDto {
  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页数量', default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  pageSize?: number = 10;

  @ApiPropertyOptional({ description: '搜索关键词（手机号/邮箱/昵称）' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: '排序字段', default: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}

export class ApiUsageStatsQueryDto {
  @ApiPropertyOptional({ description: '开始日期' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class ApiUsageRecordsQueryDto {
  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页数量', default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  pageSize?: number = 10;

  @ApiPropertyOptional({ description: '用户ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: '服务类型' })
  @IsOptional()
  @IsString()
  serviceType?: string;

  @ApiPropertyOptional({ description: 'AI提供商' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: '响应状态' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: '开始日期' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateUserStatusDto {
  @ApiProperty({ description: '用户状态', enum: ['active', 'inactive', 'banned'] })
  @IsString()
  status!: string;
}

export class UpdateUserRoleDto {
  @ApiProperty({ description: '用户角色', enum: ['user', 'admin'] })
  @IsString()
  role!: string;
}
