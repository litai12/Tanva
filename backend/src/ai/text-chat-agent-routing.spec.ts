import assert from 'node:assert/strict';
import { AiController } from './ai.controller';

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
};

type BillingCall = {
  serviceType: string;
  model: string;
};

async function main(): Promise<void> {
  const providerCalls: ProviderCall[] = [];
  const billingCalls: BillingCall[] = [];
  const controller = Object.create(AiController.prototype) as object;

  Object.assign(controller, {
    logger: { debug: () => undefined },
    factory: {
      getProvider: (gatewayModel: string, providerName: string) => ({
        generateText: async (request: { model: string }) => {
          providerCalls.push({
            gatewayModel,
            providerName,
            requestModel: request.model,
          });
          return { success: true, data: { text: 'terminal text' } };
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

  const harness = controller as unknown as TextChatHarness;
  const textChatResult = await harness.textChat(
    {
      prompt: 'Text Chat shares the prompt optimizer gateway',
      model: 'deepseek-v4-flash',
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
  assert.deepEqual(providerCalls[0], {
    gatewayModel: 'xiaot-agent-deepseek-v4-flash',
    providerName: 'new-api',
    requestModel: 'xiaot-agent-deepseek-v4-flash',
  });
  assert.deepEqual(billingCalls[0], {
    serviceType: 'gemini-text',
    model: 'deepseek-v4-flash',
  });

  await harness.textChat(
    {
      prompt: 'Prompt Optimizer uses the same gateway',
      model: 'gpt-5.6-terra',
      aiProvider: 'midjourney',
      billingTag: 'prompt_optimize',
      enableWebSearch: false,
    },
    {},
  );
  assert.deepEqual(providerCalls[1], {
    gatewayModel: 'xiaot-agent-gpt-5-6-terra',
    providerName: 'new-api',
    requestModel: 'xiaot-agent-gpt-5-6-terra',
  });
  assert.deepEqual(billingCalls[1], {
    serviceType: 'gemini-prompt-optimize',
    model: 'gpt-5.6-terra',
  });

  console.log('Text Chat and Prompt Optimizer unified agent gateway: ok');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
