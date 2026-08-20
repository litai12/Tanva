import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { AgentRuntimeService } from '../src/agent/agent-runtime.service';
import { VolcResearchSearchService } from '../src/agent/volc-research-search.service';
import { AIProviderFactory } from '../src/ai/ai-provider.factory';
import { XiaotAgentService } from '../src/agent/xiaot-agent.service';

const service = new AgentRuntimeService(
  null as unknown as VolcResearchSearchService,
  null as unknown as AIProviderFactory,
  new ConfigService({}),
  null as unknown as XiaotAgentService,
);

const run = service.createRun(
  {
    prompt:
      '参考图1的构图和内容，给图2礼盒生成一张手提礼盒的展示图，背景是图2的类似红色渐变的感觉',
    manualMode: 'auto',
    availableTools: ['blendImages', 'analyzeImage'],
    hasImages: true,
    imageCount: 2,
    enableWebSearch: true,
  },
  'routing-verifier',
);

assert.equal(run.intent, 'blend_images');
assert.equal(run.workflow, 'image_blend');
assert.equal(run.selectedTool, 'blendImages');

console.log('agent reference-image routing verification passed');
