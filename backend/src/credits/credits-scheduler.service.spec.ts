import { CreditsSchedulerService } from './credits-scheduler.service';
import { CreditsService } from './credits.service';
import { CreditsAnomalyService } from './credits-anomaly.service';
import { TenantIterationService } from '../tenancy/tenant-iteration.service';

function makeCreditsService(): CreditsService {
  return {
    cleanupExpiredDailyRewards: jest
      .fn()
      .mockResolvedValue({ processedUsers: 0, totalExpiredCredits: 0 }),
    cleanupExpiredFreeUserMonthlyQuotaCredits: jest
      .fn()
      .mockResolvedValue({ processedAccounts: 0, expiredLots: 0, expiredCredits: 0 }),
    autoRefundStalePendingImageUsages: jest
      .fn()
      .mockResolvedValue({ scanned: 0, refunded: 0, skippedSuccess: 0, errors: 0, timeoutMinutes: 30 }),
    autoRefundStalePendingVideoUsages: jest
      .fn()
      .mockResolvedValue({ scanned: 0, refunded: 0, skippedSuccess: 0, errors: 0, timeoutMinutes: 30 }),
  } as unknown as CreditsService;
}

function makeAnomalyService(): CreditsAnomalyService {
  return {
    detectDailyCreditAnomalies: jest
      .fn()
      .mockResolvedValue({ dayLabel: '2026-06-08', scannedTransactions: 0, scannedUsers: 0, upsertedRecords: 0 }),
  } as unknown as CreditsAnomalyService;
}

/**
 * 假的 TenantIterationService：对给定 tenantIds 依次执行 fn，
 * 模拟每个 active 租户在自己的 CLS 内各跑一次。
 */
function makeTenantIteration(tenantIds: string[]): TenantIterationService {
  return {
    forEachTenant: jest.fn(async (fn: (tenantId: string) => Promise<void> | void) => {
      for (const tenantId of tenantIds) {
        await fn(tenantId);
      }
    }),
  } as unknown as TenantIterationService;
}

describe('CreditsSchedulerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('回归安全：只有 default 一个租户时各任务只跑一次', () => {
    it('handleExpiredCreditsCleanup 跑一次清理', async () => {
      const credits = makeCreditsService();
      const anomaly = makeAnomalyService();
      const iteration = makeTenantIteration(['default']);
      const svc = new CreditsSchedulerService(credits, anomaly, iteration);
      jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);

      await svc.handleExpiredCreditsCleanup();

      expect(iteration.forEachTenant).toHaveBeenCalledTimes(1);
      expect(credits.cleanupExpiredDailyRewards).toHaveBeenCalledTimes(1);
      expect(credits.cleanupExpiredFreeUserMonthlyQuotaCredits).toHaveBeenCalledTimes(1);
    });

    it('handleStalePendingAutoRefund 跑一次退款扫描', async () => {
      const credits = makeCreditsService();
      const anomaly = makeAnomalyService();
      const iteration = makeTenantIteration(['default']);
      const svc = new CreditsSchedulerService(credits, anomaly, iteration);

      await svc.handleStalePendingAutoRefund();

      expect(iteration.forEachTenant).toHaveBeenCalledTimes(1);
      expect(credits.autoRefundStalePendingImageUsages).toHaveBeenCalledTimes(1);
      expect(credits.autoRefundStalePendingVideoUsages).toHaveBeenCalledTimes(1);
    });

    it('handleCreditAnomalyDetection 跑一次检测', async () => {
      const credits = makeCreditsService();
      const anomaly = makeAnomalyService();
      const iteration = makeTenantIteration(['default']);
      const svc = new CreditsSchedulerService(credits, anomaly, iteration);

      await svc.handleCreditAnomalyDetection();

      expect(iteration.forEachTenant).toHaveBeenCalledTimes(1);
      expect(anomaly.detectDailyCreditAnomalies).toHaveBeenCalledTimes(1);
    });
  });

  describe('多租户：每个 active 租户各跑一次', () => {
    it('handleExpiredCreditsCleanup 对每个租户都跑清理', async () => {
      const credits = makeCreditsService();
      const anomaly = makeAnomalyService();
      const iteration = makeTenantIteration(['t_acme', 'default']);
      const svc = new CreditsSchedulerService(credits, anomaly, iteration);
      jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);

      await svc.handleExpiredCreditsCleanup();

      expect(credits.cleanupExpiredDailyRewards).toHaveBeenCalledTimes(2);
      expect(credits.cleanupExpiredFreeUserMonthlyQuotaCredits).toHaveBeenCalledTimes(2);
    });

    it('handleStalePendingAutoRefund 对每个租户都扫描退款', async () => {
      const credits = makeCreditsService();
      const anomaly = makeAnomalyService();
      const iteration = makeTenantIteration(['t_acme', 'default']);
      const svc = new CreditsSchedulerService(credits, anomaly, iteration);

      await svc.handleStalePendingAutoRefund();

      expect(credits.autoRefundStalePendingImageUsages).toHaveBeenCalledTimes(2);
      expect(credits.autoRefundStalePendingVideoUsages).toHaveBeenCalledTimes(2);
    });

    it('handleCreditAnomalyDetection 对每个租户都检测', async () => {
      const credits = makeCreditsService();
      const anomaly = makeAnomalyService();
      const iteration = makeTenantIteration(['t_acme', 'default']);
      const svc = new CreditsSchedulerService(credits, anomaly, iteration);

      await svc.handleCreditAnomalyDetection();

      expect(anomaly.detectDailyCreditAnomalies).toHaveBeenCalledTimes(2);
    });
  });

  describe('进程级 running 守卫', () => {
    it('handleStalePendingAutoRefund 重入时跳过且不再迭代租户', async () => {
      const credits = makeCreditsService();
      const anomaly = makeAnomalyService();
      const iteration = makeTenantIteration(['default']);
      const svc = new CreditsSchedulerService(credits, anomaly, iteration);
      jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);

      (svc as any).stalePendingAutoRefundRunning = true;
      await svc.handleStalePendingAutoRefund();

      expect(iteration.forEachTenant).not.toHaveBeenCalled();
      expect(credits.autoRefundStalePendingImageUsages).not.toHaveBeenCalled();
    });

    it('handleStalePendingAutoRefund 正常完成后复位 running 标记', async () => {
      const credits = makeCreditsService();
      const anomaly = makeAnomalyService();
      const iteration = makeTenantIteration(['default']);
      const svc = new CreditsSchedulerService(credits, anomaly, iteration);

      await svc.handleStalePendingAutoRefund();

      expect((svc as any).stalePendingAutoRefundRunning).toBe(false);
    });

    it('handleCreditAnomalyDetection 重入时跳过且不再迭代租户', async () => {
      const credits = makeCreditsService();
      const anomaly = makeAnomalyService();
      const iteration = makeTenantIteration(['default']);
      const svc = new CreditsSchedulerService(credits, anomaly, iteration);
      jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);

      (svc as any).anomalyDetectionRunning = true;
      await svc.handleCreditAnomalyDetection();

      expect(iteration.forEachTenant).not.toHaveBeenCalled();
      expect(anomaly.detectDailyCreditAnomalies).not.toHaveBeenCalled();
    });
  });
});
