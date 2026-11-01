import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
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
    // 获取完整用户信息
    const user = await this.usersService.findById(payload.sub);
    if (!user) return null;
    if (user.status === 'banned') {
      throw new UnauthorizedException('\u6b64\u8d26\u53f7\u5df2\u88ab\u5c01\u63a7');
    }
    // OAuth（MCP / 外部 Agent）令牌：授权被吊销后立即失效，不等 access token 自然过期。
    if (typeof payload?.gid === 'string' && payload.gid) {
      if (!await this.usersService.hasActiveOAuthGrant(user.id, payload.gid)) {
        throw new UnauthorizedException('Agent 授权已被吊销或已过期');
      }
    }
    void this.usersService.touchLastLoginAt(user.id).catch(() => undefined);
    const result = {
      sub: user.id,  // 标准JWT字段
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      role: user.role,
      status: user.status,
    };
    return result;
  }
}
