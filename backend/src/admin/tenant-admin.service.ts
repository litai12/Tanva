import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PLATFORM_TENANT_ID } from '../tenancy/tenant.constants';
import { normalizeHost } from '../tenancy/host.util';
import { NewApiKeyResolver } from '../tenancy/new-api-key-resolver.service';
import {
  AddDomainDto,
  CreateTenantDto,
  SetTenantApiKeysDto,
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
  ) {}

  /** 租户列表 + 域名 + 用户数 + key 配置状态(不返回明文) */
  async listTenants() {
    const tenants = await (this.prisma as any).tenant.findMany({
      orderBy: [{ isPlatform: 'desc' }, { createdAt: 'asc' }],
      include: { domains: { orderBy: { isPrimary: 'desc' } } },
    });
    // 各租户用户数（平台态聚合一次）
    const grouped: Array<{ tenantId: string; _count: { _all: number } }> =
      await (this.prisma as any).user.groupBy({
        by: ['tenantId'],
        _count: { _all: true },
      });
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
      domains: t.domains.map((d: any) => ({
        id: d.id,
        host: d.host,
        isPrimary: d.isPrimary,
        verified: d.verified,
      })),
    }));
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

  private async getTenant(id: string) {
    const list = await this.listTenants();
    return list.find((t: { id: string }) => t.id === id);
  }
}
