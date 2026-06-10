import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PLATFORM_TENANT_ID } from '../tenancy/tenant.constants';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { normalizeHost } from '../tenancy/host.util';
import { NewApiKeyResolver } from '../tenancy/new-api-key-resolver.service';
import { TenantPaymentResolver } from '../tenancy/tenant-payment-resolver.service';
import { encryptSecret } from '../utils/secret-crypto';
import {
  AddDomainDto,
  CreateTenantDto,
  SetTenantApiKeysDto,
  SetTenantPaymentConfigDto,
  UpdateTenantDto,
} from './dto/tenant-admin.dto';

/**
 * 主站超管的租户管理。Tenant/TenantDomain 属全局白名单表，不受租户扩展注入，
 * 普通 prisma 调用即可跨租户读写。
 */
@Injectable()
export class TenantAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keyResolver: NewApiKeyResolver,
    private readonly paymentResolver: TenantPaymentResolver,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** 租户列表 + 域名 + 用户数 + key 配置状态(不返回明文) */
  async listTenants() {
    const tenants = await (this.prisma as any).tenant.findMany({
      orderBy: [{ isPlatform: 'desc' }, { createdAt: 'asc' }],
      include: { domains: { orderBy: { isPrimary: 'desc' } } },
    });
    // 各租户用户数：必须平台态聚合，否则被租户扩展注入当前 CLS 租户 → 其他租户数为 0
    const grouped: Array<{ tenantId: string; _count: { _all: number } }> =
      await this.tenantContext.runAsPlatform(() =>
        (this.prisma as any).user.groupBy({
          by: ['tenantId'],
          _count: { _all: true },
        }),
      );
    const countMap = new Map(grouped.map((g) => [g.tenantId, g._count._all]));
    return tenants.map((t: any) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      isPlatform: t.isPlatform,
      createdAt: t.createdAt,
      userCount: countMap.get(t.id) ?? 0,
      // 仅返回是否已配置（布尔），不泄露明文 key
      apiKeys: {
        normal: Boolean(t.newApiKey),
        vip: Boolean(t.newApiKeyVip),
        svip: Boolean(t.newApiKeySvip),
      },
      // 支付渠道是否已配置独立商户（足以构建 SDK 才算已配置；否则回落主站）
      payment: {
        wechat: Boolean(t.wechatMchId && t.wechatPrivateKeyEnc),
        alipay: Boolean(t.alipayAppId && t.alipayPrivateKeyEnc),
      },
      domains: t.domains.map((d: any) => ({
        id: d.id,
        host: d.host,
        isPrimary: d.isPrimary,
        verified: d.verified,
      })),
    }));
  }

  /**
   * 各租户经营统计：实付订单数/营收/售出积分 + 积分消耗/调用次数。
   * 下单与消耗目前都走平台主账号(未配独立商户则回落)，但 PaymentOrder/ApiUsageRecord
   * 都带 tenantId，故可按租户分开统计。
   * 必须 runAsPlatform 平台态聚合，否则被租户扩展注入当前 CLS 租户 → 其它租户为空。
   * amount 为 Decimal，_sum 返回 Prisma.Decimal，序列化前显式 toNumber 避免 JSON 丢精度。
   * 注：ApiUsageRecord 暂无 tenantId 索引，数据量大后建议加 @@index([tenantId])。
   */
  async getTenantStats() {
    const [tenants, paidOrders, usage]: [any[], any[], any[]] =
      await this.tenantContext.runAsPlatform(() =>
        Promise.all([
          (this.prisma as any).tenant.findMany({
            orderBy: [{ isPlatform: 'desc' }, { createdAt: 'asc' }],
            select: { id: true, slug: true, name: true, isPlatform: true },
          }),
          (this.prisma as any).paymentOrder.groupBy({
            by: ['tenantId'],
            where: { status: 'paid' },
            _count: { _all: true },
            _sum: { amount: true, credits: true },
          }),
          (this.prisma as any).apiUsageRecord.groupBy({
            by: ['tenantId'],
            _count: { _all: true },
            _sum: { creditsUsed: true },
          }),
        ]),
      );

    const toNum = (v: any): number =>
      v == null ? 0 : typeof v?.toNumber === 'function' ? v.toNumber() : Number(v) || 0;

    const orderMap = new Map<string, any>(paidOrders.map((o) => [o.tenantId, o]));
    const usageMap = new Map<string, any>(usage.map((u) => [u.tenantId, u]));
    const tenantMeta = new Map<string, any>(tenants.map((t) => [t.id, t]));

    // 以租户表为主，并兜出只在统计里出现却无 Tenant 记录的孤儿 tenantId(脏数据不隐藏)
    const ids = new Set<string>([
      ...tenants.map((t) => t.id),
      ...paidOrders.map((o) => o.tenantId),
      ...usage.map((u) => u.tenantId),
    ]);

    const rows = [...ids].map((id) => {
      const meta = tenantMeta.get(id);
      const o = orderMap.get(id);
      const u = usageMap.get(id);
      const isPlatform = meta?.isPlatform ?? id === PLATFORM_TENANT_ID;
      return {
        tenantId: id,
        name: meta?.name ?? (id === PLATFORM_TENANT_ID ? '主站' : '(未知租户)'),
        slug: meta?.slug ?? null,
        isPlatform,
        known: Boolean(meta),
        paidOrderCount: o?._count?._all ?? 0,
        revenueYuan: toNum(o?._sum?.amount), // 元
        creditsSold: o?._sum?.credits ?? 0,
        creditsConsumed: u?._sum?.creditsUsed ?? 0,
        apiCallCount: u?._count?._all ?? 0,
      };
    });

    // 主站置顶，其余按营收降序
    rows.sort((a, b) =>
      a.isPlatform !== b.isPlatform ? (a.isPlatform ? -1 : 1) : b.revenueYuan - a.revenueYuan,
    );

    return { tenants: rows, generatedAt: new Date().toISOString() };
  }

  async createTenant(dto: CreateTenantDto) {
    const slug = dto.slug.toLowerCase();
    const exists = await (this.prisma as any).tenant.findUnique({ where: { slug } });
    if (exists) throw new BadRequestException('slug 已存在');

    const tenant = await (this.prisma as any).tenant.create({
      data: { slug, name: dto.name, status: 'active', isPlatform: false },
    });

    if (dto.host) {
      await this.addDomain(tenant.id, { host: dto.host, isPrimary: true });
    }
    return this.getTenant(tenant.id);
  }

  async updateTenant(id: string, dto: UpdateTenantDto) {
    const tenant = await (this.prisma as any).tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('租户不存在');
    if (tenant.isPlatform && dto.status === 'suspended') {
      throw new BadRequestException('主站不可停用');
    }
    await (this.prisma as any).tenant.update({
      where: { id },
      data: { ...(dto.name ? { name: dto.name } : {}), ...(dto.status ? { status: dto.status } : {}) },
    });
    return this.getTenant(id);
  }

  async addDomain(tenantId: string, dto: AddDomainDto) {
    const tenant = await (this.prisma as any).tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('租户不存在');
    const host = normalizeHost(dto.host);
    if (!host) throw new BadRequestException('域名无效');

    const taken = await (this.prisma as any).tenantDomain.findUnique({ where: { host } });
    if (taken) throw new BadRequestException('该域名已被占用');

    if (dto.isPrimary) {
      // 同租户只保留一个主域名
      await (this.prisma as any).tenantDomain.updateMany({
        where: { tenantId },
        data: { isPrimary: false },
      });
    }
    await (this.prisma as any).tenantDomain.create({
      data: { tenantId, host, isPrimary: Boolean(dto.isPrimary), verified: true },
    });
    return this.getTenant(tenantId);
  }

  async removeDomain(tenantId: string, domainId: string) {
    const domain = await (this.prisma as any).tenantDomain.findUnique({ where: { id: domainId } });
    if (!domain || domain.tenantId !== tenantId) throw new NotFoundException('域名不存在');
    if (tenantId === PLATFORM_TENANT_ID && domain.isPrimary) {
      throw new BadRequestException('主站主域名不可删除');
    }
    await (this.prisma as any).tenantDomain.delete({ where: { id: domainId } });
    return this.getTenant(tenantId);
  }

  /** 设置租户 new-api 三组 key。传字符串=设置(空串=清除)，不传=不变。设置后清解析器缓存。 */
  async setApiKeys(tenantId: string, dto: SetTenantApiKeysDto) {
    const tenant = await (this.prisma as any).tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('租户不存在');
    const data: Record<string, string | null> = {};
    const norm = (v?: string) => (v === undefined ? undefined : v.trim() ? v.trim() : null);
    if (dto.newApiKey !== undefined) data.newApiKey = norm(dto.newApiKey) as any;
    if (dto.newApiKeyVip !== undefined) data.newApiKeyVip = norm(dto.newApiKeyVip) as any;
    if (dto.newApiKeySvip !== undefined) data.newApiKeySvip = norm(dto.newApiKeySvip) as any;
    if (Object.keys(data).length > 0) {
      await (this.prisma as any).tenant.update({ where: { id: tenantId }, data });
      this.keyResolver.invalidate(tenantId);
    }
    return this.getTenant(tenantId);
  }

  /** 查询租户支付配置：明文(商户号/appid/序列号)回显便于核对；私钥/证书/APIv3 key 仅回是否已配置。 */
  async getPaymentConfig(tenantId: string) {
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
    if (!t) throw new NotFoundException('租户不存在');
    return {
      wechat: {
        appId: t.wechatAppId ?? null,
        mchId: t.wechatMchId ?? null,
        serialNo: t.wechatSerialNo ?? null,
        privateKey: Boolean(t.wechatPrivateKeyEnc),
        certificate: Boolean(t.wechatCertificateEnc),
        apiV3Key: Boolean(t.wechatApiV3KeyEnc),
      },
      alipay: {
        appId: t.alipayAppId ?? null,
        privateKey: Boolean(t.alipayPrivateKeyEnc),
        publicKey: Boolean(t.alipayPublicKeyEnc),
      },
    };
  }

  /**
   * 设置租户支付配置。每字段：传字符串=设置(空串=清除)，不传=不变。
   * 私钥/证书/APIv3 key 加密入库；商户号/appid/序列号明文。设置后清解析器缓存。
   */
  async setPaymentConfig(tenantId: string, dto: SetTenantPaymentConfigDto) {
    const tenant = await (this.prisma as any).tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('租户不存在');

    const data: Record<string, string | null> = {};
    const normPlain = (v?: string) => (v === undefined ? undefined : v.trim() ? v.trim() : null);
    const normSecret = (v?: string) =>
      v === undefined ? undefined : v.trim() ? encryptSecret(v.trim()) : null;

    // 明文字段
    if (dto.wechatAppId !== undefined) data.wechatAppId = normPlain(dto.wechatAppId) as any;
    if (dto.wechatMchId !== undefined) data.wechatMchId = normPlain(dto.wechatMchId) as any;
    if (dto.wechatSerialNo !== undefined) data.wechatSerialNo = normPlain(dto.wechatSerialNo) as any;
    if (dto.alipayAppId !== undefined) data.alipayAppId = normPlain(dto.alipayAppId) as any;
    // 密文字段 → *Enc 列
    if (dto.wechatPrivateKey !== undefined) data.wechatPrivateKeyEnc = normSecret(dto.wechatPrivateKey) as any;
    if (dto.wechatCertificate !== undefined) data.wechatCertificateEnc = normSecret(dto.wechatCertificate) as any;
    if (dto.wechatApiV3Key !== undefined) data.wechatApiV3KeyEnc = normSecret(dto.wechatApiV3Key) as any;
    if (dto.alipayPrivateKey !== undefined) data.alipayPrivateKeyEnc = normSecret(dto.alipayPrivateKey) as any;
    if (dto.alipayPublicKey !== undefined) data.alipayPublicKeyEnc = normSecret(dto.alipayPublicKey) as any;

    if (Object.keys(data).length > 0) {
      await (this.prisma as any).tenant.update({ where: { id: tenantId }, data });
      this.paymentResolver.invalidate(tenantId);
    }
    return this.getPaymentConfig(tenantId);
  }

  private async getTenant(id: string) {
    const list = await this.listTenants();
    return list.find((t: { id: string }) => t.id === id);
  }
}
