import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminService, CONTEST_REGISTRATION_QRCODE_SETTING_KEY } from './admin.service';

@ApiTags('公开设置')
@Controller('settings')
export class SettingsPublicController {
  constructor(private readonly adminService: AdminService) {}

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
