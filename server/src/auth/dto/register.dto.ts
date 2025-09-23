import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @Length(8, 100)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, { message: '密码需包含大小写字母和数字' })
  password!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  name?: string;

  @ApiProperty({ description: '手机号（必填），国内 11 位' })
  @Matches(/^1[3-9]\d{9}$/,{ message: '手机号格式不正确' })
  phone!: string;
}
