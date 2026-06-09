import { TenantPaymentResolver } from './tenant-payment-resolver.service';

/**
 * 只测解析/回落/缓存逻辑：stub 掉真实 SDK 构建（buildAlipay/buildWechat），
 * 避免用假密钥构造真实 alipay-sdk / wechatpay-node-v3。
 * 租户列用明文（decryptSecret 对无版本前缀原样返回，无需主密钥）。
 */
describe('TenantPaymentResolver', () => {
  const ENV: Record<string, string> = {
    ALIPAY_APP_ID: 'plat-ali-app',
    ALIPAY_PRIVATE_KEY: 'plat-ali-priv',
    ALIPAY_PUBLIC_KEY: 'plat-ali-pub',
    WECHAT_APP_ID: 'plat-wx-app',
    WECHAT_MCH_ID: 'plat-wx-mch',
    WECHAT_PRIVATE_KEY: 'plat-wx-priv',
    WECHAT_CERTIFICATE: 'plat-wx-cert',
    WECHAT_SERIAL_NO: 'plat-wx-serial',
    WECHAT_API_V3_KEY: 'plat-wx-v3',
  };

  function build(opts: {
    cls: string | null;
    tenantRow?: Record<string, any> | null;
  }) {
    const findUnique = jest.fn().mockResolvedValue(opts.tenantRow ?? null);
    const prisma = { tenant: { findUnique } } as any;
    const configService = { get: (k: string) => ENV[k] } as any;
    const tenantContext = { getTenantId: () => opts.cls } as any;
    const resolver = new TenantPaymentResolver(prisma, configService, tenantContext);

    // stub 真实 SDK 构建：sdk 仅在关键字段齐备时为非空 marker
    (resolver as any).buildAlipay = (cfg: any, label: string) => ({
      sdk: cfg.alipayAppId && cfg.alipayPrivateKey ? `alipay:${label}` : null,
      appId: cfg.alipayAppId ?? null,
    });
    (resolver as any).buildWechat = (cfg: any, label: string) => ({
      sdk: cfg.wechatMchId && cfg.wechatPrivateKey ? `wechat:${label}` : null,
      appId: cfg.wechatAppId ?? null,
      mchId: cfg.wechatMchId ?? null,
      apiV3Key: cfg.wechatApiV3Key ?? null,
    });
    return { resolver, findUnique };
  }

  it('主站(default)：两渠道都用平台 env', async () => {
    const { resolver, findUnique } = build({ cls: 'default' });
    const ctx = await resolver.resolve();
    expect(ctx.alipaySdk).toBe('alipay:platform');
    expect(ctx.wechatPay).toBe('wechat:platform');
    expect(ctx.source).toEqual({ alipay: 'platform', wechat: 'platform' });
    expect(findUnique).not.toHaveBeenCalled(); // default 不查租户表
  });

  it('CLS 为空：回落平台', async () => {
    const { resolver } = build({ cls: null });
    const ctx = await resolver.resolve();
    expect(ctx.source.alipay).toBe('platform');
    expect(ctx.source.wechat).toBe('platform');
  });

  it('子租户两渠道都配置：都用租户自己的', async () => {
    const { resolver } = build({
      cls: 't_acme',
      tenantRow: {
        alipayAppId: 'acme-ali', alipayPrivateKeyEnc: 'acme-ali-priv', alipayPublicKeyEnc: 'acme-ali-pub',
        wechatAppId: 'acme-wx', wechatMchId: 'acme-mch', wechatPrivateKeyEnc: 'acme-wx-priv',
        wechatCertificateEnc: 'acme-cert', wechatSerialNo: 'acme-serial', wechatApiV3KeyEnc: 'acme-v3',
      },
    });
    const ctx = await resolver.resolve();
    expect(ctx.alipaySdk).toBe('alipay:tenant:t_acme');
    expect(ctx.wechatPay).toBe('wechat:tenant:t_acme');
    expect(ctx.wechatApiV3Key).toBe('acme-v3');
    expect(ctx.source).toEqual({ alipay: 'tenant', wechat: 'tenant' });
  });

  it('逐渠道回落：子租户只配微信，支付宝回落平台', async () => {
    const { resolver } = build({
      cls: 't_acme',
      tenantRow: {
        // 仅微信齐备
        wechatAppId: 'acme-wx', wechatMchId: 'acme-mch', wechatPrivateKeyEnc: 'acme-wx-priv',
        wechatCertificateEnc: 'acme-cert', wechatApiV3KeyEnc: 'acme-v3',
        // 支付宝缺私钥 → 该渠道回落平台
        alipayAppId: 'acme-ali',
      },
    });
    const ctx = await resolver.resolve();
    expect(ctx.wechatPay).toBe('wechat:tenant:t_acme');
    expect(ctx.source.wechat).toBe('tenant');
    expect(ctx.alipaySdk).toBe('alipay:platform');
    expect(ctx.source.alipay).toBe('platform');
  });

  it('子租户无任何配置：两渠道都回落平台', async () => {
    const { resolver } = build({ cls: 't_empty', tenantRow: {} });
    const ctx = await resolver.resolve();
    expect(ctx.source).toEqual({ alipay: 'platform', wechat: 'platform' });
    expect(ctx.alipaySdk).toBe('alipay:platform');
  });

  it('explicitTenantId 覆盖 CLS（回调路径用）', async () => {
    const { resolver, findUnique } = build({
      cls: 'default',
      tenantRow: {
        wechatAppId: 'acme-wx', wechatMchId: 'acme-mch', wechatPrivateKeyEnc: 'acme-wx-priv',
        wechatCertificateEnc: 'acme-cert', wechatApiV3KeyEnc: 'acme-v3',
      },
    });
    const ctx = await resolver.resolve('t_acme');
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't_acme' } }));
    expect(ctx.wechatPay).toBe('wechat:tenant:t_acme');
  });

  it('fail-closed：租户已配商户但密文解密抛错(主密钥缺失) → 该渠道 sdk=null 且不回落平台', async () => {
    const saved = process.env.TENANT_SECRET_KEY;
    delete process.env.TENANT_SECRET_KEY; // 让 decryptSecret 对 v1: 密文抛错
    try {
      const { resolver } = build({
        cls: 't_acme',
        tenantRow: {
          // 看起来是已加密的密文（v1: 前缀）→ 无主密钥时 decryptSecret 抛错
          alipayAppId: 'acme-ali',
          alipayPrivateKeyEnc: 'v1:aaa:bbb:ccc',
          wechatMchId: 'acme-mch',
          wechatPrivateKeyEnc: 'v1:aaa:bbb:ccc',
          wechatCertificateEnc: 'v1:aaa:bbb:ccc',
        },
      });
      const ctx = await resolver.resolve();
      // 关键：不能回落平台（否则用错商户静默漏单），应 fail-closed
      expect(ctx.alipaySdk).toBeNull();
      expect(ctx.wechatPay).toBeNull();
      expect(ctx.source).toEqual({ alipay: 'error', wechat: 'error' });
    } finally {
      if (saved === undefined) delete process.env.TENANT_SECRET_KEY;
      else process.env.TENANT_SECRET_KEY = saved;
    }
  });

  it('缓存：TTL 内只查一次；invalidate 后重查', async () => {
    const { resolver, findUnique } = build({
      cls: 't_acme',
      tenantRow: {
        wechatAppId: 'a', wechatMchId: 'm', wechatPrivateKeyEnc: 'p', wechatCertificateEnc: 'c',
      },
    });
    await resolver.resolve();
    await resolver.resolve();
    expect(findUnique).toHaveBeenCalledTimes(1);
    resolver.invalidate('t_acme');
    await resolver.resolve();
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
