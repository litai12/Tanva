import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { CreditsService } from '../credits/credits.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAgentRunDto } from './dto/agent-run.dto';
import { XiaotAgentService } from './xiaot-agent.service';

function openAiFrame(value: unknown): string {
  return `data: ${JSON.stringify(value)}`;
}

function replayFrame(
  event: string,
  id: string,
  data: Record<string, unknown>,
): string {
  return `event: ${event}\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function run() {
  const originalFetch = globalThis.fetch;
  const submittedPrompts: string[] = [];
  const requestedUrls: string[] = [];
  const recoveryBodies: Array<Record<string, unknown>> = [];
  const promptPatch = {
    op: 'addNode',
    node: { id: 'prompt-1', type: 'textPrompt', data: { text: '一只小猫' } },
  };
  const imagePatch = {
    op: 'addNode',
    node: { id: 'image-1', type: 'gptImage2', data: {} },
  };
  const connectPatch = {
    op: 'connectEdge',
    source: 'prompt-1',
    target: 'image-1',
    sourceHandle: 'text',
    targetHandle: 'prompt',
  };
  const runPatch = { op: 'runNode', id: 'image-1' };

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.endsWith('/v1/chat/completions')) {
      const requestBody = JSON.parse(String(init?.body || '{}')) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      const userMessage = requestBody.messages?.find(
        (message) => message.role === 'user',
      );
      submittedPrompts.push(userMessage?.content || '');
      const liveStream = [
        openAiFrame({
          id: 'chatcmpl-public-chat-turn:cat-1',
          choices: [{ delta: { role: 'assistant' }, finish_reason: null }],
        }),
        openAiFrame({
          id: 'chatcmpl-public-chat-turn:cat-1',
          choices: [{
            delta: { content: 'revision=0 durable evidence resume_from_evidence' },
            finish_reason: null,
          }],
        }),
        openAiFrame({
          id: 'chatcmpl-public-chat-turn:cat-1',
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call-prompt',
                type: 'function',
                function: {
                  name: 'flow_patch',
                  arguments: JSON.stringify(promptPatch),
                },
              }],
            },
            finish_reason: null,
          }],
        }),
        openAiFrame({
          id: 'chatcmpl-public-chat-turn:cat-1',
          choices: [{
            delta: { content: '任务仍在处理中，系统会自动继续，无需重复提交。' },
            finish_reason: 'stop',
          }],
        }),
        'data: [DONE]',
        '',
      ].join('\n');
      return new Response(liveStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }

    assert.ok(url.endsWith('/proxy/xiaot-agent/agents/chat/status'));
    const recoveryBody = JSON.parse(String(init?.body || '{}')) as {
      sessionKey?: string;
      turnId?: string;
      streamEvents?: boolean;
      afterEventId?: string;
    };
    recoveryBodies.push(recoveryBody);
    assert.equal(recoveryBody.sessionKey, 'host:xiaot-v2:desktop-session');
    assert.equal(recoveryBody.turnId, 'public-chat-turn:cat-1');
    assert.equal(recoveryBody.streamEvents, true);
    if (recoveryBodies.length === 1) {
      const interruptedReplay = [
        replayFrame('content', 'public-chat-turn:cat-1#4', {
          delta: '图片生成任务已创建。',
        }),
        // Durable replay starts from sequence one, so the already delivered
        // patch appears again. Stable toolCallId must make this a no-op.
        replayFrame('tool', 'public-chat-turn:cat-1#5', {
          toolCallId: 'call-prompt',
          toolName: 'flow_patch',
          phase: 'completed',
          status: 'succeeded',
          input: promptPatch,
        }),
        replayFrame('result', 'public-chat-turn:cat-1#6', {
          response: {
            text: '任务仍在处理中，系统会自动继续，无需重复提交。',
            trace: {
              requestTerminal: {
                status: 'suspended',
                reason: 'root_physical_execution_budget_exhausted',
              },
            },
          },
        }),
        replayFrame('done', 'public-chat-turn:cat-1#7', {
          reason: 'physical_suspended',
        }),
      ].join('');
      return new Response(interruptedReplay, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    if (recoveryBodies.length === 2) {
      assert.equal(
        recoveryBody.afterEventId,
        'public-chat-turn:cat-1#7',
        '物理挂起后必须从最后确认事件继续',
      );
      const resync = replayFrame('resync', 'public-chat-turn:cat-1#9', {
        publicTurnId: 'public-chat-turn:cat-1',
        reason: 'terminal_projection_missing',
        requestedAfterEventId: 'public-chat-turn:cat-1#7',
        earliestAvailableEventId: 'public-chat-turn:cat-1#1',
        latestEventId: 'public-chat-turn:cat-1#9',
        recovery: {
          kind: 'status_reconcile',
          referenceId: 'public-chat-turn:cat-1',
        },
      });
      return new Response(resync, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    assert.equal(
      recoveryBody.afterEventId,
      'public-chat-turn:cat-1#9',
      '状态对账后必须从服务端确认的最新事件继续',
    );
    const completedReplay = [
      replayFrame('tool', 'public-chat-turn:cat-1#8', {
        toolCallId: 'call-image',
        toolName: 'flow_patch',
        phase: 'completed',
        status: 'succeeded',
        input: imagePatch,
      }),
      replayFrame('tool', 'public-chat-turn:cat-1#9', {
        toolCallId: 'call-connect',
        toolName: 'flow_patch',
        phase: 'completed',
        status: 'succeeded',
        input: connectPatch,
      }),
      replayFrame('tool', 'public-chat-turn:cat-1#10', {
        toolCallId: 'call-run',
        toolName: 'flow_patch',
        phase: 'completed',
        status: 'succeeded',
        input: runPatch,
      }),
      replayFrame('result', 'public-chat-turn:cat-1#11', {
        response: {
          text: '图片生成任务已创建。',
          trace: {
            requestTerminal: { status: 'succeeded', reason: 'done' },
          },
        },
      }),
    ].join('');
    return new Response(completedReplay, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }) as typeof fetch;

  try {
    const charged: number[] = [];
    const events: Array<{
      type: string;
      payload: {
        title?: string;
        message?: string;
        data?: Record<string, unknown>;
      };
    }> = [];
    const config = {
      get: (key: string) => {
        if (key === 'NEW_API_BASE_URL') return 'https://gateway.example.com';
        if (key === 'NEW_API_KEY') return 'test-key';
        return undefined;
      },
    } as unknown as ConfigService;
    const credits = {
      deductExact: async (_userId: string, _teamId: null, creditsValue: number) => {
        charged.push(creditsValue);
      },
    } as unknown as CreditsService;
    const service = new XiaotAgentService(
      config,
      credits,
      {} as PrismaService,
    );

    await service.run(
      {
        sessionId: 'desktop-session',
        prompt: '生成一只小猫',
        mode: 'canvasAgent',
        model: 'xiaot-agent-gpt-5-6-luna',
      } as CreateAgentRunDto,
      'user-1',
      (type, payload) => events.push({ type, payload }),
    );

    assert.equal(submittedPrompts.length, 1, '原提示词只能提交一次');
    assert.equal(requestedUrls.length, 4, '中断后只能续读同一回合');
    assert.equal(recoveryBodies.length, 3);
    const patches = events
      .filter((event) => event.type === 'flow_patch')
      .map((event) => event.payload.data?.patch);
    assert.deepEqual(patches, [promptPatch, imagePatch, connectPatch, runPatch]);
    const deltas = events
      .filter((event) => event.type === 'assistant_delta')
      .map((event) => event.payload.data?.delta);
    assert.deepEqual(deltas, ['图片生成任务已创建。']);
    assert.doesNotMatch(JSON.stringify(events), /revision|durable|resume_from_evidence/);
    assert.equal(events.at(-2)?.type, 'final');
    assert.equal(events.at(-1)?.type, 'done');
    assert.deepEqual(charged, [2]);
    console.log('xiaot agent durable recovery verification passed');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
