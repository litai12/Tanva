import { TeamCreditLedgerService } from './team-credit-ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantIterationService } from '../tenancy/tenant-iteration.service';

describe('TeamCreditLedgerService.releaseExpiredReserves（H2 跨租户）', () => {
  it('把过期 reserve 释放逻辑包进 forEachTenant 逐租户执行', async () => {
    // forEachTenant 模拟两个 active 租户，依次在各自 CLS 内执行闭包
    const tenantIds = ['t_acme', 'default'];
    const tenantIteration = {
      forEachTenant: jest.fn(async (fn: (id: string) => any) => {
        for (const id of tenantIds) await fn(id);
      }),
    } as unknown as TenantIterationService;

    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      teamCreditLedger: { findMany, findFirst: jest.fn() },
    } as unknown as PrismaService;

    const svc = new TeamCreditLedgerService(prisma, tenantIteration);

    await svc.releaseExpiredReserves();

    expect(tenantIteration.forEachTenant).toHaveBeenCalledTimes(1);
    // 每个租户都各自跑一次入口扫描（被扩展限定到本租户）
    expect(findMany).toHaveBeenCalledTimes(tenantIds.length);
  });

  it('过期且未结算的 reserve 调用 release；已结算的跳过', async () => {
    // 单租户（回归安全）
    const tenantIteration = {
      forEachTenant: jest.fn(async (fn: (id: string) => any) => {
        await fn('default');
      }),
    } as unknown as TenantIterationService;

    const expired = [
      { teamAccId: 'acc_1', taskId: 'task_unsettled', amount: 10, account: { teamId: 'team_1' } },
      { teamAccId: 'acc_2', taskId: 'task_settled', amount: 20, account: { teamId: 'team_2' } },
    ];
    const findMany = jest.fn().mockResolvedValue(expired);
    const findFirst = jest.fn(async (args: any) => {
      // task_settled 已有 deduct/release 记录
      if (args.where.taskId === 'task_settled') return { id: 'ledger_x' };
      return null;
    });
    const prisma = {
      teamCreditLedger: { findMany, findFirst },
    } as unknown as PrismaService;

    const svc = new TeamCreditLedgerService(prisma, tenantIteration);
    const releaseSpy = jest.spyOn(svc, 'release').mockResolvedValue(undefined);

    await svc.releaseExpiredReserves();

    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(releaseSpy).toHaveBeenCalledWith({
      teamId: 'team_1',
      amount: 10,
      taskId: 'task_unsettled',
    });
  });
});
