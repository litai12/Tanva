import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { NewApiProvider } from './new-api.provider';
import {
  requireTerminalTextResult,
  validateTerminalTextPayload,
} from '../text-terminal.contract';

type MockResponse = {
  status: number;
  body: unknown;
};

const originalFetch = globalThis.fetch;
const responses: MockResponse[] = [];

globalThis.fetch = async () => {
  const response = responses.shift();
  assert.ok(response, 'expected a queued mock response');
  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
};

function enqueue(status: number, body: unknown): void {
  responses.push({ status, body });
}

async function main(): Promise<void> {
  const provider = new NewApiProvider(
    new ConfigService({
      NEW_API_BASE_URL: 'https://new-api.test',
      NEW_API_KEY: 'test-key',
    }),
  );
  await provider.initialize();

  enqueue(200, { choices: [{ message: { content: '  terminal answer  ' } }] });
  const successfulChat = await provider.generateText({
    prompt: 'return a terminal answer',
    model: 'xiaot-agent-gpt-5-6-luna',
  });
  assert.equal(successfulChat.success, true);
  assert.equal(successfulChat.data?.text, 'terminal answer');

  enqueue(202, {
    error: {
      message: 'openai_error',
      type: 'bad_response_status_code',
      code: 'bad_response_status_code',
    },
  });
  const acceptedErrorEnvelope = await provider.generateText({
    prompt: 'must not become an empty success',
    model: 'xiaot-agent-deepseek-v4-flash',
  });
  assert.equal(acceptedErrorEnvelope.success, false);
  assert.match(acceptedErrorEnvelope.error?.message || '', /HTTP 202: openai_error/);

  enqueue(202, {
    id: 'chatcmpl-pending',
    object: 'chat.completion.pending',
    choices: [],
  });
  const pendingCompletion = await provider.generateText({
    prompt: 'pending is not terminal',
    model: 'xiaot-agent-gpt-5-6-terra',
  });
  assert.equal(pendingCompletion.success, false);
  assert.match(
    pendingCompletion.error?.message || '',
    /HTTP 202: synchronous text request did not return a terminal HTTP 200 response/,
  );

  enqueue(200, {
    error: {
      message: 'embedded_error',
      type: 'server_error',
    },
  });
  const embeddedError = await provider.generateText({
    prompt: 'error envelopes are failures at any status',
    model: 'gpt-5.6-luna',
  });
  assert.equal(embeddedError.success, false);
  assert.match(embeddedError.error?.message || '', /HTTP 200: embedded_error/);

  enqueue(200, { choices: [] });
  const emptyChat = await provider.generateText({
    prompt: 'empty choices are not success',
    model: 'gpt-5.4',
  });
  assert.equal(emptyChat.success, false);
  assert.match(emptyChat.error?.message || '', /missing assistant content/);

  enqueue(200, { output_text: '  searched answer  ' });
  const successfulResponse = await provider.generateText({
    prompt: 'search the web',
    model: 'gpt-5.6-luna',
    enableWebSearch: true,
  });
  assert.equal(successfulResponse.success, true);
  assert.equal(successfulResponse.data?.text, 'searched answer');

  assert.deepEqual(
    requireTerminalTextResult({
      success: true,
      data: { text: '  controller terminal answer  ' },
    }),
    { text: 'controller terminal answer', webSearchResult: undefined, metadata: undefined },
  );
  assert.throws(
    () => requireTerminalTextResult({ success: true, data: { text: '   ' } }),
    /未返回终态正文/,
  );
  assert.throws(
    () =>
      requireTerminalTextResult({
        success: false,
        error: { code: 'TEXT_GENERATION_FAILED', message: 'upstream failed' },
      }),
    /upstream failed/,
  );
  assert.equal(validateTerminalTextPayload({ text: 'terminal' }), true);
  assert.deepEqual(validateTerminalTextPayload({ text: '' }), {
    ok: false,
    message: '文本生成服务未返回终态正文，请稍后重试',
  });
  assert.equal(responses.length, 0);

  console.log('new-api terminal text and controller billing contract: ok');
}

main()
  .finally(() => {
    globalThis.fetch = originalFetch;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
