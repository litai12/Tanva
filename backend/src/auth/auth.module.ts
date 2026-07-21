import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RefreshJwtStrategy } from './strategies/refresh.strategy';
import { PassportModule } from '@nestjs/passport';
import { SmsService } from './sms.service';
import { RegisterIpLimitService } from './register-ip-limit.service';
import { ReferralModule } from '../referral/referral.module';
import { CreditsModule } from '../credits/credits.module';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { TeamCoreModule } from '../team-core/team-core.module';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ session: false }),
    JwtModule.register({}),
    forwardRef(() => ReferralModule),
    CreditsModule,
    TelemetryModule,
    TeamCoreModule,
  ],
  providers: [AuthService, SmsService, RegisterIpLimitService, JwtStrategy, RefreshJwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
