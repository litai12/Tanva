import { IsString, IsNumber, IsOptional, IsEnum, IsDateString, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TransactionType {
  EARN = 'earn',
  SPEND = 'spend',
  REFUND = 'refund',
  ADMIN_ADJUST = 'admin_adjust',
  DAILY_REWARD = 'daily_reward',
}

export enum ApiResponseStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  PENDING = 'pending',
}

export class GetBalanceResponseDto {
  @ApiProperty({ description: '当前积分余额' })
  balance!: number;

  @ApiProperty({ description: '历史总获得积分' })
  totalEarned!: number;

  @ApiProperty({ description: '历史总消费积分' })
  totalSpent!: number;
}

export class AdminAddCreditsDto {
  @ApiProperty({ description: '用户ID' })
  @IsString()
  userId!: string;

  @ApiProperty({ description: '添加积分数量', minimum: 1 })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiProperty({ description: '操作说明' })
  @IsString()
  description!: string;
}

export class AdminDeductCreditsDto {
  @ApiProperty({ description: '用户ID' })
  @IsString()
  userId!: string;

  @ApiProperty({ description: '扣除积分数量', minimum: 1 })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiProperty({ description: '操作说明' })
  @IsString()
  description!: string;
}

export class TransactionHistoryQueryDto {
  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页数量', default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: '交易类型', enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;
}

export class ApiUsageQueryDto {
  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页数量', default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: '服务类型' })
  @IsOptional()
  @IsString()
  serviceType?: string;

  @ApiPropertyOptional({ description: 'AI提供商' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: '响应状态', enum: ApiResponseStatus })
  @IsOptional()
  @IsEnum(ApiResponseStatus)
  status?: ApiResponseStatus;

  @ApiPropertyOptional({ description: '开始日期' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class PricingResponseDto {
  @ApiProperty({ description: '服务类型' })
  serviceType!: string;

  @ApiProperty({ description: '服务名称' })
  serviceName!: string;

  @ApiProperty({ description: 'AI提供商' })
  provider!: string;

  @ApiProperty({ description: '每次调用消耗积分' })
  creditsPerCall!: number;

  @ApiPropertyOptional({ description: '服务描述' })
  description?: string;

  @ApiPropertyOptional({ description: '最大输入token' })
  maxInputTokens?: number;

  @ApiPropertyOptional({ description: '最大上下文长度' })
  maxContextLength?: number;
}
