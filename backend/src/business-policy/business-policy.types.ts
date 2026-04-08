export const MEMBERSHIP_CREDIT_POLICY_SETTING_KEY = 'membership_credit_policy';

export interface MembershipCreditPolicyConfig {
  dailyGiftDecayCredits: number;
  fixedCreditExpireDays: number;
  freeUserMonthlyQuotaCredits: number;
  dailyRewardCredits: number;
  consecutive7DayRewardMultiplier: number;
  membershipRefreshCycleDays: number;
}

export interface MembershipCreditPolicyView {
  settingKey: string;
  defaults: MembershipCreditPolicyConfig;
  effective: MembershipCreditPolicyConfig;
  rawValue: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
  description: string;
}

export interface UpdateMembershipCreditPolicyInput {
  dailyGiftDecayCredits?: number;
  fixedCreditExpireDays?: number;
  freeUserMonthlyQuotaCredits?: number;
  dailyRewardCredits?: number;
  consecutive7DayRewardMultiplier?: number;
  membershipRefreshCycleDays?: number;
}

export const DEFAULT_MEMBERSHIP_CREDIT_POLICY: MembershipCreditPolicyConfig = {
  dailyGiftDecayCredits: 50,
  fixedCreditExpireDays: 730,
  freeUserMonthlyQuotaCredits: 500,
  dailyRewardCredits: 50,
  consecutive7DayRewardMultiplier: 3,
  membershipRefreshCycleDays: 30,
};
