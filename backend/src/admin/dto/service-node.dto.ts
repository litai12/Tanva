import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsInt, IsBoolean, IsOptional, Min } from 'class-validator';

export class CreateServiceNodeDto {
  @ApiProperty({ description: '服务类型（唯一标识）' })
  @IsString()
  serviceType!: string;

  @ApiProperty({ description: '服务名称' })
  @IsString()
  serviceName!: string;

  @ApiProperty({ description: '提供商' })
  @IsString()
  provider!: string;

  @ApiProperty({ description: '每次调用消耗积分' })
  @IsInt()
  @Min(0)
  creditsPerCall!: number;

  @ApiPropertyOptional({ description: '服务描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '是否启用', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateServiceNodeDto {
  @ApiPropertyOptional({ description: '服务名称' })
  @IsOptional()
  @IsString()
  serviceName?: string;

  @ApiPropertyOptional({ description: '提供商' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: '每次调用消耗积分' })
  @IsOptional()
  @IsInt()
  @Min(0)
  creditsPerCall?: number;

  @ApiPropertyOptional({ description: '服务描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
