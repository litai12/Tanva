import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { SettingsPublicController } from './settings-public.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditsModule } from '../credits/credits.module';
import { OssModule } from '../oss/oss.module';
import { BusinessPolicyModule } from '../business-policy/business-policy.module';
import { MembershipModule } from '../membership/membership.module';
import { TemplateService } from './services/template.service';
import { NodeConfigService } from './services/node-config.service';
import { VolcAssetModule } from '../volc-asset/volc-asset.module';
import { TeamCollabModule } from '../team-collab/team-collab.module';
import { TeamCoreModule } from '../team-core/team-core.module';

@Module({
  imports: [
    PrismaModule,
    CreditsModule,
    OssModule,
    BusinessPolicyModule,
    MembershipModule,
    VolcAssetModule,
    TeamCollabModule,
    TeamCoreModule,
  ],
  controllers: [AdminController, SettingsPublicController],
  providers: [AdminService, TemplateService, NodeConfigService],
  exports: [AdminService, TemplateService, NodeConfigService],
})
export class AdminModule implements OnModuleInit {
  private readonly logger = new Logger(AdminModule.name);

  constructor(private readonly nodeConfigService: NodeConfigService) {}

  async onModuleInit() {
    try {
      const result = await this.nodeConfigService.initializeDefaultConfigs();
      this.logger.log(`节点配置自动初始化: 创建 ${result.created} 个, 跳过 ${result.skipped} 个`);
    } catch (error) {
      this.logger.error('节点配置自动初始化失败:', error);
    }
  }
}
