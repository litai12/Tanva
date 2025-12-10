import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SmsLoginDto } from './dto/sms-login.dto';
import { JwtAuthGuard } from './guards/jwt.guard';
import { RefreshAuthGuard } from './guards/refresh.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: any) {
    const user = await this.auth.register(dto, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
    return { user };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const user = await this.auth.validateUser(dto.phone, dto.password);
    const tokens = await this.auth.login(
      { id: user.id, email: user.email || '', role: user.role },
      { ip: req.ip, ua: req.headers['user-agent'] },
    );
    this.auth.setAuthCookies(res, tokens, req);
    return { user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role } };
  }

  // 发送短信（测试环境固定 336699）
  @Post('send-sms')
  @HttpCode(HttpStatus.OK)
  async sendSms(@Body() body: { phone: string }) {
    if (!body?.phone) return { ok: false, error: '缺少手机号' };
    // 这里仅返回固定验证码，不真正发送
    return { ok: true, code: '336699' };
  }

  // 短信登录（固定验证码 336699）
  @Post('login-sms')
  @HttpCode(HttpStatus.OK)
  async loginSms(@Body() dto: SmsLoginDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const { user, tokens } = await this.auth.loginWithSms(dto.phone, dto.code, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
    this.auth.setAuthCookies(res, tokens, req);
    return { user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role } };
  }

  @Get('me')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: any) {
    return { user: req.user };
  }

  @Post('refresh')
  @ApiCookieAuth('refresh_token')
  @UseGuards(RefreshAuthGuard)
  async refresh(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const tokens = await this.auth.refresh(req.user, req.user.refreshToken);
    this.auth.setAuthCookies(res, tokens, req);
    return { ok: true };
  }

  @Post('logout')
  @ApiCookieAuth('refresh_token')
  @UseGuards(RefreshAuthGuard)
  async logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
    await this.auth.logout(req.user.sub);
    this.auth.clearAuthCookies(res, req);
    return { ok: true };
  }
}
