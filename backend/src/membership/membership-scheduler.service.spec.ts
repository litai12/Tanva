import { MembershipSchedulerService } from './membership-scheduler.service';
import { MembershipService } from './membership.service';
import { CreditsService } from '../credits/credits.service';
import { TenantIterationService } from '../tenancy/tenant-iteration.service';

/**
 * 用一个可配置租户列表的 fake TenantIterationService：
 * forEachTenant 按列表顺序对每个 id 执行 fn（模拟在各自 CLS 内跑）。
 */
function makeTenantIteration(tenantIds: string[]): TenantIterationService {
  return {
    listActiveTenantIds: jest.fn().mockResolvedValue(tenantIds),
    forEachTenant: jest.fn(async (fn: (tenantId: string) => any) => {
      for (const id of tenantIds) {
        await fn(id);
      }
    }),
  } as unknown as TenantIterationService;
}

describe('MembershipSchedulerService 跨租户', () => {
  function build(tenantIds: string[]) {
    const membershipService = {
      expireElapsedMemberships: jest.fn().mockResolvedValue({
        expiredSubscriptions: 0,
        expiredLots: 0,
        resetSnapshots: 0,
        expiredCredits: 0,
      }),
      expireOverdueMembershipBoundLots: jest.fn().mockResolvedValue({
        expiredLots: 0,
        expiredCredits: 0,
      }),
      auditRecentPaidAnnualUpgradeInvariants: jest.fn().mockResolvedValue({
        checkedOrders: 0,
        violations: [],
      }),
      applyDueScheduledChanges: jest.fn().mockResolvedValue({ appliedCount: 0 }),
      decayDailyGiftCredits: jest.fn().mockResolvedValue({
        affectedUsers: 0,
        decayedCredits: 0,
        updatedLots: 0,
      }),
      refreshYearlySubscriptionQuotaLots: jest.fn().mockResolvedValue({
        refreshedSubscriptions: 0,
        grantedCredits: 0,
        createdLots: 0,
      }),
    } as unknown as MembershipService;

    const creditsService = {
      issueFreeUserStarterQuotaCredits: jest.fn().mockResolvedValue({
        affectedUsers: 0,
        grantedCredits: 0,
        createdLots: 0,
      }),
    } as unknown as CreditsService;

    const tenantIteration = makeTenantIteration(tenantIds);
    const svc = new MembershipSchedulerService(
      membershipService,
      creditsService,
      tenantIteration,
    );
    // 屏蔽 logger 噪音
    jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);

    return { svc, membershipService, creditsService, tenantIteration };
  }

  describe('回归安全：只有 default 一个租户时每个底层调用各一次', () => {
    it('handleFreeStarterQuotaIssue 保持停用，不再定时赠分', async () => {
      const { svc, creditsService, tenantIteration } = build(['default']);
      await svc.handleFreeStarterQuotaIssue();
      expect(tenantIteration.forEachTenant).not.toHaveBeenCalled();
      expect(creditsService.issueFreeUserStarterQuotaCredits).not.toHaveBeenCalled();
    });

    it('handleMembershipExpiry', async () => {
      const { svc, membershipService, tenantIteration } = build(['default']);
      await svc.handleMembershipExpiry();
      expect(tenantIteration.forEachTenant).toHaveBeenCalledTimes(1);
      expect(membershipService.expireElapsedMemberships).toHaveBeenCalledTimes(1);
      expect(
        membershipService.expireOverdueMembershipBoundLots,
      ).toHaveBeenCalledTimes(1);
    });

    it('handleAnnualUpgradeInvariantAudit', async () => {
      const { svc, membershipService, tenantIteration } = build(['default']);
      await svc.handleAnnualUpgradeInvariantAudit();
      expect(tenantIteration.forEachTenant).toHaveBeenCalledTimes(1);
      expect(
        membershipService.auditRecentPaidAnnualUpgradeInvariants,
      ).toHaveBeenCalledTimes(1);
    });

    it('handleScheduledMembershipChanges', async () => {
      const { svc, membershipService, tenantIteration } = build(['default']);
      await svc.handleScheduledMembershipChanges();
      expect(tenantIteration.forEachTenant).toHaveBeenCalledTimes(1);
      expect(membershipService.applyDueScheduledChanges).toHaveBeenCalledTimes(1);
    });

    it('handleGiftDecay', async () => {
      const { svc, membershipService, tenantIteration } = build(['default']);
      await svc.handleGiftDecay();
      expect(tenantIteration.forEachTenant).toHaveBeenCalledTimes(1);
      expect(membershipService.decayDailyGiftCredits).toHaveBeenCalledTimes(1);
    });

    it('handleYearlyQuotaRefresh', async () => {
      const { svc, membershipService, tenantIteration } = build(['default']);
      await svc.handleYearlyQuotaRefresh();
      expect(tenantIteration.forEachTenant).toHaveBeenCalledTimes(1);
      expect(membershipService.refreshYearlySubscriptionQuotaLots).toHaveBeenCalledTimes(1);
    });
  });

  describe('多租户：底层调用每个 active 租户各执行一次', () => {
    it('handleFreeStarterQuotaIssue 在多租户下仍保持停用', async () => {
      const { svc, creditsService } = build(['t_acme', 'default']);
      await svc.handleFreeStarterQuotaIssue();
      expect(creditsService.issueFreeUserStarterQuotaCredits).not.toHaveBeenCalled();
    });

    it('handleMembershipExpiry 迭代两个租户', async () => {
      const { svc, membershipService } = build(['t_acme', 'default']);
      await svc.handleMembershipExpiry();
      expect(membershipService.expireElapsedMemberships).toHaveBeenCalledTimes(2);
      expect(
        membershipService.expireOverdueMembershipBoundLots,
      ).toHaveBeenCalledTimes(2);
    });

    it('handleAnnualUpgradeInvariantAudit 迭代两个租户', async () => {
      const { svc, membershipService } = build(['t_acme', 'default']);
      await svc.handleAnnualUpgradeInvariantAudit();
      expect(
        membershipService.auditRecentPaidAnnualUpgradeInvariants,
      ).toHaveBeenCalledTimes(2);
    });

    it('handleScheduledMembershipChanges 迭代两个租户', async () => {
      const { svc, membershipService } = build(['t_acme', 'default']);
      await svc.handleScheduledMembershipChanges();
      expect(membershipService.applyDueScheduledChanges).toHaveBeenCalledTimes(2);
    });

    it('handleGiftDecay 迭代两个租户', async () => {
      const { svc, membershipService } = build(['t_acme', 'default']);
      await svc.handleGiftDecay();
      expect(membershipService.decayDailyGiftCredits).toHaveBeenCalledTimes(2);
    });

    it('handleYearlyQuotaRefresh 迭代两个租户', async () => {
      const { svc, membershipService } = build(['t_acme', 'default']);
      await svc.handleYearlyQuotaRefresh();
      expect(membershipService.refreshYearlySubscriptionQuotaLots).toHaveBeenCalledTimes(2);
    });
  });

  describe('并发锁仍生效：任务进行中再次触发被跳过', () => {
    it('handleMembershipExpiry 第二次调用在第一次未完成时直接返回', async () => {
      const { svc, membershipService } = build(['default']);
      let release: () => void = () => undefined;
      (membershipService.expireElapsedMemberships as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                expiredSubscriptions: 0,
                expiredLots: 0,
                resetSnapshots: 0,
                expiredCredits: 0,
              });
          }),
      );

      const first = svc.handleMembershipExpiry();
      const second = svc.handleMembershipExpiry(); // 锁定中，应被跳过
      release();
      await Promise.all([first, second]);

      // 仅第一次真正执行了底层调用
      expect(membershipService.expireElapsedMemberships).toHaveBeenCalledTimes(1);
    });
  });
});
