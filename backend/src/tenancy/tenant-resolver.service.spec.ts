import { NotFoundException } from '@nestjs/common';
import { TenantResolverService } from './tenant-resolver.service';

function make(config: Record<string, any>, domainRow: any = null) {
  const prisma = { tenantDomain: { findUnique: jest.fn().mockResolvedValue(domainRow) } } as any;
  const cfg = { get: (k: string) => config[k] } as any;
  return { svc: new TenantResolverService(prisma, cfg), prisma };
}

describe('TenantResolverService', () => {
  it('已登记域名 → 返回对应 tenantId', async () => {
    const { svc } = make({}, { tenantId: 't_acme' });
    await expect(svc.resolve({ headers: { host: 'acme.tanva.com' } })).resolves.toBe('t_acme');
  });

  it('未知域名严格模式抛 404', async () => {
    const { svc } = make({ TENANT_STRICT_HOST: 'true' });
    await expect(svc.resolve({ headers: { host: 'evil.com' } })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('未知域名默认兜底主站（非破坏性）', async () => {
    const { svc } = make({});
    await expect(svc.resolve({ headers: { host: 'evil.com' } })).resolves.toBe('default');
  });

  it('缺失 host 默认兜底主站', async () => {
    const { svc } = make({});
    await expect(svc.resolve({ headers: {} })).resolves.toBe('default');
  });

  it('缓存命中不再查库', async () => {
    const { svc, prisma } = make({}, { tenantId: 't_acme' });
    await svc.resolve({ headers: { host: 'acme.tanva.com' } });
    await svc.resolve({ headers: { host: 'acme.tanva.com' } });
    expect(prisma.tenantDomain.findUnique).toHaveBeenCalledTimes(1);
  });
});
