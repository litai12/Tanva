import { IsIn, IsInt, IsString, Min, Max } from 'class-validator';

export class CreateSubscriptionDto {
  @IsString() planId!: string;
  @IsIn(['monthly', 'annual']) billingCycle!: 'monthly' | 'annual';
  @IsInt() @Min(1) @Max(500) seatCount!: number;
}
