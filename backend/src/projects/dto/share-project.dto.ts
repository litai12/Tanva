import { IsString } from 'class-validator';

export class ShareProjectDto {
  @IsString() teamId!: string;
}
