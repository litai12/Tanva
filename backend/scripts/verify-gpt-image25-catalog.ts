import assert from 'node:assert/strict';
import { NodeConfigService } from '../src/admin/services/node-config.service';
import { DEFAULT_MODEL_PROVIDER_MAPPING_V2, ModelRoutingService } from '../src/ai/services/model-routing.service';

async function main() {
  const defaults = DEFAULT_MODEL_PROVIDER_MAPPING_V2.models;
  const variants = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5'];
  let savedModels = defaults.filter((model) => model.modelKey === 'gpt-image-2');
  let rows: any[] = [];
  const prisma = {
    systemSetting: { findUnique: async () => ({ value: JSON.stringify({ version: 'v2', models: savedModels }) }) },
    nodeConfig: { findMany: async () => rows },
  };
  const nodes = new NodeConfigService(prisma as any);
  const routing = new ModelRoutingService(prisma as any);
  rows = (await (nodes as any).getDefaultConfigs()).filter((node: any) => ['gptImage2', 'gptImage25'].includes(node.nodeKey));

  const publicNodes = await nodes.getAllNodeConfigs();
  assert.deepEqual(publicNodes.map((node) => node.nodeKey), ['gptImage2', 'gptImage25']);
  const unified = publicNodes.find((node) => node.nodeKey === 'gptImage25')!;
  assert.deepEqual(unified.metadata?.supportedModels, ["gpt-image-2.5"]);
  assert.equal(unified.metadata?.defaultData.model, "gpt-image-2.5");
  assert.equal(unified.metadata?.defaultData.quality, "max");
  assert.equal(unified.metadata?.maxReferenceImages, 1);
  const parsed = await routing.getParsedConfig();
  for (const modelKey of variants) assert.ok(parsed.models.some((model) => model.modelKey === modelKey));

  // Saved administrative disable flags must win over code defaults.
  const disabledFlare = { ...defaults.find((model) => model.modelKey === variants[0])!, enabled: false };
  savedModels = [...savedModels, disabledFlare];
  const sunburstOnly = (await nodes.getAllNodeConfigs()).find((node) => node.nodeKey === 'gptImage25')!;
  assert.deepEqual(sunburstOnly.metadata?.supportedModels, ["gpt-image-2.5"]);
  assert.equal(sunburstOnly.metadata?.defaultData.model, "gpt-image-2.5");
  assert.equal((await routing.getParsedConfig()).models.find((model) => model.modelKey === variants[0])?.enabled, false);

  savedModels.push({ ...defaults.find((model) => model.modelKey === variants[1])!, enabled: false });
  savedModels.push({ ...defaults.find((model) => model.modelKey === variants[2])!, enabled: false });
  assert.equal((await nodes.getAllNodeConfigs()).some((node) => node.nodeKey === 'gptImage25'), false);
  console.log('GPT Image 2.5 existing-database catalog upgrade and explicit-disable checks passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
