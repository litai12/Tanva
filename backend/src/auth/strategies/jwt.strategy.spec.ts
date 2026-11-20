import { JwtStrategy } from './jwt.strategy';

function makeStrategy(currentTenant: string, user: any) {
  const config = { get: () => 'secret' } as any;
  const usersService = {
    findById: jest.fn().mockResolvedValue(user),
    touchLastLoginAt: jest.fn().mockResolvedValue(undefined),
  } as any;
  const tenantContext = { getTenantId: () => currentTenant } as any;
  return new JwtStrategy(config, usersService, tenantContext);
}

describe('JwtStrategy tenant binding', () => {
  it('token 租户与当前 Host 租户一致 → 通过', async () => {
    const s = makeStrategy('t_a', { id: 'u1', email: 'e', name: 'n', phone: 'p', role: 'user', tenantId: 't_a' });
    const res = await s.validate({ sub: 'u1', tenantId: 't_a' });
    expect(res).not.toBeNull();
    expect(res!.tenantId).toBe('t_a');
  });

  it('token 租户 ≠ 当前 Host 租户 → 拒绝(null)', async () => {
    const s = makeStrategy('t_a', { id: 'u1', tenantId: 't_a' });
    const res = await s.validate({ sub: 'u1', tenantId: 't_b' });
    expect(res).toBeNull();
  });

  it('用户不存在 → null', async () => {
    const s = makeStrategy('t_a', null);
    const res = await s.validate({ sub: 'u1', tenantId: 't_a' });
    expect(res).toBeNull();
  });
});
