import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { AiController } from './ai.controller';
import { NewApiProvider } from './providers/new-api.provider';

type TextChatHarness = {
  textChat(
    dto: {
      prompt: string;
      model: string;
      billingTag: 'prompt_optimize';
    },
    req: unknown,
  ): Promise<unknown>;
};

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let committed = false;
  let rolledBack = false;
  let usageMarkedFailed = false;
  let refunded = false;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          message: 'openai_error',
          type: 'bad_response_status_code',
          code: 'bad_response_status_code',
        },
      }),
      { status: 202, headers: { 'content-type': 'application/json' } },
    );

  try {
    const provider = new NewApiProvider(
      new ConfigService({
        NEW_API_BASE_URL: 'https://new-api.test',
        NEW_API_KEY: 'test-key',
      }),
    );
    await provider.initialize();

    const controller = Object.create(AiController.prototype) as object;
    Object.assign(controller, {
      logger: {
        debug: () => undefined,
        error: () => undefined,
        warn: () => undefined,
      },
      factory: {
        getProvider: () => provider,
      },
      getUserId: () => 'user-test',
      getTeamId: () => undefined,
      extractIdempotencyKey: () => undefined,
      summarizeError: (error: unknown) =>
        error instanceof Error ? error.message : String(error),
      isPrismaPoolTimeoutError: () => false,
      isRateLimitOrQuotaError: () => false,
      mapUpstreamErrorToHttpException: () => null,
      creditsService: {
        getOrCreateAccount: async () => undefined,
        markApiUsageFailedForUser: async () => {
          usageMarkedFailed = true;
        },
        refundCredits: async () => {
          refunded = true;
        },
      },
      creditCharge: {
        begin: async () => ({
          apiUsageId: 'usage-test',
          teamFunded: false,
        }),
        commit: async () => {
          committed = true;
        },
        rollback: async (
          _handle: unknown,
          options: { personalRefund: () => Promise<void> },
        ) => {
          rolledBack = true;
          await options.personalRefund();
        },
      },
    });

    const harness = controller as unknown as TextChatHarness;
    await assert.rejects(
      () =>
        harness.textChat(
          {
            prompt: '优化这段提示词',
            model: 'deepseek-v4-flash',
            billingTag: 'prompt_optimize',
          },
          { user: { id: 'user-test' }, headers: {} },
        ),
      /new-api HTTP 202: openai_error/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(committed, false, 'empty terminal text must never commit billing');
  assert.equal(rolledBack, true, 'empty terminal text must roll back the charge');
  assert.equal(usageMarkedFailed, true, 'usage must be marked failed before refund');
  assert.equal(refunded, true, 'personal credits must be refunded');

  console.log('text-chat HTTP 202 terminal billing rollback: ok');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
