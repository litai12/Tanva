import { ForbiddenException } from '@nestjs/common';
import { assertSameTenant } from './assert-same-tenant';

describe('assertSameTenant', () => {
  it('同租户通过', () => {
    expect(() => assertSameTenant('t_a', { tenantId: 't_a' }, 'team')).not.toThrow();
  });
  it('异租户拒绝', () => {
    expect(() => assertSameTenant('t_a', { tenantId: 't_b' }, 'team')).toThrow(ForbiddenException);
  });
  it('null 拒绝', () => {
    expect(() => assertSameTenant('t_a', null, 'project')).toThrow(ForbiddenException);
  });
});
