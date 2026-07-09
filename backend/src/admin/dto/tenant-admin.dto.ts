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

  // 首页模板：default = 平台默认首页；newway = NewWay 官网宣发页；xingdou = 星斗传媒官网（含 /workspace 工作台）
  @IsOptional()
  @IsIn(['default', 'newway', 'xingdou'])
  homepage?: 'default' | 'newway' | 'xingdou';
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

/**
 * 设置租户支付商户配置。每个字段：传字符串=设置(空串=清除)，不传=保持不变。
 * 私钥/证书/APIv3 key 经 AES-256-GCM 加密后入库；商户号/appid/序列号明文存。
 */
export class SetTenantPaymentConfigDto {
  // 微信（明文）
  @IsOptional() @IsString() wechatAppId?: string;
  @IsOptional() @IsString() wechatMchId?: string;
  @IsOptional() @IsString() wechatSerialNo?: string;
  // 微信（密文）
  @IsOptional() @IsString() wechatPrivateKey?: string;
  @IsOptional() @IsString() wechatCertificate?: string;
  @IsOptional() @IsString() wechatApiV3Key?: string;
  // 支付宝（明文）
  @IsOptional() @IsString() alipayAppId?: string;
  // 支付宝（密文）
  @IsOptional() @IsString() alipayPrivateKey?: string;
  @IsOptional() @IsString() alipayPublicKey?: string;
}
