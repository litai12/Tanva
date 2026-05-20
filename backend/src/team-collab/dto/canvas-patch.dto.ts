import { IsOptional, IsString } from 'class-validator';

export class CanvasPatchDto {
  @IsOptional() patch: unknown;
  @IsString() connId!: string;
}
