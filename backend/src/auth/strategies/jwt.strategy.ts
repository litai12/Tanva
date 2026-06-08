import { Injectable } from '@nestjs/common';
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
    if (payload.tenantId && payload.tenantId !== currentTenant) {
      return null; // 401
    }

    // findById 经租户扩展注入 tenantId，本就限定当前租户用户（跨租户自然查不到）
    const user = await this.usersService.findById(payload.sub);
    if (!user) return null;
    void this.usersService.touchLastLoginAt(user.id).catch(() => undefined);
    return {
      sub: user.id, // 标准JWT字段
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      tenantId: (user as any).tenantId,
    };
  }
}
