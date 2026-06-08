import { INestApplication, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import {
  CLS_PLATFORM_MODE_KEY,
  CLS_TENANT_KEY,
  PLATFORM_TENANT_ID,
} from '../tenancy/tenant.constants';
import { createTenantExtension } from './tenant-prisma.extension';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * 带租户隔离扩展的 client。业务代码无需直接访问——构造函数返回的 Proxy
   * 会把 model 访问（this.prisma.user 等）与 $transaction 转发到这里，
   * 从而默认即隔离。$queryRaw/$executeRaw 等仍走 base client（裸 SQL 由 P8 防御）。
   */
  private readonly _scoped: ReturnType<PrismaService['buildTenantClient']>;

  constructor(private readonly cls: ClsService) {
    super();
    this._scoped = this.buildTenantClient();

    // 返回 Proxy：小写开头的 model 访问 + $transaction 转发到扩展 client，
    // 其余（$queryRaw、$connect、onModuleInit 等）走 base。
    // 排除 Object/Promise 原型属性，避免 constructor/then 被错误转发破坏 instanceof/await。
    const NON_FORWARD = new Set([
      'constructor', 'then', 'catch', 'finally', 'toString', 'valueOf',
      'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString',
    ]);
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop === '$transaction') {
          // 关键：事务也走扩展 client，使 tx.* 在事务内保持租户隔离
          return (target._scoped as any).$transaction.bind(target._scoped);
        }
        if (
          typeof prop === 'string' &&
          /^[a-z]/.test(prop) &&
          !NON_FORWARD.has(prop) &&
          prop in (target._scoped as any)
        ) {
          return (target._scoped as any)[prop];
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  private buildTenantClient() {
    return this.$extends(
      createTenantExtension(() => ({
        tenantId: this.cls.get(CLS_TENANT_KEY) ?? PLATFORM_TENANT_ID,
        isPlatform: this.cls.get(CLS_PLATFORM_MODE_KEY) === true,
      })),
    );
  }

  async onModuleInit() {
    // 添加重试机制，处理数据库启动时的连接问题
    const maxRetries = 5;
    const retryDelay = 2000; // 2秒

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.$connect();
        this.logger.log('数据库连接成功');
        return;
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        this.logger.warn(`数据库连接失败 (尝试 ${attempt}/${maxRetries}): ${errorMessage}`);

        if (attempt === maxRetries) {
          this.logger.error('数据库连接失败，已达到最大重试次数');
          throw error;
        }

        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }
    }
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }
}
