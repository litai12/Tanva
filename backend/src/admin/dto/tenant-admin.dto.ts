import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @Length(1, 50)
  name!: string;

  // slug：小写字母/数字/连字符
  @IsString()
  @Matches(/^[a-z0-9-]{2,32}$/, { message: 'slug 只能是小写字母/数字/连字符，2-32 位' })
  slug!: string;

  // 可选：建租户时同时绑一个域名
  @IsOptional()
  @IsString()
  host?: string;
}

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @Length(1, 50)
  name?: string;

  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';
}

export class AddDomainDto {
  @IsString()
  host!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class SetTenantApiKeysDto {
  // 每个字段：传字符串=设置(空串=清除)，不传=保持不变
  @IsOptional()
  @IsString()
  newApiKey?: string;

  @IsOptional()
  @IsString()
  newApiKeyVip?: string;

  @IsOptional()
  @IsString()
  newApiKeySvip?: string;
}
