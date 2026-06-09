import { buildTenantArgs } from './tenant-prisma.extension';

describe('buildTenantArgs', () => {
  const ctx = { tenantId: 't_acme', isPlatform: false };

  it('findMany 注入 where.tenantId', () => {
    const out = buildTenantArgs('Project', 'findMany', { where: { userId: 'u1' } }, ctx);
    expect(out.where).toEqual({ userId: 'u1', tenantId: 't_acme' });
  });

  it('findUnique 注入 where.tenantId（Prisma5 extended-where-unique 允许）', () => {
    const out = buildTenantArgs('User', 'findUnique', { where: { id: 'x' } }, ctx);
    expect(out.where).toEqual({ id: 'x', tenantId: 't_acme' });
  });

  it('create 注入 data.tenantId', () => {
    const out = buildTenantArgs('Project', 'create', { data: { name: 'p' } }, ctx);
    expect(out.data.tenantId).toBe('t_acme');
  });

  it('createMany 数组每条都注入', () => {
    const out = buildTenantArgs('Project', 'createMany', { data: [{ name: 'a' }, { name: 'b' }] }, ctx);
    expect(out.data.every((d: any) => d.tenantId === 't_acme')).toBe(true);
  });

  it('upsert 三处都注入', () => {
    const out = buildTenantArgs(
      'Project',
      'upsert',
      { where: { id: 'x' }, create: { name: 'p' }, update: { name: 'q' } },
      ctx,
    );
    expect(out.where.tenantId).toBe('t_acme');
    expect(out.create.tenantId).toBe('t_acme');
    expect(out.update.tenantId).toBe('t_acme');
  });

  it('deleteMany / updateMany 注入 where', () => {
    expect(buildTenantArgs('Project', 'deleteMany', {}, ctx).where.tenantId).toBe('t_acme');
    expect(buildTenantArgs('Project', 'updateMany', { where: { id: 'x' } }, ctx).where.tenantId).toBe('t_acme');
  });

  it('白名单 model 不注入', () => {
    const out = buildTenantArgs('MembershipPlan', 'findMany', { where: {} }, ctx);
    expect(out.where.tenantId).toBeUndefined();
  });

  it('平台态不注入', () => {
    const out = buildTenantArgs('Project', 'findMany', { where: {} }, {
      tenantId: 't_acme',
      isPlatform: true,
    });
    expect(out.where.tenantId).toBeUndefined();
  });
});
