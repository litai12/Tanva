import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RefreshJwtStrategy } from './strategies/refresh.strategy';
import { PassportModule } from '@nestjs/passport';
import { SmsService } from './sms.service';
import { ReferralModule } from '../referral/referral.module';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ session: false }),
    JwtModule.register({}),
    forwardRef(() => ReferralModule),
    CreditsModule,
  ],
  providers: [AuthService, SmsService, JwtStrategy, RefreshJwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
