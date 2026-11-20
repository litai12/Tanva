import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { TenantContextService } from '../../tenancy/tenant-context.service';
type Request = any;

function cookieExtractor(req: Request, name: string): string | null {
  const anyReq: any = req as any;
  const fromCookie = anyReq?.cookies?.[name];
  if (fromCookie) return fromCookie as string;
  const fromHeader = req.headers?.authorization?.replace(/^Bearer\s+/i, '') ?? null;
  return fromHeader || null;
}

@Injectable()
export class RefreshJwtStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    config: ConfigService,
    private readonly tenantContext: TenantContextService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => cookieExtractor(req, 'refresh_token'),
      ]),
      secretOrKey: config.get<string>('JWT_REFRESH_SECRET') || 'dev-refresh-secret',
      ignoreExpiration: false,
      passReqToCallback: true,
    });
  }

  validate(req: Request, payload: any) {
    // 跨站 refresh token 防护：与 JwtStrategy 一致，token 租户必须匹配当前 Host 租户
    const currentTenant = this.tenantContext.getTenantId();
    if (payload?.tenantId && payload.tenantId !== currentTenant) {
      return null;
    }
    const refreshToken =
      (req as any).cookies?.['refresh_token'] ??
      req.headers?.authorization?.replace(/^Bearer\s+/i, '') ??
      null;
    return { ...payload, refreshToken };
  }
}
