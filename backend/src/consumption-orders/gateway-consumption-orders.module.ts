import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditsModule } from '../credits/credits.module';
import { TeamCreditsModule } from '../team-credits/team-credits.module';
import { TeamCollabModule } from '../team-collab/team-collab.module';
import { GatewayConsumptionOrdersService } from './gateway-consumption-orders.service';
import { GatewayConsumptionOrdersController } from './gateway-consumption-orders.controller';
@Module({ imports: [ConfigModule, PrismaModule, CreditsModule, TeamCreditsModule, TeamCollabModule],
  providers: [GatewayConsumptionOrdersService], controllers: [GatewayConsumptionOrdersController], exports: [GatewayConsumptionOrdersService] })
export class GatewayConsumptionOrdersModule {}
