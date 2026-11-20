import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreditsService } from '../credits/credits.service';
import { TenantIterationService } from '../tenancy/tenant-iteration.service';
import { MembershipService } from './membership.service';

@Injectable()
export class MembershipSchedulerService {
  private readonly logger = new Logger(MembershipSchedulerService.name);
  private expiryJobRunning = false;
  private freeStarterQuotaJobRunning = false;
  private giftDecayJobRunning = false;
  private yearlyRefreshJobRunning = false;
  private scheduledChangeJobRunning = false;
  private annualUpgradeAuditJobRunning = false;

  constructor(
    private readonly membershipService: MembershipService,
    private readonly creditsService: CreditsService,
    private readonly tenantIteration: TenantIterationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleFreeStarterQuotaIssue() {
    // Product policy(2026-07-09): 注册不再无条件赠送积分，仅填写邀请码的用户获得初始积分
    // （注册/绑定邀请码时经 getOrCreateAccount 发放）。不再对存量免费用户进行每日定时补发。
    return;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleMembershipExpiry() {
    if (this.expiryJobRunning) {
      this.logger.warn('跳过会员到期扫描：上一次任务尚未完成');
      return;
    }

    this.expiryJobRunning = true;
    try {
      await this.tenantIteration.forEachTenant(async () => {
        const result = await this.membershipService.expireElapsedMemberships();
        if (
          result.expiredSubscriptions > 0 ||
          result.expiredLots > 0 ||
          result.resetSnapshots > 0
        ) {
          this.logger.log(
            `会员到期扫描完成: subscriptions=${result.expiredSubscriptions}, lots=${result.expiredLots}, resetSnapshots=${result.resetSnapshots}, expiredCredits=${result.expiredCredits}`,
          );
        }

        // 兜底：按 lot 自身 expiresAt 清扫（跨周期换购后旧周期 lot 不再随订阅周期结束清扫）
        const overdue =
          await this.membershipService.expireOverdueMembershipBoundLots();
        if (overdue.expiredLots > 0) {
          this.logger.log(
            `会员积分 lot 到期兜底清扫完成: lots=${overdue.expiredLots}, credits=${overdue.expiredCredits}`,
          );
        }
      });
    } catch (error) {
      this.logger.error('会员到期扫描失败:', error);
    } finally {
      this.expiryJobRunning = false;
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleAnnualUpgradeInvariantAudit() {
    if (this.annualUpgradeAuditJobRunning) {
      this.logger.warn('跳过年卡升级一致性巡检：上一次任务尚未完成');
      return;
    }

    this.annualUpgradeAuditJobRunning = true;
    try {
      await this.tenantIteration.forEachTenant(async () => {
        const result =
          await this.membershipService.auditRecentPaidAnnualUpgradeInvariants();
        if (result.violations.length > 0) {
          this.logger.error(
            `年卡升级一致性巡检发现异常（仅报警，未自动修复或补积分）: checked=${result.checkedOrders}, violations=${JSON.stringify(result.violations)}`,
          );
        }
      });
    } catch (error) {
      this.logger.error('年卡升级一致性巡检失败:', error);
    } finally {
      this.annualUpgradeAuditJobRunning = false;
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleScheduledMembershipChanges() {
    if (this.scheduledChangeJobRunning) {
      this.logger.warn('跳过待生效订阅切换：上一次任务尚未完成');
      return;
    }

    this.scheduledChangeJobRunning = true;
    try {
      await this.tenantIteration.forEachTenant(async () => {
        const result = await this.membershipService.applyDueScheduledChanges();
        if (result.appliedCount > 0) {
          this.logger.log(`待生效订阅切换完成: applied=${result.appliedCount}`);
        }
      });
    } catch (error) {
      this.logger.error('待生效订阅切换失败:', error);
    } finally {
      this.scheduledChangeJobRunning = false;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleGiftDecay() {
    if (this.giftDecayJobRunning) {
      this.logger.warn('跳过赠送积分衰减：上一次任务尚未完成');
      return;
    }

    this.giftDecayJobRunning = true;
    try {
      await this.tenantIteration.forEachTenant(async () => {
        const result = await this.membershipService.decayDailyGiftCredits();
        if (result.affectedUsers > 0 || result.decayedCredits > 0) {
          this.logger.log(
            `赠送积分衰减完成: users=${result.affectedUsers}, decayedCredits=${result.decayedCredits}, updatedLots=${result.updatedLots}`,
          );
        }
      });
    } catch (error) {
      this.logger.error('赠送积分衰减失败:', error);
    } finally {
      this.giftDecayJobRunning = false;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async handleDailyMembershipGiftIssue() {
    // Product policy: VIP plans no longer issue daily gift credits.
    return;
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async handleYearlyQuotaRefresh() {
    if (this.yearlyRefreshJobRunning) {
      this.logger.warn('跳过年费会员月度额度刷新：上一次任务尚未完成');
      return;
    }

    this.yearlyRefreshJobRunning = true;
    try {
      await this.tenantIteration.forEachTenant(async () => {
        const result = await this.membershipService.refreshYearlySubscriptionQuotaLots();
        if (result.refreshedSubscriptions > 0 || result.grantedCredits > 0) {
          this.logger.log(
            `年费会员月度额度刷新完成: subscriptions=${result.refreshedSubscriptions}, grantedCredits=${result.grantedCredits}, createdLots=${result.createdLots}`,
          );
        }
      });
    } catch (error) {
      this.logger.error('年费会员月度额度刷新失败:', error);
    } finally {
      this.yearlyRefreshJobRunning = false;
    }
  }
}
