import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_MEMBERSHIP_CREDIT_POLICY,
  MEMBERSHIP_CREDIT_POLICY_SETTING_KEY,
  type MembershipCreditPolicyConfig,
  type MembershipCreditPolicyView,
  type UpdateMembershipCreditPolicyInput,
} from './business-policy.types';

@Injectable()
export class BusinessPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  getDefaultMembershipCreditPolicy(): MembershipCreditPolicyConfig {
    return { ...DEFAULT_MEMBERSHIP_CREDIT_POLICY };
  }

  async getMembershipCreditPolicy(): Promise<MembershipCreditPolicyConfig> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: MEMBERSHIP_CREDIT_POLICY_SETTING_KEY },
    });

    return this.normalizeMembershipCreditPolicy(this.parseSettingValue(setting?.value));
  }

  async getMembershipCreditPolicyView(): Promise<MembershipCreditPolicyView> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: MEMBERSHIP_CREDIT_POLICY_SETTING_KEY },
    });

    return {
      settingKey: MEMBERSHIP_CREDIT_POLICY_SETTING_KEY,
      defaults: this.getDefaultMembershipCreditPolicy(),
      effective: this.normalizeMembershipCreditPolicy(this.parseSettingValue(setting?.value)),
      rawValue: setting?.value ?? null,
      updatedAt: setting?.updatedAt ?? null,
      updatedBy: setting?.updatedBy ?? null,
      description: '会员积分策略配置：赠送衰减、固定积分时效、签到奖励、月度刷新周期',
    };
  }

  async updateMembershipCreditPolicy(
    input: UpdateMembershipCreditPolicyInput,
    updatedBy: string,
  ): Promise<MembershipCreditPolicyView> {
    const current = await this.getMembershipCreditPolicy();
    const effective = this.normalizeMembershipCreditPolicy({
      ...current,
      ...input,
    });

    await this.prisma.systemSetting.upsert({
      where: { key: MEMBERSHIP_CREDIT_POLICY_SETTING_KEY },
      update: {
        value: JSON.stringify(effective),
        updatedBy,
        description: '会员积分策略配置',
        metadata: {
          category: 'membership',
          updatedFrom: 'admin-membership-credit-policy',
        },
      },
      create: {
        key: MEMBERSHIP_CREDIT_POLICY_SETTING_KEY,
        value: JSON.stringify(effective),
        updatedBy,
        description: '会员积分策略配置',
        metadata: {
          category: 'membership',
          updatedFrom: 'admin-membership-credit-policy',
        },
      },
    });

    return this.getMembershipCreditPolicyView();
  }

  private parseSettingValue(value: string | null | undefined): unknown {
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private normalizeMembershipCreditPolicy(raw: unknown): MembershipCreditPolicyConfig {
    const defaults = this.getDefaultMembershipCreditPolicy();
    const candidate = this.asPlainObject(raw);

    return {
      dailyGiftDecayCredits: this.parseNonNegativeInt(
        candidate?.dailyGiftDecayCredits,
        defaults.dailyGiftDecayCredits,
        'dailyGiftDecayCredits',
      ),
      fixedCreditExpireDays: this.parseNonNegativeInt(
        candidate?.fixedCreditExpireDays,
        defaults.fixedCreditExpireDays,
        'fixedCreditExpireDays',
      ),
      dailyRewardCredits: this.parseNonNegativeInt(
        candidate?.dailyRewardCredits,
        defaults.dailyRewardCredits,
        'dailyRewardCredits',
      ),
      dailyRewardExpireDays: this.parseNonNegativeInt(
        candidate?.dailyRewardExpireDays,
        defaults.dailyRewardExpireDays,
        'dailyRewardExpireDays',
      ),
      consecutive7DayBonusCredits: this.parseNonNegativeInt(
        candidate?.consecutive7DayBonusCredits,
        defaults.consecutive7DayBonusCredits,
        'consecutive7DayBonusCredits',
      ),
      membershipRefreshCycleDays: this.parsePositiveInt(
        candidate?.membershipRefreshCycleDays,
        defaults.membershipRefreshCycleDays,
        'membershipRefreshCycleDays',
      ),
    };
  }

  private asPlainObject(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private parseNonNegativeInt(value: unknown, fallback: number, field: string): number {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(`${field} 必须是大于等于 0 的整数`);
    }

    return parsed;
  }

  private parsePositiveInt(value: unknown, fallback: number, field: string): number {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(`${field} 必须是大于 0 的整数`);
    }

    return parsed;
  }
}
