import { IsInt, IsOptional, Min } from 'class-validator';

export class SetMemberQuotaDto {
  @IsOptional() @IsInt() @Min(0) quota?: number | null;
}
