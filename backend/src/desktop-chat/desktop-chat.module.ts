import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TeamCollabModule } from '../team-collab/team-collab.module';
import { AuthModule } from '../auth/auth.module';
import { CreditsModule } from '../credits/credits.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TeamCreditsModule } from '../team-credits/team-credits.module';
import { DesktopChatController } from './desktop-chat.controller';
import { DesktopChatService } from './desktop-chat.service';
@Module({ imports: [ConfigModule, AuthModule, PrismaModule, CreditsModule, TeamCreditsModule, TeamCollabModule], controllers: [DesktopChatController], providers: [DesktopChatService] })
export class DesktopChatModule {}
