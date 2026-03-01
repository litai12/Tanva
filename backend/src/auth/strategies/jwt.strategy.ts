import { Injectable } from '@nestjs/common';
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
      ]),
      secretOrKey: secret,
      ignoreExpiration: false,
    });
  }

  async validate(payload: any) {
    // 获取完整用户信息
    const user = await this.usersService.findById(payload.sub);
    if (!user) return null;
    const result = {
      sub: user.id,  // 标准JWT字段
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
    };
    console.log('JWT validate result:', result);
    return result;
  }
}
