import { IsNotEmpty, IsString } from 'class-validator';

export class ToolSelectionRequestDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;
}

