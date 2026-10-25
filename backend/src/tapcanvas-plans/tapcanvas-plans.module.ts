import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { CreditsModule } from '../credits/credits.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TeamCreditsModule } from '../team-credits/team-credits.module';
import { GatewayConsumptionOrdersModule } from '../consumption-orders/gateway-consumption-orders.module';
import { TapcanvasPlansController } from './tapcanvas-plans.controller';
import { TapcanvasPlansService } from './tapcanvas-plans.service';
@Module({ imports: [ConfigModule, AuthModule, PrismaModule, CreditsModule, TeamCreditsModule, GatewayConsumptionOrdersModule],
  controllers: [TapcanvasPlansController], providers: [TapcanvasPlansService] })
export class TapcanvasPlansModule {}
