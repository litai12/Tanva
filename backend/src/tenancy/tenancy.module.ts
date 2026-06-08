import { Global, Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { NewApiKeyResolver } from './new-api-key-resolver.service';

@Global()
@Module({
  providers: [TenantContextService, NewApiKeyResolver],
  exports: [TenantContextService, NewApiKeyResolver],
})
export class TenancyModule {}
