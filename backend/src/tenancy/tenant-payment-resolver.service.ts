import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from './tenant-context.service';
import { PLATFORM_TENANT_ID } from './tenant.constants';
import { decryptSecret } from '../utils/secret-crypto';

// 与 payment.service 一致的兼容引用
const alipayLib = require('alipay-sdk');
const AlipaySdk = alipayLib.default || alipayLib.AlipaySdk || alipayLib;
const WeChatPay = require('wechatpay-node-v3');

/** 解析后的支付上下文：按当前/指定租户得到的 SDK 与商户标识。 */
export interface ResolvedPaymentCtx {
  alipaySdk: any | null;
  alipayAppId: string | null;
  wechatPay: any | null;
  wechatApiV3Key: string | null;
  wechatAppId: string | null;
  wechatMchId: string | null;
  /** 各渠道来源，便于日志/排障 */
  source: { alipay: 'tenant' | 'platform' | 'none'; wechat: 'tenant' | 'platform' | 'none' };
}

interface AlipayChannel {
  sdk: any | null;
  appId: string | null;
}
interface WechatChannel {
  sdk: any | null;
  appId: string | null;
  mchId: string | null;
  apiV3Key: string | null;
}

/** 原始（未格式化）支付凭证，用于构建 SDK。 */
interface RawPaymentConfig {
  // alipay
  alipayAppId?: string | null;
  alipayPrivateKey?: string | null;
  alipayPublicKey?: string | null;
  // wechat
  wechatAppId?: string | null;
  wechatMchId?: string | null;
  wechatSerialNo?: string | null;
  wechatPrivateKey?: string | null;
  wechatCertificate?: string | null;
  wechatApiV3Key?: string | null;
}

/**
 * 按当前请求租户解析支付 SDK（微信/支付宝）。
 * - 主站(default) 或某渠道未配置 → 回落平台 env（逐渠道回落，"默认使用主站的"）。
 * - 子租户配了某渠道 → 用租户自己的商户号/证书（实现各子站独立收款）。
 *
 * 密文字段（私钥/证书/APIv3 key）经 utils/secret-crypto 解密后才构建 SDK。
 * Tenant 属全局白名单表，普通 prisma 读取即可跨租户。
 */
@Injectable()
export class TenantPaymentResolver {
  private readonly logger = new Logger(TenantPaymentResolver.name);

  // 平台 ctx：从 env 构建一次（运行时 env 不变），lazy 缓存
  private platformCache: { alipay: AlipayChannel; wechat: WechatChannel } | null = null;

  // 租户 ctx：带 TTL 的进程内缓存；admin 改配置会主动失效；多进程靠 TTL 兜底
  private tenantCache = new Map<
    string,
    { alipay: AlipayChannel; wechat: WechatChannel; expireAt: number }
  >();
  private readonly ttlMs = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** 租户支付配置变更后调用，清本实例缓存 */
  invalidate(tenantId?: string) {
    if (tenantId) this.tenantCache.delete(tenantId);
    else this.tenantCache.clear();
  }

  private now(): number {
    // 避免直接用 Date.now()（与项目其它 resolver 一致，用单调时间）
    return Number(process.hrtime.bigint() / 1_000_000n);
  }

