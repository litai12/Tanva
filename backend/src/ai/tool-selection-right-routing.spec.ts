import assert from 'node:assert/strict';
import { AiController } from './ai.controller';

type ToolSelectionInput = {
  prompt: string;
  model?: string;
  aiProvider?: string;
  hasImages?: boolean;
  imageCount?: number;
  availableTools?: string[];
  providerOptions?: Record<string, unknown>;
};

type ToolSelectionHarness = {
  toolSelection(dto: ToolSelectionInput, req: unknown): Promise<unknown>;
};

type ProviderCall = {
  gatewayModel: string;
  providerName: string;
  request: Record<string, unknown>;
};

type BillingCall = {
  serviceType: string;
  model: string;
};

function createHarness() {
  const providerCalls: ProviderCall[] = [];
  const billingCalls: BillingCall[] = [];
  const controller = Object.create(AiController.prototype) as object;

  Object.assign(controller, {
    logger: {
      log: () => undefined,
      warn: () => undefined,
      debug: () => undefined,
    },
    factory: {
      getProvider: (gatewayModel: string, providerName: string) => ({
        selectTool: async (request: Record<string, unknown>) => {
          providerCalls.push({ gatewayModel, providerName, request });
          return {
            success: true,
            data: {
              selectedTool: 'editImage',
              reasoning: 'image edit intent',
              confidence: 0.98,
            },
          };
        },
      }),
    },
    buildCreditRequestParams: () => ({}),
    withCredits: async (
      _req: unknown,
      serviceType: string,
      model: string,
      operation: () => Promise<unknown>,
    ) => {
      billingCalls.push({ serviceType, model });
      return operation();
    },
  });

  return {
    harness: controller as unknown as ToolSelectionHarness,
    providerCalls,
    billingCalls,
  };
}

async function main(): Promise<void> {
  const local = createHarness();
  const localResult = await local.harness.toolSelection(
    {
      prompt: '用这张图设计一张新图',
      model: 'gpt-5.4',
      aiProvider: 'banana-2.5',
      hasImages: true,
      imageCount: 1,
      availableTools: ['editImage'],
    },
    {},
  );
  assert.deepEqual(localResult, {
    selectedTool: 'editImage',
    parameters: { prompt: '用这张图设计一张新图' },
    reasoning: 'Only one tool is available; selected locally',
    confidence: 1,
  });
  assert.equal(local.providerCalls.length, 0);
  assert.equal(local.billingCalls.length, 0);

  const terra = createHarness();
  const terraResult = await terra.harness.toolSelection(
    {
      prompt: '判断是编辑图片还是分析图片',
      model: 'gpt-5.4',
      aiProvider: 'banana-2.5',
      hasImages: true,
      imageCount: 1,
      availableTools: ['editImage', 'analyzeImage'],
      providerOptions: {
        banana: { imageRoute: 'stable' },
      },
    },
    {},
  );
  assert.deepEqual(terraResult, {
    selectedTool: 'editImage',
    parameters: { prompt: '判断是编辑图片还是分析图片' },
    reasoning: 'image edit intent',
    confidence: 0.98,
  });
  assert.deepEqual(terra.billingCalls, [
    { serviceType: 'gemini-tool-selection', model: 'gpt-5.6-terra' },
  ]);
  assert.equal(terra.providerCalls[0]?.gatewayModel, 'tanvas-right-gpt-5.6-terra');
  assert.equal(terra.providerCalls[0]?.providerName, 'new-api');
  assert.equal(
    terra.providerCalls[0]?.request.model,
    'tanvas-right-gpt-5.6-terra',
  );
  assert.equal(terra.providerCalls[0]?.request.providerOptions, undefined);

  const luna = createHarness();
  await luna.harness.toolSelection(
    {
      prompt: 'use the explicitly selected Luna route',
      model: 'gpt-5.6-luna',
      availableTools: ['editImage', 'analyzeImage'],
    },
    {},
  );
  assert.equal(luna.providerCalls[0]?.gatewayModel, 'tanvas-right-gpt-5.6-luna');
  assert.deepEqual(luna.billingCalls, [
    { serviceType: 'gemini-tool-selection', model: 'gpt-5.6-luna' },
  ]);

  console.log('tool selection local short-circuit and direct Right routing: ok');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
