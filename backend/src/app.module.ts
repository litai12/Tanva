import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { OssModule } from './oss/oss.module';
import { ProjectsModule } from './projects/projects.module';
import { AiModule } from './ai/ai.module';
import { AiPublicModule } from './ai-public/ai-public.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'], // 尝试多个路径
      expandVariables: true
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    HealthModule,
    OssModule,
    ProjectsModule,
    AiModule,
    AiPublicModule, // 添加公开 AI API 模块
  ],
})
export class AppModule {}
