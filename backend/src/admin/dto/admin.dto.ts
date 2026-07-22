import { IsEmail, IsString, IsOptional, IsNumber, IsDateString, Min, Max, IsIn, Length, Matches } from 'class-validator';
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

  @ApiPropertyOptional({ description: '租户筛选（仅主站超管）：租户id 或 "all"' })
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class CreateAdminUserDto {
  @ApiProperty({ description: '手机号' })
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确，请输入有效的11位手机号' })
  phone!: string;

  @ApiProperty({ description: '登录密码' })
  @IsString()
  @Length(8, 100, { message: '密码长度必须在8到100位之间' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, { message: '密码需包含大小写字母和数字' })
  password!: string;

  @ApiProperty({ description: '昵称' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ description: '邮箱' })
  @IsOptional()
  @IsEmail()
  email?: string;
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

  @ApiPropertyOptional({ description: '租户筛选（仅主站超管）：租户id 或 "all"' })
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class ApiUsageModelStatsQueryDto extends ApiUsageStatsQueryDto {
  @ApiPropertyOptional({ description: '模型节点' })
  @IsOptional()
  @IsString()
  modelNode?: string;

  @ApiPropertyOptional({ description: '渠道' })
  @IsOptional()
  @IsString()
  channel?: string;
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

  @ApiPropertyOptional({ description: '用户搜索关键词（用户ID/手机号/邮箱/昵称）' })
  @IsOptional()
  @IsString()
  userSearch?: string;

  @ApiPropertyOptional({ description: '服务类型' })
  @IsOptional()
  @IsString()
  serviceType?: string;

  @ApiPropertyOptional({ description: 'AI提供商' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: 'Model' })
  @IsOptional()
  @IsString()
  model?: string;

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

  @ApiPropertyOptional({ description: '租户筛选（仅主站超管）：租户id 或 "all"' })
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class UpdateUserStatusDto {
  @ApiProperty({ description: '用户状态', enum: ['active', 'inactive', 'banned'] })
  @IsString()
  status!: string;
}

export class UpdateUserRoleDto {
  @ApiProperty({ description: '用户角色', enum: ['user', 'admin', 'normal_admin'] })
  @IsString()
  role!: string;

  @ApiPropertyOptional({ description: '目标用户所属租户（仅主站超管跨租户设管理员时传）' })
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class CreditChangeRecordsQueryDto {
  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页数量', default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: '搜索关键词（手机号/邮箱/昵称）' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: '用户ID（精确筛选）' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description: '来源筛选',
    enum: ['all', 'recharge', 'admin_add', 'admin_deduct', 'invite_reward', 'all_earned'],
    default: 'all',
  })
  @IsOptional()
  @IsString()
  source?: 'all' | 'recharge' | 'admin_add' | 'admin_deduct' | 'invite_reward' | 'all_earned' = 'all';

  @ApiPropertyOptional({ description: '开始日期' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: '租户筛选（仅主站超管）：租户id 或 "all"' })
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class CreditAnomalyRecordsQueryDto {
  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页数量', default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: '搜索关键词（手机号/邮箱/昵称）' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: '用户ID（精确筛选）' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description: '异常等级',
    enum: ['yellow', 'red', 'purple'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['yellow', 'red', 'purple'])
  severity?: 'yellow' | 'red' | 'purple';

  @ApiPropertyOptional({ description: '开始日期（默认今天）' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期（默认明天）' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: '租户筛选（仅主站超管）：租户id 或 "all"' })
  @IsOptional()
  @IsString()
  tenantId?: string;
}
