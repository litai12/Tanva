import { ClsService } from 'nestjs-cls';
import { TenantContextService } from './tenant-context.service';
import { PLATFORM_TENANT_ID } from './tenant.constants';

function makeCls(): ClsService {
  const store = new Map<string, any>();
  return {
    get: (k: string) => store.get(k),
    set: (k: string, v: any) => store.set(k, v),
    run: (cb: any) => cb(),
    isActive: () => true,
  } as unknown as ClsService;
}

describe('TenantContextService', () => {
  it('getTenantId 默认回落主站', () => {
    const svc = new TenantContextService(makeCls());
    expect(svc.getTenantId()).toBe(PLATFORM_TENANT_ID);
  });
  it('runAsTenant 内部 getTenantId 返回指定租户', async () => {
    const svc = new TenantContextService(makeCls());
    await svc.runAsTenant('t_acme', async () => {
      expect(svc.getTenantId()).toBe('t_acme');
    });
  });
  it('runAsPlatform 内部进入平台态', async () => {
    const svc = new TenantContextService(makeCls());
    await svc.runAsPlatform(async () => {
      expect(svc.isPlatformMode()).toBe(true);
    });
  });
});
