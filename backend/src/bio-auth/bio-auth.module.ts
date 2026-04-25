import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { BioAuthController } from './bio-auth.controller';
import { BioAuthService } from './bio-auth.service';

@Module({
  imports: [ConfigModule, AuthModule],
  providers: [BioAuthService],
  controllers: [BioAuthController],
})
export class BioAuthModule {}
