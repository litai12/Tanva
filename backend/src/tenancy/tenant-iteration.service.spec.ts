import { TenantIterationService } from './tenant-iteration.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from './tenant-context.service';

function makePrisma(tenantRows: Array<{ id: string }>): PrismaService {
  return {
    tenant: {
      findMany: jest.fn().mockResolvedValue(tenantRows),
    },
  } as unknown as PrismaService;
}

function makeTenantContext(): TenantContextService {
  return {
    runAsPlatform: jest.fn((fn: () => any) => Promise.resolve(fn())),
    runAsTenant: jest.fn((_id: string, fn: () => any) => Promise.resolve(fn())),
  } as unknown as TenantContextService;
}

describe('TenantIterationService', () => {
  it('listActiveTenantIds 在平台态下查 active 租户并返回 id 数组', async () => {
    const prisma = makePrisma([{ id: 't_acme' }, { id: 'default' }]);
    const ctx = makeTenantContext();
    const svc = new TenantIterationService(prisma, ctx);

    const ids = await svc.listActiveTenantIds();

    expect(ids).toEqual(['t_acme', 'default']);
    expect(ctx.runAsPlatform).toHaveBeenCalledTimes(1);
    expect((prisma as any).tenant.findMany).toHaveBeenCalledWith({
      where: { status: 'active' },
      select: { id: true },
    });
  });

  it('forEachTenant 对每个 id 都调 runAsTenant 并执行 fn', async () => {
    const prisma = makePrisma([{ id: 't_acme' }, { id: 'default' }]);
    const ctx = makeTenantContext();
    const svc = new TenantIterationService(prisma, ctx);

    const seen: string[] = [];
    await svc.forEachTenant((tenantId) => {
      seen.push(tenantId);
    });

    expect(seen).toEqual(['t_acme', 'default']);
    expect(ctx.runAsTenant).toHaveBeenCalledTimes(2);
    expect((ctx.runAsTenant as jest.Mock).mock.calls[0][0]).toBe('t_acme');
    expect((ctx.runAsTenant as jest.Mock).mock.calls[1][0]).toBe('default');
  });

  it('单个租户抛错不影响其它租户', async () => {
    const prisma = makePrisma([{ id: 't_bad' }, { id: 't_good' }]);
    const ctx = makeTenantContext();
    const svc = new TenantIterationService(prisma, ctx);

    // 屏蔽 logger 噪音
    jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);

    const seen: string[] = [];
    await svc.forEachTenant((tenantId) => {
      if (tenantId === 't_bad') {
        throw new Error('boom');
      }
      seen.push(tenantId);
    });

    // t_bad 抛错被吞，t_good 仍被处理
    expect(seen).toEqual(['t_good']);
    expect(ctx.runAsTenant).toHaveBeenCalledTimes(2);
  });

  it('只有 default 一个 active 租户时只迭代一次（回归安全）', async () => {
    const prisma = makePrisma([{ id: 'default' }]);
    const ctx = makeTenantContext();
    const svc = new TenantIterationService(prisma, ctx);

    let runs = 0;
    await svc.forEachTenant(() => {
      runs += 1;
    });

    expect(runs).toBe(1);
    expect(ctx.runAsTenant).toHaveBeenCalledTimes(1);
    expect((ctx.runAsTenant as jest.Mock).mock.calls[0][0]).toBe('default');
  });
});
