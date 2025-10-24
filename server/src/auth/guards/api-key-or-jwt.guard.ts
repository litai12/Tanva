import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';

/**
 * 支持 JWT 或外部 API Key 的鉴权守卫。
 * - 当请求头携带合法的 `x-api-key` 时直接放行；
 * - 否则退回到标准的 JWT 鉴权逻辑；
 * - 若两者均不满足则返回 401。
 */
@Injectable()
export class ApiKeyOrJwtGuard extends AuthGuard('jwt') implements CanActivate {
  private readonly cachedKeys: string[];

  constructor(private readonly configService: ConfigService) {
    super();
    const keys = this.configService.get<string>('AI_API_KEYS') || '';
    this.cachedKeys = keys
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = this.extractApiKey(request);

    if (apiKey && this.isValidApiKey(apiKey)) {
      // 记录外部调用者信息，后续日志或业务可使用
      request.apiClient = { apiKey };
      return true;
    }

    try {
      const result = await super.canActivate(context);
      return result as boolean;
    } catch (error) {
      throw new UnauthorizedException('Invalid API key or JWT token.');
    }
  }

  handleRequest(err: any, user: any): any {
    if (err) {
      throw err;
    }
    if (!user) {
      throw new UnauthorizedException('Invalid JWT token.');
    }
    return user;
  }

  private extractApiKey(request: any): string | null {
    const headerKey =
      request.headers?.['x-api-key'] ??
      request.headers?.['X-API-KEY'] ??
      request.headers?.['x-apiKey'] ??
      null;

    return typeof headerKey === 'string' ? headerKey.trim() : null;
  }

  private isValidApiKey(apiKey: string): boolean {
    if (this.cachedKeys.length === 0) {
      return false;
    }
    return this.cachedKeys.includes(apiKey);
  }
}
