import { normalizeHost } from './host.util';

describe('normalizeHost', () => {
  it('lowercase + 去端口 + 去尾点', () => {
    expect(normalizeHost('ACME.Tanva.com:8080.')).toBe('acme.tanva.com');
  });
  it('空值返回 null', () => {
    expect(normalizeHost(undefined)).toBeNull();
    expect(normalizeHost('')).toBeNull();
    expect(normalizeHost('   ')).toBeNull();
  });
  it('逗号分隔取第一个', () => {
    expect(normalizeHost('acme.tanva.com, proxy.internal')).toBe('acme.tanva.com');
  });
  it('punycode 化国际化域名', () => {
    expect(normalizeHost('例子.com')).toMatch(/^xn--/);
  });
});
