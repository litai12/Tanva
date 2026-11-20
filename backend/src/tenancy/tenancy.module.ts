import { Global, Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { NewApiKeyResolver } from './new-api-key-resolver.service';
import { TenantPaymentResolver } from './tenant-payment-resolver.service';
import { TenantIterationService } from './tenant-iteration.service';

@Global()
@Module({
  providers: [TenantContextService, NewApiKeyResolver, TenantPaymentResolver, TenantIterationService],
  exports: [TenantContextService, NewApiKeyResolver, TenantPaymentResolver, TenantIterationService],
})
export class TenancyModule {}
