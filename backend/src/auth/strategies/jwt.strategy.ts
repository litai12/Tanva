import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { TenantContextService } from '../../tenancy/tenant-context.service';
type Request = any;

function cookieExtractor(req: Request, name: string): string | null {
  const anyReq: any = req as any;
  const fromCookie = anyReq?.cookies?.[name];
  if (fromCookie) return fromCookie as string;
  const fromHeader = req.headers?.authorization?.replace('Bearer ', '') ?? null;
  return fromHeader || null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private config: ConfigService,
    private usersService: UsersService,
    private tenantContext: TenantContextService,
  ) {
    const secret = config.get<string>('JWT_ACCESS_SECRET') || 'dev-access-secret';
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => cookieExtractor(req, 'access_token'),
        ExtractJwt.fromUrlQueryParameter('token'),
      ]),
      secretOrKey: secret,
      ignoreExpiration: false,
    });
  }

  async validate(payload: any) {
    // 跨站 token 防护：token 的租户必须等于当前 Host 解析出的租户（codex#2）
    const currentTenant = this.tenantContext.getTenantId();
    if (payload.tenantId) {
      if (payload.tenantId !== currentTenant) return null; // 跨站 token → 401
    } else if (this.config.get<string>('TENANT_STRICT_TOKEN') === 'true') {
      return null; // 严格模式：拒绝无 tenantId 的旧 token（access token TTL 短，过渡期后开启）
    }
    // 无 tenantId 且非严格：仍由下方 findById（租户作用域）兜底——
    // 查不到当前 Host 租户内的用户即返回 null，旧 token 无法跨租户访问。

    // findById 经租户扩展注入 tenantId，本就限定当前租户用户（跨租户自然查不到）
    const user = await this.usersService.findById(payload.sub);
    if (!user) return null;
    if (user.status === 'banned') {
      throw new UnauthorizedException('\u6b64\u8d26\u53f7\u5df2\u88ab\u5c01\u63a7');
    }
    void this.usersService.touchLastLoginAt(user.id).catch(() => undefined);
    return {
      sub: user.id, // 标准JWT字段
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      role: user.role,
      tenantId: (user as any).tenantId,
      status: user.status,
    };
  }
}
