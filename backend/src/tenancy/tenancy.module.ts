import { Global, Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { NewApiKeyResolver } from './new-api-key-resolver.service';
import { TenantIterationService } from './tenant-iteration.service';

@Global()
@Module({
  providers: [TenantContextService, NewApiKeyResolver, TenantIterationService],
  exports: [TenantContextService, NewApiKeyResolver, TenantIterationService],
})
export class TenancyModule {}
