import assert from 'node:assert/strict';
import { AiController } from './ai.controller';
import { parseBusinessTextSafetyVerdict } from './business-text-safety.contract';

// Business Text Chat and Prompt Optimizer must remain isolated from xiaot-agent.

type TextChatInput = {
  prompt: string;
  model?: string;
  aiProvider?: string;
  billingTag?: 'text_chat' | 'prompt_optimize';
  enableWebSearch?: boolean;
};

type TextChatHarness = {
  textChat(dto: TextChatInput, req: unknown): Promise<unknown>;
};

type ProviderCall = {
  gatewayModel: string;
  providerName: string;
  requestModel: string;
  prompt: string;
  providerOptions?: unknown;
};

type BillingCall = {
  serviceType: string;
  model: string;
};

type HarnessSetup = {
  harness: TextChatHarness;
  providerCalls: ProviderCall[];
  billingCalls: BillingCall[];
};

function createHarness(safetyText: string): HarnessSetup {
  const providerCalls: ProviderCall[] = [];
  const billingCalls: BillingCall[] = [];
  const controller = Object.create(AiController.prototype) as object;

  Object.assign(controller, {
    logger: { debug: () => undefined },
    factory: {
      getProvider: (gatewayModel: string, providerName: string) => ({
        generateText: async (request: {
          model: string;
          prompt: string;
          providerOptions?: unknown;
        }) => {
          providerCalls.push({
            gatewayModel,
            providerName,
            requestModel: request.model,
            prompt: request.prompt,
            providerOptions: request.providerOptions,
          });
          return request.model === 'deepseek-v4-flash-260425'
            ? { success: true, data: { text: safetyText } }
            : { success: true, data: { text: 'terminal text' } };
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
    harness: controller as unknown as TextChatHarness,
    providerCalls,
    billingCalls,
  };
}

async function main(): Promise<void> {
  const allowed = createHarness(
    JSON.stringify({
      version: 1,
      allowed: true,
      politicalViolation: false,
      sensitiveTopic: false,
      reason: '普通创作请求',
    }),
  );
  const textChatResult = await allowed.harness.textChat(
    {
      prompt: 'Text Chat shares the prompt optimizer Right route',
      model: 'gpt-5.6-luna',
      aiProvider: 'banana-2.5',
      billingTag: 'text_chat',
      enableWebSearch: false,
    },
    {},
  );
  assert.deepEqual(textChatResult, {
    text: 'terminal text',
    webSearchResult: undefined,
    metadata: undefined,
  });
  assert.equal(allowed.providerCalls[0]?.gatewayModel, 'deepseek-v4-flash-260425');
  assert.equal(allowed.providerCalls[0]?.providerName, 'new-api');
  assert.equal(allowed.providerCalls[0]?.requestModel, 'deepseek-v4-flash-260425');
  assert.match(allowed.providerCalls[0]?.prompt || '', /待审核请求/);
  assert.deepEqual(allowed.providerCalls[1], {
    gatewayModel: 'tanvas-right-gpt-5.6-luna',
    providerName: 'new-api',
    requestModel: 'tanvas-right-gpt-5.6-luna',
    prompt: 'Text Chat shares the prompt optimizer Right route',
    providerOptions: undefined,
  });
  assert.deepEqual(allowed.billingCalls[0], {
    serviceType: 'gemini-text',
    model: 'gpt-5.6-luna',
  });

  await allowed.harness.textChat(
    {
      prompt: 'Prompt Optimizer uses the same direct Right route',
      model: 'gpt-5.6-terra',
      aiProvider: 'midjourney',
      billingTag: 'prompt_optimize',
      enableWebSearch: false,
    },
    {},
  );
  assert.equal(allowed.providerCalls[2]?.requestModel, 'deepseek-v4-flash-260425');
  assert.deepEqual(allowed.providerCalls[3], {
    gatewayModel: 'tanvas-right-gpt-5.6-terra',
    providerName: 'new-api',
    requestModel: 'tanvas-right-gpt-5.6-terra',
    prompt: 'Prompt Optimizer uses the same direct Right route',
    providerOptions: undefined,
  });
  assert.deepEqual(allowed.billingCalls[1], {
    serviceType: 'gemini-prompt-optimize',
    model: 'gpt-5.6-terra',
  });

  const rejected = createHarness(
    JSON.stringify({
      version: 1,
      allowed: false,
      politicalViolation: true,
      sensitiveTopic: false,
      reason: '涉及政治违规内容',
    }),
  );
  await assert.rejects(
    () =>
      rejected.harness.textChat(
        {
          prompt: 'rejected request',
          model: 'gpt-5.6-luna',
          billingTag: 'text_chat',
        },
        {},
      ),
    /内容未通过安全审核/,
  );
  assert.equal(rejected.providerCalls.length, 1);
  assert.equal(
    rejected.providerCalls[0]?.requestModel,
    'deepseek-v4-flash-260425',
  );

  const invalid = createHarness('not-json');
  await assert.rejects(
    () =>
      invalid.harness.textChat(
        {
          prompt: 'unverifiable request',
          model: 'gpt-5.6-terra',
          billingTag: 'prompt_optimize',
        },
        {},
      ),
    /DeepSeek safety gate returned invalid JSON/,
  );
  assert.equal(invalid.providerCalls.length, 1);

  assert.throws(
    () =>
      parseBusinessTextSafetyVerdict(
        JSON.stringify({
          version: 1,
          allowed: true,
          politicalViolation: true,
          sensitiveTopic: false,
          reason: 'inconsistent verdict',
        }),
      ),
    /internally inconsistent/,
  );
  assert.throws(
    () => parseBusinessTextSafetyVerdict('   '),
    /empty verdict/,
  );

  console.log('DeepSeek safety gate then direct Right routing: ok');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
