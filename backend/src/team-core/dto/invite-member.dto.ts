import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';

export class InviteMemberDto {
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsInt() @Min(1) @Max(30) expiresInDays?: number;
}
