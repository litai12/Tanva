import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;
}

