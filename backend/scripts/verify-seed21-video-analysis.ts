import assert from 'node:assert/strict';
import { AiController } from '../src/ai/ai.controller';
import { CreditsService } from '../src/credits/credits.service';
import { NodeConfigService } from '../src/admin/services/node-config.service';
import { calculateDoubaoSeedVideoAnalysisDurationBilling } from '../src/ai/services/doubao-seed-video-analysis-pricing';

const controller = Object.create(AiController.prototype) as any;
assert.equal(controller.resolveVideoAnalysisModel(undefined), 'doubao-seed-2-1-lite-260915');
for (const [alias, model] of [
  ['doubao-seed-2-1-pro', 'doubao-seed-2-1-pro-260915'],
  ['doubao-seed-2-1-lite', 'doubao-seed-2-1-lite-260915'],
  ['doubao-seed-2-1-turbo', 'doubao-seed-2-1-turbo-260628'],
] as const) {
  assert.equal(controller.resolveVideoAnalysisModel(alias), model);
  assert.equal(controller.resolveVideoAnalysisModel(model), model);
}
assert.throws(() => controller.resolveVideoAnalysisModel('doubao-seed-2-1-mini-260915'), /不支持/);

const credits = Object.create(CreditsService.prototype) as any;
for (const [model, tenSecondCredits] of [
  ['doubao-seed-2-1-pro-260915', 417], ['doubao-seed-2-1-lite-260915', 125], ['doubao-seed-2-1-turbo-260628', 63],
  ['doubao-seed-2-0-pro-260215', 417], ['doubao-seed-2-0-lite-260428', 125], ['doubao-seed-2-0-mini-260428', 63],
] as const) {
  assert.equal(controller.resolveVideoAnalysisModel(model), model, 'an exact legacy ID must not silently upgrade');
  for (const durationSec of [1, 10, 72.585]) {
    const preview = credits.resolveVideoAnalyzeRouteCredits('gemini-video-analyze', 999, { durationSec }, model);
    const billing = calculateDoubaoSeedVideoAnalysisDurationBilling(model, durationSec);
    assert.equal(preview, billing.creditsCharged, `${model}: preview and execution price must agree`);
    if (durationSec === 10) assert.equal(preview, tenSecondCredits);
  }
}

const catalog = Object.create(NodeConfigService.prototype) as any;
const nodeConfig = catalog.normalizeNodeConfigOutput({ nodeKey: 'videoAnalyze', status: 'maintenance' });
assert.match(nodeConfig.description, /Seed 2\.1 Pro\/Lite\/Turbo/);
assert.equal(nodeConfig.status, 'maintenance');
console.log('Seed 2.1 video analysis model, preview and legacy compatibility verified');
