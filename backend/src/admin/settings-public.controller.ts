import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminService, CONTEST_REGISTRATION_QRCODE_SETTING_KEY } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';

@ApiTags('公开设置')
@Controller('settings')
export class SettingsPublicController {
  constructor(
    private readonly adminService: AdminService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('site-info')
  @ApiOperation({ summary: '当前站点（按 Host 解析的租户）公开信息：名称/首页模板' })
  async getSiteInfo() {
    // CLS 中间件已按 Host 解析租户；Tenant 是全局白名单表，不受租户扩展注入
    const tenantId = this.tenantContext.getTenantId();
    const tenant = await (this.prisma as any).tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, homepage: true },
    });
    return {
      tenantId,
      name: tenant?.name ?? null,
      homepage: tenant?.homepage ?? 'default',
    };
  }

  @Get('wechat-qrcodes')
  @ApiOperation({ summary: '获取微信二维码配置（公开接口）' })
  async getWeChatQrCodes() {
    const officialAccountSetting = await this.adminService.getSetting('wechat_official_account_qrcode');
    const wechatGroupSetting = await this.adminService.getSetting('wechat_group_qrcode');
    const loginNoticeButtonSetting = await this.adminService.getSetting('login_notice_button_qrcode');
    const contestRegistrationSetting = await this.adminService.getSetting(CONTEST_REGISTRATION_QRCODE_SETTING_KEY);
    const contestRegistration = contestRegistrationSetting?.value || null;

    return {
      officialAccount: officialAccountSetting?.value || null,
      wechatGroup: wechatGroupSetting?.value || null,
      loginNoticeButton: loginNoticeButtonSetting?.value || null,
      contestRegistration,
      contestRegistrationQrUrl: contestRegistration,
      contestRegistrationQrCode: contestRegistration,
      contest_registration_qrcode: contestRegistration,
    };
  }

  @Get('login-notice')
  @ApiOperation({ summary: '获取登录后用户提醒配置（公开接口）' })
  async getLoginNotice() {
    return this.adminService.getLoginNotice();
  }

  @Get('seedream-provider')
  @ApiOperation({ summary: 'Get active seedream provider (public)' })
  async getSeedreamProvider() {
    const setting = await this.adminService.getSetting('seedream5_provider');
    const provider = setting?.value === 'watcha' ? 'watcha' : 'doubao';
    return { provider };
  }
}
