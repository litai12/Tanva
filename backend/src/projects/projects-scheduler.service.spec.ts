import { ProjectsSchedulerService } from './projects-scheduler.service';

describe('ProjectsSchedulerService', () => {
  const makeResult = () => ({
    deletedCount: 3,
    retentionDays: 7,
    cutoff: new Date('2026-01-01T00:00:00.000Z'),
  });

  function build(tenantIds: string[]) {
    const projectsService = {
      cleanupExpiredWorkflowHistory: jest.fn().mockResolvedValue(makeResult()),
    };
    // forEachTenant 在每个租户 CLS 内执行 fn，这里直接逐个调用以模拟。
    const tenantIteration = {
      forEachTenant: jest.fn(async (fn: (id: string) => Promise<void> | void) => {
        for (const id of tenantIds) await fn(id);
      }),
    };
    const service = new ProjectsSchedulerService(
      projectsService as any,
      tenantIteration as any,
    );
    return { service, projectsService, tenantIteration };
  }

  it('只有 default 一个租户时清理调用一次（回归安全）', async () => {
    const { service, projectsService, tenantIteration } = build(['default']);
    await service.handleWorkflowHistoryCleanup();
    expect(tenantIteration.forEachTenant).toHaveBeenCalledTimes(1);
    expect(projectsService.cleanupExpiredWorkflowHistory).toHaveBeenCalledTimes(1);
  });

  it('多租户时按 active 租户数迭代清理', async () => {
    const { service, projectsService } = build(['default', 't_b', 't_c']);
    await service.handleWorkflowHistoryCleanup();
    expect(projectsService.cleanupExpiredWorkflowHistory).toHaveBeenCalledTimes(3);
  });

  it('上一次未完成时跳过（并发互斥）', async () => {
    const { service, tenantIteration } = build(['default']);
    (service as any).workflowHistoryCleanupRunning = true;
    await service.handleWorkflowHistoryCleanup();
    expect(tenantIteration.forEachTenant).not.toHaveBeenCalled();
  });

  it('迭代抛错也会复位运行标志', async () => {
    const { service, tenantIteration } = build(['default']);
    tenantIteration.forEachTenant.mockRejectedValueOnce(new Error('boom'));
    await service.handleWorkflowHistoryCleanup();
    expect((service as any).workflowHistoryCleanupRunning).toBe(false);
  });
});
