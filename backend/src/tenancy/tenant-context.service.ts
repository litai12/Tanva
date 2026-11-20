import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CLS_PLATFORM_MODE_KEY, CLS_TENANT_KEY, PLATFORM_TENANT_ID } from './tenant.constants';

@Injectable()
export class TenantContextService {
  constructor(private readonly cls: ClsService) {}

  getTenantId(): string {
    return this.cls.get(CLS_TENANT_KEY) ?? PLATFORM_TENANT_ID;
  }
  setTenantId(tenantId: string): void {
    this.cls.set(CLS_TENANT_KEY, tenantId);
  }
  isPlatformMode(): boolean {
    return this.cls.get(CLS_PLATFORM_MODE_KEY) === true;
  }
  async runAsTenant<T>(tenantId: string, fn: () => Promise<T> | T): Promise<T> {
    return this.cls.run(async () => {
      this.cls.set(CLS_TENANT_KEY, tenantId);
      this.cls.set(CLS_PLATFORM_MODE_KEY, false);
      return fn();
    });
  }
  async runAsPlatform<T>(fn: () => Promise<T> | T): Promise<T> {
    return this.cls.run(async () => {
      this.cls.set(CLS_PLATFORM_MODE_KEY, true);
      return fn();
    });
  }
}
