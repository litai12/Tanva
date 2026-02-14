import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcryptjs";
import { UsersService } from "../users/users.service";
import { PrismaService } from "../prisma/prisma.service";
import { RegisterDto } from "./dto/register.dto";
import { SmsService } from "./sms.service";
import { ReferralService } from "../referral/referral.service";
import { CreditsService } from "../credits/credits.service";

type TokenPair = { accessToken: string; refreshToken: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly smsService: SmsService,
    @Inject(forwardRef(() => ReferralService))
    private readonly referralService: ReferralService,
    private readonly creditsService: CreditsService
  ) {}

  private async signTokens(user: {
    id: string;
    email: string;
    role: string;
  }): Promise<TokenPair> {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessTtl = this.config.get<string>("JWT_ACCESS_TTL") || "900s";
    const refreshTtl = this.config.get<string>("JWT_REFRESH_TTL") || "30d";

    const accessToken = await this.jwt.signAsync(payload, {
      secret:
        this.config.get<string>("JWT_ACCESS_SECRET") || "dev-access-secret",
      expiresIn: accessTtl,
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret:
        this.config.get<string>("JWT_REFRESH_SECRET") || "dev-refresh-secret",
      expiresIn: refreshTtl,
    });
    return { accessToken, refreshToken };
  }

  private cookieOptions(request?: any) {
    // 检测是否通过 HTTPS 访问（Cloudflare Tunnel 会设置 x-forwarded-proto: https）
    const isHttps =
      request?.headers?.["x-forwarded-proto"] === "https" ||
      request?.protocol === "https" ||
      this.config.get("COOKIE_SECURE") === "true";

    // 如果通过 HTTPS（如 Cloudflare Tunnel），使用 secure: true 和 sameSite: 'none'
    // 否则使用 secure: false 和 sameSite: 'lax'（本地开发）
    const secureEnv = this.config.get("COOKIE_SECURE");
    const secure = secureEnv ? secureEnv === "true" : isHttps;

    const sameSiteEnv = this.config.get("COOKIE_SAMESITE");
    const sameSite = sameSiteEnv ? sameSiteEnv : secure ? "none" : "lax";

    const rawDomain = this.config.get<string>("COOKIE_DOMAIN");
    // 注意：localhost/127.0.0.1 不能作为 Cookie Domain；开发环境不要设置 domain
    // Cloudflare Tunnel 也不需要设置 domain，让浏览器自动处理
    const invalidLocal =
      rawDomain === "localhost" ||
      rawDomain === "127.0.0.1" ||
      rawDomain === "";
    const domain = invalidLocal ? undefined : rawDomain;

    return { httpOnly: true, secure, sameSite, domain, path: "/" } as const;
  }

  async register(dto: RegisterDto, meta?: { ip?: string; ua?: string }) {
    const hash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const existsByPhone = await tx.user.findUnique({
        where: { phone: dto.phone },
      });
      if (existsByPhone) throw new UnauthorizedException("手机号已注册");
      if (dto.email) {
        const existsByEmail = await tx.user.findUnique({
          where: { email: dto.email.toLowerCase() },
        });
        if (existsByEmail) throw new UnauthorizedException("邮箱已存在");
      }

      const newUser = await tx.user.create({
        data: {
          email: dto.email ? dto.email.toLowerCase() : null,
          passwordHash: hash,
          name: dto.name || dto.phone.slice(-4),
          phone: dto.phone,
        },
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          avatarUrl: true,
          role: true,
          status: true,
          createdAt: true,
        },
      });

      return newUser;
    });

    // 处理邀请码（在事务外执行，避免影响注册流程）
    if (dto.inviteCode) {
      try {
        await this.referralService.useInviteCode(user.id, dto.inviteCode);
      } catch (e) {
        // 邀请码处理失败不影响注册，只记录日志
        console.warn(`[Register] 邀请码处理失败: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 创建积分账户并赠送新用户初始积分
    try {
      await this.creditsService.getOrCreateAccount(user.id);
    } catch (e) {
      // 积分账户创建失败不影响注册，只记录日志
      console.warn(`[Register] 创建积分账户失败: ${e instanceof Error ? e.message : e}`);
    }

    return user;
  }

  async validateUser(phone: string, password: string) {
    const user = await this.usersService.findByPhone(phone);
    if (!user) throw new UnauthorizedException("账号或密码错误");
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException("账号或密码错误");
    return user;
  }

  async login(
    user: { id: string; email: string; role: string },
    meta?: { ip?: string; ua?: string }
  ) {
    const tokens = await this.signTokens(user);
    const refreshHash = await bcrypt.hash(tokens.refreshToken, 10);
    const refreshTtlSec = this.config.get("JWT_REFRESH_TTL") || "30d";
    const expiresAt = new Date(Date.now() + this.parseTtlMs(refreshTtlSec));
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        ip: meta?.ip,
        userAgent: meta?.ua,
        expiresAt,
      },
    });
    return tokens;
  }

  async loginWithSms(
    phone: string,
    code: string,
    meta?: { ip?: string; ua?: string }
  ) {
    const verify = await this.smsService.verifyCode(phone, code);
    if (!verify.ok) throw new UnauthorizedException(verify.msg || "验证码错误");
    const user = await this.usersService.findByPhone(phone);
    if (!user) throw new UnauthorizedException("用户不存在，请先注册");
    const tokens = await this.login(
      { id: user.id, email: user.email || "", role: user.role },
      meta
    );
    return { user, tokens };
  }

  async resetPassword(phone: string, code: string, newPassword: string) {
    // 验证短信验证码
    const verify = await this.smsService.verifyCode(phone, code);
    if (!verify.ok) throw new BadRequestException(verify.msg || "验证码错误");

    // 查找用户
    const user = await this.usersService.findByPhone(phone);
    if (!user) throw new BadRequestException("用户不存在");

    // 加密新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 更新用户密码
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashedPassword },
    });

    return { success: true };
  }

  async refresh(userPayload: any, presentedToken: string) {
    const rt = await this.prisma.refreshToken.findFirst({
      where: { userId: userPayload.sub, isRevoked: false },
      orderBy: { createdAt: "desc" },
    });
    if (!rt) throw new UnauthorizedException("刷新令牌无效");
    const ok = await bcrypt.compare(presentedToken, rt.tokenHash);
    if (!ok) throw new UnauthorizedException("刷新令牌无效");
    if (rt.expiresAt < new Date())
      throw new UnauthorizedException("刷新令牌过期");
    await this.prisma.refreshToken.update({
      where: { id: rt.id },
      data: { isRevoked: true },
    });
    const tokens = await this.signTokens({
      id: userPayload.sub,
      email: userPayload.email,
      role: userPayload.role,
    });
    const refreshHash = await bcrypt.hash(tokens.refreshToken, 10);
    const refreshTtlSec = this.config.get("JWT_REFRESH_TTL") || "30d";
    const expiresAt = new Date(Date.now() + this.parseTtlMs(refreshTtlSec));
    await this.prisma.refreshToken.create({
      data: { userId: userPayload.sub, tokenHash: refreshHash, expiresAt },
    });
    return tokens;
  }

  async logout(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });
  }

  setAuthCookies(reply: any, tokens: TokenPair, request?: any) {
    const base = this.cookieOptions(request);
    reply.setCookie("access_token", tokens.accessToken, { ...base });
    const refreshTtl = this.parseTtlMs(
      this.config.get("JWT_REFRESH_TTL") || "30d"
    );
    reply.setCookie("refresh_token", tokens.refreshToken, {
      ...base,
      maxAge: Math.floor(refreshTtl / 1000),
    });
  }

  clearAuthCookies(reply: any, request?: any) {
    const base = this.cookieOptions(request);
    reply.clearCookie("access_token", base);
    reply.clearCookie("refresh_token", base);
  }

  private parseTtlMs(ttl: string | number) {
    if (typeof ttl === "number") return ttl * 1000;
    const m = /^([0-9]+)([smhd])$/.exec(ttl);
    if (!m) return Number(ttl) * 1000;
    const n = Number(m[1]);
    const unit = m[2];
    switch (unit) {
      case "s":
        return n * 1000;
      case "m":
        return n * 60 * 1000;
      case "h":
        return n * 60 * 60 * 1000;
      case "d":
        return n * 24 * 60 * 60 * 1000;
      default:
        return n * 1000;
    }
  }
}
