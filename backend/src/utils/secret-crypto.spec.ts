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
  beforeEach(() => {
    process.env.TENANT_SECRET_KEY = KEY;
  });
  afterAll(() => {
    if (original === undefined) delete process.env.TENANT_SECRET_KEY;
    else process.env.TENANT_SECRET_KEY = original;
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

  it('fail-closed：无主密钥时加密抛错（绝不明文落库）', () => {
    delete process.env.TENANT_SECRET_KEY;
    expect(isSecretCryptoReady()).toBe(false);
    expect(() => encryptSecret('secret')).toThrow();
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
