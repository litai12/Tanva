import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  isSecretCryptoReady,
} from './secret-crypto';

// 32 字节 base64 主密钥
const KEY = Buffer.alloc(32, 7).toString('base64');

describe('secret-crypto', () => {
  const original = process.env.TENANT_SECRET_KEY;
  const originalJwtR = process.env.JWT_REFRESH_SECRET;
  const originalJwtA = process.env.JWT_ACCESS_SECRET;
  beforeEach(() => {
    process.env.TENANT_SECRET_KEY = KEY;
    // 隔离派生来源，避免测试机环境里的 JWT 密钥干扰 fail-closed 用例
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.JWT_ACCESS_SECRET;
  });
  const restore = (k: string, v: string | undefined) =>
    v === undefined ? delete process.env[k] : (process.env[k] = v);
  afterAll(() => {
    restore('TENANT_SECRET_KEY', original);
    restore('JWT_REFRESH_SECRET', originalJwtR);
    restore('JWT_ACCESS_SECRET', originalJwtA);
  });

  it('加解密往返一致', () => {
    const plain = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----';
    const enc = encryptSecret(plain);
    expect(enc).toBeTruthy();
    expect(isEncrypted(enc!)).toBe(true);
    expect(enc).not.toContain('ABC'); // 密文不含明文
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('密文带版本前缀 v1: 且为四段', () => {
    const enc = encryptSecret('hello')!;
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc.split(':')).toHaveLength(4);
  });

  it('每次加密 IV 随机：相同明文产出不同密文，但都能解回', () => {
    const a = encryptSecret('same')!;
    const b = encryptSecret('same')!;
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same');
    expect(decryptSecret(b)).toBe('same');
  });

  it('空串/undefined 视为清除 → null', () => {
    expect(encryptSecret('')).toBeNull();
    expect(encryptSecret(undefined)).toBeNull();
    expect(encryptSecret(null)).toBeNull();
  });

  it('幂等：已是密文不再二次加密', () => {
    const enc = encryptSecret('x')!;
    expect(encryptSecret(enc)).toBe(enc);
  });

  it('解密历史明文（无版本前缀）原样返回，便于平滑迁移', () => {
    expect(decryptSecret('legacy-plaintext')).toBe('legacy-plaintext');
  });

  it('fail-closed：无主密钥且无 JWT 派生来源时加密抛错（绝不明文落库）', () => {
    delete process.env.TENANT_SECRET_KEY;
    // beforeEach 已清掉 JWT_*，此处无任何派生来源
    expect(isSecretCryptoReady()).toBe(false);
    expect(() => encryptSecret('secret')).toThrow();
  });

  it('无显式 TENANT_SECRET_KEY 但有 JWT_REFRESH_SECRET → 派生主密钥，加解密可用', () => {
    delete process.env.TENANT_SECRET_KEY;
    process.env.JWT_REFRESH_SECRET = 'some-high-entropy-refresh-secret';
    expect(isSecretCryptoReady()).toBe(true);
    const enc = encryptSecret('mch-private-key')!;
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptSecret(enc)).toBe('mch-private-key');
  });

  it('派生稳定：同一 JWT_REFRESH_SECRET 解得回；换了则解不开', () => {
    delete process.env.TENANT_SECRET_KEY;
    process.env.JWT_REFRESH_SECRET = 'refresh-A';
    const enc = encryptSecret('x')!;
    expect(decryptSecret(enc)).toBe('x');
    process.env.JWT_REFRESH_SECRET = 'refresh-B';
    expect(() => decryptSecret(enc)).toThrow(); // 不同派生密钥 → GCM 校验失败
  });

  it('主密钥长度非法时抛错', () => {
    process.env.TENANT_SECRET_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => encryptSecret('secret')).toThrow();
  });

  it('密文被篡改 → 解密抛错（GCM 认证）', () => {
    const enc = encryptSecret('tamper-me')!;
    const parts = enc.split(':');
    // 翻转密文最后一个字符
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] = ct[0] ^ 0xff;
    parts[3] = ct.toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });
});
