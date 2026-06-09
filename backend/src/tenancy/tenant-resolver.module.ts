import { Module } from '@nestjs/common';
import { TenantResolverService } from './tenant-resolver.service';

/**
 * 仅提供 TenantResolverService，供 ClsModule.forRootAsync 注入。
 * 单独成模块以避免 ClsModule 导入 TenancyModule（后者含依赖 ClsService 的
 * TenantContextService）造成循环依赖。
 */
@Module({
  providers: [TenantResolverService],
  exports: [TenantResolverService],
})
export class TenantResolverModule {}
