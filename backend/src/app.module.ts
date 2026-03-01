import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { OssModule } from './oss/oss.module';
import { ProjectsModule } from './projects/projects.module';
import { AiModule } from './ai/ai.module';
import { AiPublicModule } from './ai-public/ai-public.module';
import { CreditsModule } from './credits/credits.module';
import { AdminModule } from './admin/admin.module';
import { PersonalLibraryModule } from './personal-library/personal-library.module';
import { GlobalImageHistoryModule } from './global-image-history/global-image-history.module';
import { TemplatesModule } from './templates/templates.module';
import { PaymentModule } from './payment/payment.module';
import { ReferralModule } from './referral/referral.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'], // 尝试多个路径
      expandVariables: true
    }),
    ScheduleModule.forRoot(), // 定时任务模块
    PrismaModule,
    UsersModule,
    AuthModule,
    HealthModule,
    OssModule,
    ProjectsModule,
    AiModule,
    AiPublicModule, // 添加公开 AI API 模块
    CreditsModule,  // 积分系统模块
    AdminModule,    // 管理后台模块
    PersonalLibraryModule, // 个人库资源持久化
    GlobalImageHistoryModule, // 全局图片历史
    TemplatesModule, // 公共模板模块
    PaymentModule,   // 支付模块
    ReferralModule,  // 推广激励模块
  ],
})
export class AppModule {}
