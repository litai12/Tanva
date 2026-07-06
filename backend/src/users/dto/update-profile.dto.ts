import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateProfileDto {
  @ApiProperty({ required: false, minLength: 1, maxLength: 50, description: '用户名/昵称' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  name?: string;

  @ApiProperty({ required: false, nullable: true, description: 'Avatar URL' })
  @IsOptional()
  @IsString()
  avatarUrl?: string | null;
}
