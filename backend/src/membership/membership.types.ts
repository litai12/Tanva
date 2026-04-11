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

export interface MembershipNextChangeView {
  id: string;
  targetPlanId: string;
  targetPlanCode: string;
  targetPlanName: string;
  targetBillingCycle: MembershipBillingCycle;
  changeType: string;
  effectiveMode: string;
  status: string;
  reason: string | null;
  effectiveAt: Date;
  currentPeriodEndAt: Date | null;
  createdAt: Date;
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
