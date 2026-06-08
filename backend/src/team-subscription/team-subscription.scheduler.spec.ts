import { TeamSubscriptionScheduler } from './team-subscription.scheduler';
import { PrismaService } from '../prisma/prisma.service';
import { TenantIterationService } from '../tenancy/tenant-iteration.service';
import { TeamSubscriptionService } from './team-subscription.service';

describe('TeamSubscriptionScheduler.handleRenewal（H2 跨租户）', () => {
  it('把续期逻辑包进 forEachTenant 逐租户执行', async () => {
    const tenantIds = ['t_acme', 'default'];
    const tenantIteration = {
      forEachTenant: jest.fn(async (fn: (id: string) => any) => {
        for (const id of tenantIds) await fn(id);
      }),
    } as unknown as TenantIterationService;

    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { teamSubscription: { findMany } } as unknown as PrismaService;
    const subService = { renewSubscription: jest.fn() } as unknown as TeamSubscriptionService;

    const scheduler = new TeamSubscriptionScheduler(prisma, tenantIteration, subService);

    await scheduler.handleRenewal();

    expect(tenantIteration.forEachTenant).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(tenantIds.length);
  });

  it('每个到期订阅都调 renewSubscription', async () => {
    const tenantIteration = {
      forEachTenant: jest.fn(async (fn: (id: string) => any) => {
        await fn('default');
      }),
    } as unknown as TenantIterationService;

    const due = [
      { id: 'sub_1', teamId: 'team_1', creditsPerRenewal: 100, billingCycle: 'monthly' },
      { id: 'sub_2', teamId: 'team_2', creditsPerRenewal: 200, billingCycle: 'annual' },
    ];
    const prisma = {
      teamSubscription: { findMany: jest.fn().mockResolvedValue(due) },
    } as unknown as PrismaService;
    const renewSubscription = jest.fn().mockResolvedValue(undefined);
    const subService = { renewSubscription } as unknown as TeamSubscriptionService;

    const scheduler = new TeamSubscriptionScheduler(prisma, tenantIteration, subService);

    await scheduler.handleRenewal();

    expect(renewSubscription).toHaveBeenCalledTimes(2);
    expect(renewSubscription).toHaveBeenCalledWith(due[0]);
    expect(renewSubscription).toHaveBeenCalledWith(due[1]);
  });

  it('running 重入保护：第二次并发调用直接返回，不再迭代租户', async () => {
    let resolveOuter: () => void = () => undefined;
    const gate = new Promise<void>((r) => (resolveOuter = r));
    const tenantIteration = {
      forEachTenant: jest.fn(async (fn: (id: string) => any) => {
        await gate; // 阻塞，模拟首次调用尚未完成
        await fn('default');
      }),
    } as unknown as TenantIterationService;

    const prisma = {
      teamSubscription: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const subService = { renewSubscription: jest.fn() } as unknown as TeamSubscriptionService;

    const scheduler = new TeamSubscriptionScheduler(prisma, tenantIteration, subService);

    const first = scheduler.handleRenewal();
    await scheduler.handleRenewal(); // 第二次：running=true，直接返回
    resolveOuter();
    await first;

    expect(tenantIteration.forEachTenant).toHaveBeenCalledTimes(1);
  });
});
