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
  contentType?: string;
};

const originalFetch = globalThis.fetch;
const responses: MockResponse[] = [];
const requests: Array<{
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}> = [];

globalThis.fetch = async (input, init) => {
  const response = responses.shift();
  assert.ok(response, 'expected a queued mock response');
  requests.push({
    url: String(input),
    headers: new Headers(init?.headers),
    body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown>,
  });
  return new Response(
    typeof response.body === 'string'
      ? response.body
      : JSON.stringify(response.body),
    {
      status: response.status,
      headers: {
        'content-type': response.contentType || 'application/json',
      },
    },
  );
};

function enqueue(status: number, body: unknown): void {
  responses.push({ status, body });
}

function enqueueStream(...frames: string[]): void {
  responses.push({
    status: 200,
    body: `${frames.join('\n')}\n`,
    contentType: 'text/event-stream',
  });
}

function openAiFrame(value: unknown): string {
  return `data: ${JSON.stringify(value)}`;
}

async function main(): Promise<void> {
  const provider = new NewApiProvider(
    new ConfigService({
      NEW_API_BASE_URL: 'https://new-api.test',
      NEW_API_KEY: 'test-key',
    }),
  );
  await provider.initialize();

  enqueueStream(
    openAiFrame({
      id: 'chatcmpl-prompt-turn-success',
      choices: [{ delta: { content: '  terminal ' }, finish_reason: null }],
    }),
    openAiFrame({
      id: 'chatcmpl-prompt-turn-success',
      choices: [{ delta: { content: 'answer  ' }, finish_reason: 'stop' }],
    }),
    openAiFrame({
      id: 'chatcmpl-prompt-turn-success',
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    }),
    'data: [DONE]',
  );
  const successfulChat = await provider.generateText({
    prompt: 'return a terminal answer',
    model: 'xiaot-agent-gpt-5-6-luna',
  });
  assert.equal(successfulChat.success, true);
  assert.equal(successfulChat.data?.text, 'terminal answer');
  assert.equal(requests[0]?.headers.get('accept'), 'text/event-stream');
  assert.equal(requests[0]?.body.stream, true);
  assert.deepEqual(requests[0]?.body.stream_options, { include_usage: true });
  assert.deepEqual(requests[0]?.body.executionToolPolicy, {
    mode: 'restricted',
    allowedTools: [],
  });

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
    /HTTP 202: agent text stream did not return HTTP 200/,
  );

  enqueueStream(
    openAiFrame({
      choices: [{ delta: { content: 'unterminated' }, finish_reason: 'stop' }],
    }),
  );
  const unterminatedStream = await provider.generateText({
    prompt: 'missing done must fail',
    model: 'xiaot-agent-gpt-5-6-luna',
  });
  assert.equal(unterminatedStream.success, false);
  assert.match(
    unterminatedStream.error?.message || '',
    /upstream stream ended without \[DONE\]/,
  );

  enqueueStream(
    openAiFrame({
      id: 'chatcmpl-prompt-turn-empty',
      choices: [{ delta: {}, finish_reason: 'stop' }],
    }),
    'data: [DONE]',
  );
  const emptyAgentStream = await provider.generateText({
    prompt: 'empty terminal stream must fail',
    model: 'xiaot-agent-gpt-5-6-terra',
  });
  assert.equal(emptyAgentStream.success, false);
  assert.match(
    emptyAgentStream.error?.message || '',
    /completed without text/,
  );

  enqueueStream(
    openAiFrame({
      choices: [
        {
          delta: {
            content: '任务仍在处理中，系统会自动继续，无需重复提交。',
          },
          finish_reason: 'stop',
        },
      ],
    }),
    'data: [DONE]',
  );
  const unsafePendingStream = await provider.generateText({
    prompt: 'pending without a durable id must fail',
    model: 'xiaot-agent-gpt-5-6-luna',
  });
  assert.equal(unsafePendingStream.success, false);
  assert.match(
    unsafePendingStream.error?.message || '',
    /requires recovery but has no durable turn identifier/,
  );

  enqueueStream(
    openAiFrame({
      id: 'chatcmpl-prompt-turn-replay',
      choices: [
        {
          delta: {
            content: '任务仍在处理中，系统会自动继续，无需重复提交。',
          },
          finish_reason: 'stop',
        },
      ],
    }),
    'data: [DONE]',
  );
  responses.push({
    status: 200,
    contentType: 'text/event-stream',
    body:
      'event: result\n' +
      'id: prompt-turn-replay#4\n' +
      `data: ${JSON.stringify({
        response: {
          text: 'durable terminal answer',
          trace: { requestTerminal: { status: 'succeeded', reason: 'done' } },
        },
      })}\n\n`,
  });
  const recoveredAgentStream = await provider.generateText({
    prompt: 'follow the already accepted durable turn',
    model: 'xiaot-agent-deepseek-v4-flash',
  });
  assert.equal(recoveredAgentStream.success, true);
  assert.equal(recoveredAgentStream.data?.text, 'durable terminal answer');
  const replayRequest = requests.at(-1);
  assert.equal(
    replayRequest?.url,
    'https://new-api.test/proxy/xiaot-agent/agents/chat/status',
  );
  assert.equal(replayRequest?.body.turnId, 'prompt-turn-replay');
  assert.equal(replayRequest?.body.streamEvents, true);
  assert.match(
    String(replayRequest?.body.sessionKey || ''),
    /^host:prompt-optimizer:/,
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
