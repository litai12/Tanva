import type { Prisma } from '@prisma/client';

export type MembershipBillingCycle = 'monthly' | 'yearly';
export type MembershipStatus = 'pending_activation' | 'active' | 'expired' | 'cancelled';

export interface MembershipPlanSnapshot {
  id: string;
  code: string;
  name: string;
  billingCycle: MembershipBillingCycle;
  price: string;
  monthlyQuotaCredits: number;
  signupBonusCredits: number;
  dailyGiftCredits: number;
  metadata?: Prisma.JsonObject | null;
}

export interface ActivatePaidMembershipOrderParams {
  tx: Prisma.TransactionClient;
  userId: string;
  orderId: string;
  paidAt: Date;
}

export interface ActivatePaidMembershipOrderResult {
  subscriptionId: string;
  grantedCredits: number;
}