  // ---- key 格式化（与 payment.service.formatKey 等价）----
  private formatKey(key: string, type: 'PRIVATE' | 'PUBLIC'): string {
    if (!key) return '';
    const content = key
      .replace(/-----BEGIN.*?-----/g, '')
      .replace(/-----END.*?-----/g, '')
      .replace(/\\n/g, '')
      .replace(/[\s"']/g, '');
    const chunked = content.match(/.{1,64}/g)?.join('\n');
    let header: string;
    let footer: string;
    if (type === 'PRIVATE') {
      if (key.includes('-----BEGIN PRIVATE KEY-----')) {
        header = '-----BEGIN PRIVATE KEY-----';
        footer = '-----END PRIVATE KEY-----';
      } else {
        header = '-----BEGIN RSA PRIVATE KEY-----';
        footer = '-----END RSA PRIVATE KEY-----';
      }
    } else {
      header = '-----BEGIN PUBLIC KEY-----';
      footer = '-----END PUBLIC KEY-----';
    }
    return `${header}\n${chunked}\n${footer}`;
  }

  // ---- SDK 构建（逻辑复刻 payment.service.onModuleInit）----
  private buildAlipay(cfg: RawPaymentConfig, label: string): AlipayChannel {
    const appId = cfg.alipayAppId?.trim() || null;
    let privateKey = cfg.alipayPrivateKey || '';
    let alipayPublicKey = cfg.alipayPublicKey || '';
    if (!appId || !privateKey) return { sdk: null, appId: null };
    try {
      privateKey = this.formatKey(privateKey, 'PRIVATE');
      if (alipayPublicKey) alipayPublicKey = this.formatKey(alipayPublicKey, 'PUBLIC');
      const sdk = new AlipaySdk({
        appId,
        privateKey,
        alipayPublicKey: alipayPublicKey || undefined,
        signType: 'RSA2',
      });
      return { sdk, appId };
    } catch (error) {
      this.logger.error(`[${label}] 支付宝 SDK 构建失败: ${error instanceof Error ? error.message : String(error)}`);
      return { sdk: null, appId: null };
    }
  }

  private buildWechat(cfg: RawPaymentConfig, label: string): WechatChannel {
    const appId = cfg.wechatAppId?.trim() || null;
    const mchId = cfg.wechatMchId?.trim() || null;
    const privateKey = cfg.wechatPrivateKey || '';
    const apiV3Key = cfg.wechatApiV3Key?.trim() || null;
    const certificate = cfg.wechatCertificate || '';
    const serialNo = cfg.wechatSerialNo?.trim() || '';
    if (!appId || !mchId || !privateKey) {
      return { sdk: null, appId: null, mchId: null, apiV3Key: null };
    }
    try {
      let formattedPrivateKey = privateKey;
      if (privateKey && !privateKey.includes('-----BEGIN')) {
        formattedPrivateKey = this.formatKey(privateKey, 'PRIVATE');
      }
      let sdk: any;
      if (serialNo && certificate) {
        sdk = new WeChatPay({
          appid: appId,
          mchid: mchId,
          privateKey: formattedPrivateKey,
          publicKey: certificate,
          serial_no: serialNo,
          ...(apiV3Key ? { key: apiV3Key } : {}),
        });
      } else if (certificate) {
        sdk = new WeChatPay({
          appid: appId,
          mchid: mchId,
          privateKey: formattedPrivateKey,
          publicKey: certificate,
          ...(apiV3Key ? { key: apiV3Key } : {}),
        });
      } else {
        this.logger.warn(`[${label}] 微信支付缺少商户证书，跳过构建`);
        return { sdk: null, appId: null, mchId: null, apiV3Key: null };
      }
      return { sdk, appId, mchId, apiV3Key };
    } catch (error) {
      this.logger.error(`[${label}] 微信支付 SDK 构建失败: ${error instanceof Error ? error.message : String(error)}`);
      return { sdk: null, appId: null, mchId: null, apiV3Key: null };
    }
  }

  // ---- 平台（env）ctx ----
  private getPlatform(): { alipay: AlipayChannel; wechat: WechatChannel } {
    if (this.platformCache) return this.platformCache;
    const cfg: RawPaymentConfig = {
      alipayAppId: this.configService.get<string>('ALIPAY_APP_ID'),
      alipayPrivateKey: this.configService.get<string>('ALIPAY_PRIVATE_KEY'),
      alipayPublicKey: this.configService.get<string>('ALIPAY_PUBLIC_KEY'),
      wechatAppId: this.configService.get<string>('WECHAT_APP_ID'),
      wechatMchId: this.configService.get<string>('WECHAT_MCH_ID'),
      wechatSerialNo: this.configService.get<string>('WECHAT_SERIAL_NO'),
      wechatPrivateKey: this.configService.get<string>('WECHAT_PRIVATE_KEY'),
      wechatCertificate: this.configService.get<string>('WECHAT_CERTIFICATE'),
      wechatApiV3Key: this.configService.get<string>('WECHAT_API_V3_KEY'),
    };
    this.platformCache = {
      alipay: this.buildAlipay(cfg, 'platform'),
      wechat: this.buildWechat(cfg, 'platform'),
    };
    return this.platformCache;
  }

  /** 预热平台 ctx（启动期调用），返回各渠道是否就绪用于日志。 */
  warmPlatform(): { alipay: boolean; wechat: boolean } {
    const p = this.getPlatform();
    return { alipay: Boolean(p.alipay.sdk), wechat: Boolean(p.wechat.sdk) };
  }

  // ---- 租户 ctx ----
  private async getTenantChannels(
    tenantId: string,
  ): Promise<{ alipay: AlipayChannel; wechat: WechatChannel }> {
    const cached = this.tenantCache.get(tenantId);
    if (cached && cached.expireAt > this.now()) {
      return { alipay: cached.alipay, wechat: cached.wechat };
    }
    const t = await (this.prisma as any).tenant.findUnique({
      where: { id: tenantId },
      select: {
        wechatAppId: true,
        wechatMchId: true,
        wechatSerialNo: true,
        alipayAppId: true,
        wechatPrivateKeyEnc: true,
        wechatCertificateEnc: true,
        wechatApiV3KeyEnc: true,
        alipayPrivateKeyEnc: true,
        alipayPublicKeyEnc: true,
      },
    });

    let alipay: AlipayChannel = { sdk: null, appId: null };
    let wechat: WechatChannel = { sdk: null, appId: null, mchId: null, apiV3Key: null };
    if (t) {
      try {
        const cfg: RawPaymentConfig = {
          alipayAppId: t.alipayAppId,
          alipayPrivateKey: decryptSecret(t.alipayPrivateKeyEnc),
          alipayPublicKey: decryptSecret(t.alipayPublicKeyEnc),
          wechatAppId: t.wechatAppId,
          wechatMchId: t.wechatMchId,
          wechatSerialNo: t.wechatSerialNo,
          wechatPrivateKey: decryptSecret(t.wechatPrivateKeyEnc),
          wechatCertificate: decryptSecret(t.wechatCertificateEnc),
          wechatApiV3Key: decryptSecret(t.wechatApiV3KeyEnc),
        };
        alipay = this.buildAlipay(cfg, `tenant:${tenantId}`);
        wechat = this.buildWechat(cfg, `tenant:${tenantId}`);
      } catch (error) {
        // 解密失败（如主密钥缺失）→ 该租户回落平台，但要告警
        this.logger.error(
          `租户 ${tenantId} 支付配置解密失败，回落平台 env: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.tenantCache.set(tenantId, { alipay, wechat, expireAt: this.now() + this.ttlMs });
    return { alipay, wechat };
  }

  /**
   * 解析当前（或显式指定）租户的支付上下文。逐渠道回落平台。
   * @param explicitTenantId 回调等无 CLS 场景显式传入（如从 notify_url path）
   */
  async resolve(explicitTenantId?: string): Promise<ResolvedPaymentCtx> {
    const platform = this.getPlatform();
    const tenantId = explicitTenantId ?? this.tenantContext.getTenantId();

    if (!tenantId || tenantId === PLATFORM_TENANT_ID) {
      return {
        alipaySdk: platform.alipay.sdk,
        alipayAppId: platform.alipay.appId,
        wechatPay: platform.wechat.sdk,
        wechatApiV3Key: platform.wechat.apiV3Key,
        wechatAppId: platform.wechat.appId,
        wechatMchId: platform.wechat.mchId,
        source: {
          alipay: platform.alipay.sdk ? 'platform' : 'none',
          wechat: platform.wechat.sdk ? 'platform' : 'none',
        },
      };
    }

    const tenant = await this.getTenantChannels(tenantId);
    const alipayFromTenant = Boolean(tenant.alipay.sdk);
    const wechatFromTenant = Boolean(tenant.wechat.sdk);
    const alipay = alipayFromTenant ? tenant.alipay : platform.alipay;
    const wechat = wechatFromTenant ? tenant.wechat : platform.wechat;
    return {
      alipaySdk: alipay.sdk,
      alipayAppId: alipay.appId,
      wechatPay: wechat.sdk,
      wechatApiV3Key: wechat.apiV3Key,
      wechatAppId: wechat.appId,
      wechatMchId: wechat.mchId,
      source: {
        alipay: alipayFromTenant ? 'tenant' : alipay.sdk ? 'platform' : 'none',
        wechat: wechatFromTenant ? 'tenant' : wechat.sdk ? 'platform' : 'none',
      },
    };
  }
}
