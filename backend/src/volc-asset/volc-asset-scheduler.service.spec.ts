import { VolcAssetSchedulerService } from './volc-asset-scheduler.service';

describe('VolcAssetSchedulerService', () => {
  function build(tenantIds: string[]) {
    const volcAssetService = {
      cleanupExpiredGroup: jest
        .fn()
        .mockResolvedValue({ date: '2026-01-01', deleted: true }),
    };
    const tenantIteration = {
      forEachTenant: jest.fn(async (fn: (id: string) => Promise<void> | void) => {
        for (const id of tenantIds) await fn(id);
      }),
    };
    const service = new VolcAssetSchedulerService(
      volcAssetService as any,
      tenantIteration as any,
    );
    return { service, volcAssetService, tenantIteration };
  }

  it('只有 default 一个租户时清理调用一次（回归安全）', async () => {
    const { service, volcAssetService, tenantIteration } = build(['default']);
    await service.handleExpiredGroupCleanup();
    expect(tenantIteration.forEachTenant).toHaveBeenCalledTimes(1);
    expect(volcAssetService.cleanupExpiredGroup).toHaveBeenCalledTimes(1);
  });

  it('多租户时按 active 租户数迭代清理', async () => {
    const { service, volcAssetService } = build(['default', 't_b']);
    await service.handleExpiredGroupCleanup();
    expect(volcAssetService.cleanupExpiredGroup).toHaveBeenCalledTimes(2);
  });

  it('上一次未完成时跳过（并发互斥）', async () => {
    const { service, tenantIteration } = build(['default']);
    (service as any).cleanupRunning = true;
    await service.handleExpiredGroupCleanup();
    expect(tenantIteration.forEachTenant).not.toHaveBeenCalled();
  });

  it('迭代抛错也会复位运行标志', async () => {
    const { service, tenantIteration } = build(['default']);
    tenantIteration.forEachTenant.mockRejectedValueOnce(new Error('boom'));
    await service.handleExpiredGroupCleanup();
    expect((service as any).cleanupRunning).toBe(false);
  });
});
