import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class SmsLoginDto {
  @ApiProperty({ description: '手机号（必填）' })
  @Matches(/^1[3-9]\d{9}$/,{ message: '手机号格式不正确' })
  phone!: string;

  @ApiProperty({ description: '短信验证码' })
  code!: string;
}

