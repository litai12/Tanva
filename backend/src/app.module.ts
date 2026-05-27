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
