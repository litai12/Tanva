import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClsModule } from 'nestjs-cls';
import { TenancyModule } from './tenancy/tenancy.module';
import { TenantResolverModule } from './tenancy/tenant-resolver.module';
import { TenantResolverService } from './tenancy/tenant-resolver.service';
import { CLS_TENANT_KEY } from './tenancy/tenant.constants';
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
import { TelemetryModule } from './telemetry/telemetry.module';
import { UserTemplatesModule } from './user-templates/user-templates.module';
import { MembershipModule } from './membership/membership.module';
import { VolcAssetModule } from './volc-asset/volc-asset.module';
import { BioAuthModule } from './bio-auth/bio-auth.module';
import { TeamSubscriptionModule } from './team-subscription/team-subscription.module';
import { TeamCoreModule } from './team-core/team-core.module';
import { TeamCreditsModule } from './team-credits/team-credits.module';
import { TeamCollabModule } from './team-collab/team-collab.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
      expandVariables: true,
    }),
    TenancyModule,
    // 在 CLS 上下文建立时（setup）解析 Host → tenantId 并写入，保证后续 Prisma 扩展可读
    ClsModule.forRootAsync({
      global: true,
      imports: [TenantResolverModule],
      inject: [TenantResolverService],
      useFactory: (resolver: TenantResolverService) => ({
        middleware: {
          mount: true,
          setup: async (cls, req) => {
            cls.set(CLS_TENANT_KEY, await resolver.resolve(req));
          },
        },
      }),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    UsersModule,
    AuthModule,
    HealthModule,
    OssModule,
    ProjectsModule,
    AiModule,
    AiPublicModule,
    CreditsModule,
    AdminModule,
    PersonalLibraryModule,
    GlobalImageHistoryModule,
    TemplatesModule,
    PaymentModule,
    MembershipModule,
    ReferralModule,
    TelemetryModule,
    UserTemplatesModule,
    VolcAssetModule,
    BioAuthModule,
    TeamSubscriptionModule,
    TeamCoreModule,
    TeamCreditsModule,
    TeamCollabModule,
  ],
})
export class AppModule {}
