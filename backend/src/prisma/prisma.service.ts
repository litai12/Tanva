import { INestApplication, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

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

