import { IsInt, IsOptional, Min } from 'class-validator';

export class SetMemberQuotaDto {
  /** 月度上限（null 表示清除） */
  @IsOptional()
  @IsInt()
  @Min(0)
  monthly?: number | null;

  /** 总量上限（null 表示清除） */
  @IsOptional()
  @IsInt()
  @Min(0)
  total?: number | null;
}
