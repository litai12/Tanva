import { TeamCoreService } from './team-core.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';

function makeTenantContext(tenantId: string): TenantContextService {
  return {
    getTenantId: jest.fn(() => tenantId),
  } as unknown as TenantContextService;
}

describe('TeamCoreService 嵌套写归属（H4）', () => {
  it('createPersonalTeam 给嵌套的 membership / creditAccount 显式补当前租户 tenantId', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'team_1' });
    const prisma = { team: { create } } as unknown as PrismaService;
    const ctx = makeTenantContext('t_acme');
    const svc = new TeamCoreService(prisma, ctx);

    await svc.createPersonalTeam('user_1');

    expect(ctx.getTenantId).toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.memberships.create).toEqual({
      userId: 'user_1',
      role: 'owner',
      tenantId: 't_acme',
    });
    expect(data.creditAccount.create).toEqual({ tenantId: 't_acme' });
  });

  it('createTeam 给嵌套的 membership / creditAccount 显式补当前租户 tenantId', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'team_2' });
    const prisma = { team: { create } } as unknown as PrismaService;
    const ctx = makeTenantContext('t_acme');
    const svc = new TeamCoreService(prisma, ctx);

    await svc.createTeam('user_1', { name: '设计部' } as any);

    const data = create.mock.calls[0][0].data;
    expect(data.memberships.create).toEqual({
      userId: 'user_1',
      role: 'owner',
      tenantId: 't_acme',
    });
    expect(data.creditAccount.create).toEqual({ tenantId: 't_acme' });
  });

  it('回归安全：default 租户下嵌套写补 tenantId=default（与原默认值一致）', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'team_3' });
    const prisma = { team: { create } } as unknown as PrismaService;
    const ctx = makeTenantContext('default');
    const svc = new TeamCoreService(prisma, ctx);

    await svc.createPersonalTeam('user_1');

    const data = create.mock.calls[0][0].data;
    expect(data.memberships.create.tenantId).toBe('default');
    expect(data.creditAccount.create.tenantId).toBe('default');
  });

  it('createPersonalTeam 传入 tx 时使用 tx.team.create', async () => {
    const txCreate = jest.fn().mockResolvedValue({ id: 'team_tx' });
    const tx = { team: { create: txCreate } };
    const prismaCreate = jest.fn();
    const prisma = { team: { create: prismaCreate } } as unknown as PrismaService;
    const ctx = makeTenantContext('t_acme');
    const svc = new TeamCoreService(prisma, ctx);

    await svc.createPersonalTeam('user_1', tx);

    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(prismaCreate).not.toHaveBeenCalled();
    expect(txCreate.mock.calls[0][0].data.memberships.create.tenantId).toBe('t_acme');
  });
});
