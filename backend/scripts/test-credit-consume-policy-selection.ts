import assert from 'node:assert/strict';

import {
  selectCreditConsumePolicyRecord,
  type PersistedCreditConsumePolicyRecord,
} from '../src/credits/credit-lot-policy';

function run(): void {
  const records: PersistedCreditConsumePolicyRecord[] = [
    {
      code: 'global_default',
      version: 1,
      scopeType: 'global',
      scopeValue: null,
      sorts: [],
      validityPriority: null,
      sourcePriority: null,
    },
    {
      code: 'service_image',
      version: 2,
      scopeType: 'service_type',
      scopeValue: 'gemini-image-edit',
      sorts: [],
      validityPriority: null,
      sourcePriority: null,
    },
    {
      code: 'provider_google',
      version: 3,
      scopeType: 'provider',
      scopeValue: 'google',
      sorts: [],
      validityPriority: null,
      sourcePriority: null,
    },
    {
      code: 'model_ultra_v1',
      version: 1,
      scopeType: 'model',
      scopeValue: 'gemini-ultra',
      sorts: [],
      validityPriority: null,
      sourcePriority: null,
    },
    {
      code: 'model_ultra_v2',
      version: 2,
      scopeType: 'model',
      scopeValue: 'gemini-ultra',
      sorts: [],
      validityPriority: null,
      sourcePriority: null,
    },
  ];

  const selected = selectCreditConsumePolicyRecord(records, {
    serviceType: 'gemini-image-edit',
    provider: 'google',
    model: 'gemini-ultra',
  });

  assert.equal(selected?.code, 'model_ultra_v2');

  const providerSelected = selectCreditConsumePolicyRecord(records, {
    serviceType: 'gemini-image-edit',
    provider: 'google',
    model: 'gemini-missing',
  });

  assert.equal(providerSelected?.code, 'provider_google');

  const serviceSelected = selectCreditConsumePolicyRecord(records, {
    serviceType: 'gemini-image-edit',
    provider: 'missing',
    model: null,
  });

  assert.equal(serviceSelected?.code, 'service_image');

  const globalSelected = selectCreditConsumePolicyRecord(records, {
    serviceType: 'missing',
    provider: 'missing',
    model: null,
  });

  assert.equal(globalSelected?.code, 'global_default');
}

run();
console.log('credit consume policy selection tests passed');
