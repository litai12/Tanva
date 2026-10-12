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
    const matrix = model.endsWith('-vip') ? TOAPIS_VIP_IMAGE_CREDITS : { high: { '1K': 30, '2K': 40, '4K': 50 } };
    for (const [quality, prices] of Object.entries(matrix)) {
      for (const [imageSize, expected] of Object.entries(prices)) {
        for (const route of ['normal', 'stable', 'ultra']) {
          const serviceType = model.endsWith('-vip') ? 'gpt-image-2' : 'gemini-3.1-image';
          const modelConfig = DEFAULT_MODEL_PROVIDER_MAPPING_V2.models!.find(item => item.modelKey === model)!;
          assert.equal((await resolveManagedVendorPricingV2(modelConfig.vendors![0], { quality, imageSize })).price?.credits, expected, 'public pricing catalog matrix');
          const requestParams = { quality, imageSize, bananaImageRoute: route, referenceImageCount: 14 };
          // Covers the effective quotation used by preview, personal precharge,
          // team reserve and terminal exact settlement. Top-level model is deliberately
          // omitted from requestParams to exercise sync admission's original shape.
          const quote = await service.resolveEffectiveCreditsQuote({ serviceType, model, requestParams, inputImageCount: 14, outputImageCount: 1 });
          assert.equal(quote.creditsToDeduct, expected, `${model}/${quality}/${imageSize}/${route}`);
          assert.equal(quote.effectiveRequestParams.model, model);
          const asyncQuote = await service.resolveEffectiveCreditsQuote({ serviceType, requestParams: { ...requestParams, model }, inputImageCount: 14, outputImageCount: 1 });
          assert.equal(asyncQuote.creditsToDeduct, expected);
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
  assert.deepEqual(nano.metadata?.supportedModels, ['gemini-3.1-flash-image-preview', 'gemini-nano-banana-2.1']);
  assert.equal(nano.metadata?.managedRoutesByModel['gemini-nano-banana-2.1'].modelKey, 'gemini-nano-banana-2.1');
  for (const model of TOAPIS_NEW_IMAGE_MODELS) assert.ok((await routing.getParsedConfig()).models?.some(item => item.modelKey === model));
  savedModels.push(...TOAPIS_NEW_IMAGE_MODELS.map(key => ({ ...DEFAULT_MODEL_PROVIDER_MAPPING_V2.models!.find(item => item.modelKey === key)!, enabled: false })));
  const disabledNano = (await nodes.getAllNodeConfigs()).find(node => node.nodeKey === 'nano2')!;
  assert.deepEqual(disabledNano.metadata?.supportedModels, ['gemini-3.1-flash-image-preview']);
  for (const model of TOAPIS_NEW_IMAGE_MODELS) assert.equal((await routing.getParsedConfig()).models?.find(item => item.modelKey === model)?.enabled, false);
  savedModels = DEFAULT_MODEL_PROVIDER_MAPPING_V2.models!.filter(model => TOAPIS_NEW_IMAGE_MODELS.includes(model.modelKey)).map(model => ({ ...model, vendors: model.vendors!.map(vendor => ({ ...vendor, enabled: false })) }));
  assert.deepEqual((await nodes.getAllNodeConfigs()).find(node => node.nodeKey === 'nano2')!.metadata?.supportedModels, ['gemini-3.1-flash-image-preview']);
  const vipNode = (await nodes.getAllNodeConfigs()).find(node => node.nodeKey === 'gptImage25')!;
  assert.deepEqual(vipNode.metadata?.supportedModels, ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']);
  for (const model of TOAPIS_NEW_IMAGE_MODELS) assert.equal((await routing.getParsedConfig()).models?.find(item => item.modelKey === model)?.vendors?.[0]?.enabled, false);
  const controller: any = Object.create(AiController.prototype);
  controller.modelRoutingService = routing;
  await assert.rejects(() => controller.prepareToapisImageRequest({ model: TOAPIS_NEW_IMAGE_MODELS[0] }, TOAPIS_NEW_IMAGE_MODELS[0], 0), /已下线/);
  const params = controller.buildCreditRequestParams('nano2', { model: 'gpt-image-2.5-flare-vip' }, { banana: { imageRoute: 'stable' } });
  assert.equal(params.channelHint, 'toapis');
  assert.equal(params.bananaImageRoute, 'normal');
  assert.equal(controller.getImageGenerationServiceType('gemini-nano-banana-2.1', 'nano2'), 'gemini-3.1-image');
  const tasks: any = Object.create(ImageTaskService.prototype);
  assert.equal(tasks.resolveBananaImageRouteFromTaskRequestData({ model: 'gemini-nano-banana-2.1', providerOptions: { banana: { imageRoute: 'stable' } } }), 'normal');
  const refs = Array.from({ length: 14 }, (_, i) => `https://assets.example.test/${i}.png`);
  let submitted: any;
  tasks.providerFactory = { getProvider: () => ({ generateImage: async (request: any) => { submitted = request; return { success: true, data: { imageUrl: refs[0] } }; } }) };
  tasks.oss = { withImageResize: () => { throw new Error('Nano2.1 original URL must remain intact'); } };
  await tasks.runGenerateTask({ prompt: 'test', aiProvider: 'nano2' }, { imageUrls: refs, imageSize: '4K' }, 'gemini-nano-banana-2.1');
  assert.deepEqual(submitted.imageUrls, refs);
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
