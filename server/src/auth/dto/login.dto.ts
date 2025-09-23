import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: '手机号（必填）' })
  @Matches(/^1[3-9]\d{9}$/,{ message: '手机号格式不正确' })
  phone!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @Length(8, 100)
  password!: string;
}
