export const MEMBERSHIP_CREDIT_POLICY_SETTING_KEY = 'membership_credit_policy';

export interface MembershipCreditPolicyConfig {
  dailyGiftDecayCredits: number;
  fixedCreditExpireDays: number;
  dailyRewardCredits: number;
  dailyRewardExpireDays: number;
  consecutive7DayBonusCredits: number;
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
  dailyRewardCredits?: number;
  dailyRewardExpireDays?: number;
  consecutive7DayBonusCredits?: number;
  membershipRefreshCycleDays?: number;
}

export const DEFAULT_MEMBERSHIP_CREDIT_POLICY: MembershipCreditPolicyConfig = {
  dailyGiftDecayCredits: 50,
  fixedCreditExpireDays: 730,
  dailyRewardCredits: 50,
  dailyRewardExpireDays: 7,
  consecutive7DayBonusCredits: 150,
  membershipRefreshCycleDays: 30,
};
