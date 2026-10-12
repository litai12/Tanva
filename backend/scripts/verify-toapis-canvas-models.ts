import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { CreditsService } from '../src/credits/credits.service';
import { NodeConfigService } from '../src/admin/services/node-config.service';
import { DEFAULT_MODEL_PROVIDER_MAPPING_V2, ModelRoutingService } from '../src/ai/services/model-routing.service';
import { ImageTaskService } from '../src/ai/services/image-task.service';
import { AiController } from '../src/ai/ai.controller';
import { resolveManagedVendorPricingV2 } from '../src/ai/services/model-pricing-resolver';
import { AIProviderFactory } from '../src/ai/ai-provider.factory';
import { TOAPIS_NEW_IMAGE_MODELS, TOAPIS_VIP_IMAGE_CREDITS, normalizeToapisImageRequest } from '../src/ai/services/toapis-image-models';

async function main() {
  const service: any = Object.create(CreditsService.prototype);
  service.logger = new Logger('ToapisCanvasVerification');
  service.resolveServicePricing = async () => ({ creditsPerCall: 999, serviceName: 'test', provider: 'new-api' });
  service.resolveManagedRoutePricing = async () => ({ price: { credits: 777, priceYuan: 7.77 }, vendorKey: 'new_api' });
  let cases = 0;
  for (const model of TOAPIS_NEW_IMAGE_MODELS) {
    const matrix = model.endsWith('-vip') ? TOAPIS_VIP_IMAGE_CREDITS : { high: model.endsWith('-official') ? { '1K': 30, '2K': 60, '4K': 90 } : { '1K': 20, '2K': 30, '4K': 40 } };
    for (const [quality, prices] of Object.entries(matrix)) {
      for (const [imageSize, expected] of Object.entries(prices)) {
        for (const route of ['normal', 'stable', 'ultra']) {
          const serviceType = model.endsWith('-vip') ? 'gpt-image-2' : 'gemini-3.1-image';
          const modelConfig = DEFAULT_MODEL_PROVIDER_MAPPING_V2.models!.find(item => item.modelKey === model)!;
          assert.equal((await resolveManagedVendorPricingV2(modelConfig.vendors![0], { quality, imageSize })).price?.credits, expected, 'public pricing catalog matrix');
          const executionExpected = model === 'gemini-nano-banana-2.1' && route === 'stable' ? { '1K': 30, '2K': 60, '4K': 90 }[imageSize as '1K' | '2K' | '4K'] : expected;
          const requestParams = { quality, imageSize, bananaImageRoute: route, referenceImageCount: 14 };
          // Covers the effective quotation used by preview, personal precharge,
          // team reserve and terminal exact settlement. Top-level model is deliberately
          // omitted from requestParams to exercise sync admission's original shape.
          const quote = await service.resolveEffectiveCreditsQuote({ serviceType, model, requestParams, inputImageCount: 14, outputImageCount: 1 });
          assert.equal(quote.creditsToDeduct, executionExpected, `${model}/${quality}/${imageSize}/${route}`);
          assert.equal(quote.effectiveRequestParams.model, model);
          const asyncQuote = await service.resolveEffectiveCreditsQuote({ serviceType, requestParams: { ...requestParams, model }, inputImageCount: 14, outputImageCount: 1 });
          assert.equal(asyncQuote.creditsToDeduct, executionExpected);
          cases++;
        }
      }
    }
  }
  assert.equal((await service.resolveEffectiveCreditsQuote({ serviceType: 'gpt-image-2', model: 'gpt-image-2.5-flare-vip', requestParams: { imageSize: '2K' } })).creditsToDeduct, 60);

  let savedModels: any[] = DEFAULT_MODEL_PROVIDER_MAPPING_V2.models!.filter(model => model.modelKey === 'gpt-image-2');
  let rows: any[] = [];
  const prisma: any = { systemSetting: { findUnique: async () => ({ value: JSON.stringify({ version: 'v2', models: savedModels }) }) }, nodeConfig: { findMany: async () => rows } };
  const nodes = new NodeConfigService(prisma);
  const routing = new ModelRoutingService(prisma);
  rows = (await (nodes as any).getDefaultConfigs()).filter((node: any) => ['nano2', 'gptImage25'].includes(node.nodeKey));
  const nano = (await nodes.getAllNodeConfigs()).find(node => node.nodeKey === 'nano2')!;
  assert.deepEqual(nano.metadata?.supportedModels, ['gemini-3.1-flash-image-preview', 'gemini-nano-banana-2.1', 'gemini-nano-banana-2.1-official']);
  assert.equal(nano.nameZh, 'Nano Banana 2.1');
  assert.equal(nano.creditsPerCall, 20);
  assert.equal(nano.metadata?.model, 'gemini-nano-banana-2.1');
  assert.equal(nano.metadata?.defaultData.model, 'gemini-nano-banana-2.1');
  assert.equal(nano.metadata?.managedModelKey, 'gemini-nano-banana-2.1');
  assert.equal(nano.metadata?.showModelSelector, false);
  assert.deepEqual(nano.metadata?.modelKeys, ['gemini-nano-banana-2.1', 'gemini-nano-banana-2.1-official']);
  assert.deepEqual(nano.metadata?.modelsByRoute, { normal: 'gemini-nano-banana-2.1', stable: 'gemini-nano-banana-2.1-official' });
  assert.deepEqual(nano.metadata?.resolutions, ['1K', '2K', '4K']);
  assert.equal(nano.metadata?.managedRoutesByModel['gemini-nano-banana-2.1'].modelKey, 'gemini-nano-banana-2.1');
  // Existing production settings contain the previous retail matrices. All
  // read paths and startup persistence must upgrade prices without re-enabling.
  savedModels = DEFAULT_MODEL_PROVIDER_MAPPING_V2.models!.filter(model => model.modelKey.startsWith('gemini-nano-banana-2.1')).map(model => ({
    ...model,
    vendors: model.vendors!.map(vendor => ({ ...vendor, creditsPerCall: model.modelKey.endsWith('-official') ? 90 : 30, priceYuan: model.modelKey.endsWith('-official') ? 0.9 : 0.3, pricing: { ...vendor.pricing, evaluators: { 'toapis-image-matrix': { type: 'lookup_matrix', axes: ['imageSize'], matrix: model.modelKey.endsWith('-official') ? { '1K': 0.9, '2K': 1.2, '4K': 1.5 } : { '1K': 0.3, '2K': 0.4, '4K': 0.5 } } } } })),
  }));
  assert.equal((await nodes.getAllNodeConfigs()).find(node => node.nodeKey === 'nano2')?.creditsPerCall, 20, 'saved catalog vendor price must upgrade');
  const upgradedRouting = await routing.getParsedConfig();
  for (const model of upgradedRouting.models!.filter(model => model.modelKey.startsWith('gemini-nano-banana-2.1'))) {
    const official = model.modelKey.endsWith('-official');
    assert.equal(model.vendors![0].creditsPerCall, official ? 30 : 20);
    assert.equal((await resolveManagedVendorPricingV2(model.vendors![0], { imageSize: '2K' })).price?.credits, official ? 60 : 30);
  }
  const storedPricing: any = Object.create(CreditsService.prototype);
  storedPricing.logger = service.logger;
  storedPricing.prisma = prisma;
  assert.equal((await storedPricing.resolveManagedRoutePricing({ managedModelKey: 'gemini-nano-banana-2.1', vendorKey: 'new_api', imageSize: '2K' })).price.credits, 30);
  assert.equal((await storedPricing.resolveManagedRoutePricing({ managedModelKey: 'gemini-nano-banana-2.1-official', vendorKey: 'new_api', imageSize: '2K' })).price.credits, 60);
  savedModels = savedModels.map(model => ({ ...model, enabled: false, vendors: model.vendors.map((vendor: any) => ({ ...vendor, enabled: false })) }));
  let persisted = 0;
  prisma.systemSetting.updateMany = async (args: any) => {
    assert.equal(args.where.value, JSON.stringify({ version: 'v2', models: savedModels }), 'startup pricing migration must compare the original setting');
    persisted++;
    savedModels = JSON.parse(args.data.value).models;
    return { count: 1 };
  };
  await (nodes as any).syncNano21ModelPricing();
  assert.equal(persisted, 1);
  for (const model of savedModels) {
    assert.equal(model.enabled, false);
    assert.equal(model.vendors[0].enabled, false);
    assert.equal(model.vendors[0].creditsPerCall, model.modelKey.endsWith('-official') ? 30 : 20);
  }
  await (nodes as any).syncNano21ModelPricing();
  assert.equal(persisted, 1, 'pricing migration must be idempotent');
  savedModels = DEFAULT_MODEL_PROVIDER_MAPPING_V2.models!.filter(model => model.modelKey === 'gpt-image-2');
  rows = rows.map(row => row.nodeKey === 'nano2' ? { ...row, nameZh: 'Nano Banana 2', creditsPerCall: 40, metadata: { model: 'gemini-3.1-flash-image-preview', managedModelKey: 'gemini-3.1-image', modelKeys: ['gemini-3.1-image'], defaultData: { model: 'gemini-3.1-flash-image-preview' }, resolutions: ['0.5K', '1K'] } } : row);
  const upgradedNano = (await nodes.getAllNodeConfigs()).find(node => node.nodeKey === 'nano2')!;
  assert.equal(upgradedNano.metadata?.defaultData.model, 'gemini-nano-banana-2.1');
  assert.equal(upgradedNano.nameZh, 'Nano Banana 2.1');
  assert.equal(upgradedNano.creditsPerCall, 20);
  for (const model of TOAPIS_NEW_IMAGE_MODELS) assert.ok((await routing.getParsedConfig()).models?.some(item => item.modelKey === model));
  savedModels.push(...TOAPIS_NEW_IMAGE_MODELS.map(key => ({ ...DEFAULT_MODEL_PROVIDER_MAPPING_V2.models!.find(item => item.modelKey === key)!, enabled: false })));
  assert.equal((await nodes.getAllNodeConfigs()).some(node => node.nodeKey === 'nano2'), false, '2.1 disabled must hide its independent entry without falling back to old Nano2');
  for (const model of TOAPIS_NEW_IMAGE_MODELS) assert.equal((await routing.getParsedConfig()).models?.find(item => item.modelKey === model)?.enabled, false);
  savedModels = DEFAULT_MODEL_PROVIDER_MAPPING_V2.models!.filter(model => TOAPIS_NEW_IMAGE_MODELS.includes(model.modelKey)).map(model => ({ ...model, vendors: model.vendors!.map(vendor => ({ ...vendor, enabled: false })) }));
  assert.equal((await nodes.getAllNodeConfigs()).some(node => node.nodeKey === 'nano2'), false, '2.1 vendor disabled must hide only its independent entry');
  const vipNode = (await nodes.getAllNodeConfigs()).find(node => node.nodeKey === 'gptImage25')!;
  assert.deepEqual(vipNode.metadata?.supportedModels, ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']);
  for (const model of TOAPIS_NEW_IMAGE_MODELS) assert.equal((await routing.getParsedConfig()).models?.find(item => item.modelKey === model)?.vendors?.[0]?.enabled, false);
  const controller: any = Object.create(AiController.prototype);
  controller.modelRoutingService = routing;
  await controller.prepareToapisImageRequest({ model: 'gemini-3.1-flash-image-preview' }, 'gemini-3.1-flash-image-preview', 0);
  controller.logger = new Logger('NanoLegacyIdentity');
  assert.equal(controller.resolveImageModel('nano2', 'gemini-3.1-flash-image-preview'), 'gemini-3.1-flash-image-preview');
  await assert.rejects(() => controller.prepareToapisImageRequest({ model: TOAPIS_NEW_IMAGE_MODELS[0] }, TOAPIS_NEW_IMAGE_MODELS[0], 0), /已下线/);
  const params = controller.buildCreditRequestParams('nano2', { model: 'gpt-image-2.5-flare-vip' }, { banana: { imageRoute: 'stable' } });
  assert.equal(params.channelHint, 'toapis');
  assert.equal(params.bananaImageRoute, 'normal');
  assert.equal(controller.getImageGenerationServiceType('gemini-nano-banana-2.1', 'nano2'), 'gemini-3.1-image');
  const tasks: any = Object.create(ImageTaskService.prototype);
  assert.equal(tasks.resolveBananaImageRouteFromTaskRequestData({ model: 'gemini-nano-banana-2.1', providerOptions: { banana: { imageRoute: 'stable' } } }), 'stable');
  assert.equal(tasks.resolveBananaImageRouteFromTaskRequestData({ model: 'gemini-nano-banana-2.1-official', providerOptions: { banana: { imageRoute: 'normal' } } }), 'stable');
  const refs = Array.from({ length: 14 }, (_, i) => `https://assets.example.test/${i}.png`);
  let submitted: any;
  tasks.providerFactory = { getProvider: () => ({ generateImage: async (request: any) => { submitted = request; return { success: true, data: { imageUrl: refs[0] } }; } }) };
  tasks.oss = { withImageResize: () => { throw new Error('Nano2.1 original URL must remain intact'); } };
  await tasks.runGenerateTask({ prompt: 'test', aiProvider: 'nano2' }, { imageUrls: refs, imageSize: '4K' }, 'gemini-nano-banana-2.1');
  assert.deepEqual(submitted.imageUrls, refs);
  await tasks.runGenerateTask({ prompt: 'test', aiProvider: 'nano2' }, { imageUrls: refs, imageSize: '4K' }, 'gemini-nano-banana-2.1-official');
  assert.equal(submitted.model, 'gemini-nano-banana-2.1-official');
  assert.deepEqual(submitted.imageUrls, refs);
  assert.equal(controller.resolveImageModel('nano2', 'gemini-nano-banana-2.1', { banana: { imageRoute: 'stable' } }), 'gemini-nano-banana-2.1-official');
  assert.equal(controller.resolveImageModel('nano2', 'gemini-nano-banana-2.1-official', { banana: { imageRoute: 'normal' } }), 'gemini-nano-banana-2.1-official');
  const officialParams = controller.buildCreditRequestParams('nano2', { model: 'gemini-nano-banana-2.1-official' }, { banana: { imageRoute: 'normal' } });
  assert.equal(officialParams.channelHint, 'toapis');
  assert.equal(officialParams.bananaImageRoute, 'stable');
  assert.equal(controller.getImageGenerationServiceType('gemini-nano-banana-2.1-official', 'nano2'), 'gemini-3.1-image');
  savedModels = DEFAULT_MODEL_PROVIDER_MAPPING_V2.models!.filter(model => TOAPIS_NEW_IMAGE_MODELS.includes(model.modelKey)).map(model => ({ ...model, enabled: model.modelKey !== 'gemini-nano-banana-2.1' }));
  const officialOnly = (await nodes.getAllNodeConfigs()).find(node => node.nodeKey === 'nano2')!;
  assert.ok(officialOnly);
  assert.equal(officialOnly.metadata?.defaultData.model, 'gemini-nano-banana-2.1');
  assert.deepEqual(officialOnly.metadata?.modelKeys, ['gemini-nano-banana-2.1-official']);
  assert.equal(officialOnly.metadata?.managedRoutesByModel['gemini-nano-banana-2.1'], undefined);
  assert.equal(officialOnly.metadata?.managedRoutesByModel['gemini-nano-banana-2.1-official'].modelKey, 'gemini-nano-banana-2.1-official');
  await assert.rejects(() => controller.prepareToapisImageRequest({ model: 'gemini-nano-banana-2.1' }, 'gemini-nano-banana-2.1', 0), /已下线/);
  await controller.prepareToapisImageRequest({ model: 'gemini-nano-banana-2.1-official' }, 'gemini-nano-banana-2.1-official', 0);
  const factory: any = Object.create(AIProviderFactory.prototype);
  const gateway = {};
  factory.providers = new Map([['new-api', gateway], ['gemini', {}]]);
  factory.config = { get: () => 'legacy' };
  for (const model of TOAPIS_NEW_IMAGE_MODELS) assert.equal(factory.getProvider(model, 'gemini'), gateway);
  for (const imageSize of ['0.5K', '512', '8K']) assert.throws(() => normalizeToapisImageRequest({ model: 'gemini-nano-banana-2.1', imageSize }), /1K/);
  assert.throws(() => normalizeToapisImageRequest({ model: 'gemini-nano-banana-2.1' }, 15), /14/);
  assert.throws(() => normalizeToapisImageRequest({ model: 'gpt-image-2.5-flare-vip', aspectRatio: '2:1' }), /比例/);
  assert.throws(() => normalizeToapisImageRequest({ model: 'gpt-image-2.5-flare-vip', batchMode: true, batchCount: 2 }), /单图/);
  console.log(`ToAPIs canvas models: ${cases} effective sync/async pricing cases, catalog upgrade/disable, routing and original references passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
