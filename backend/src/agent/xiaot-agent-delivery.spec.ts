import assert from 'node:assert/strict';
import {
  assertXiaotUpstreamDelivery,
  buildXiaotUpstreamSessionUser,
} from './xiaot-agent-delivery';

assert.equal(
  buildXiaotUpstreamSessionUser('session_123', 'user_1'),
  'xiaot-v2:session_123',
);
assert.equal(
  buildXiaotUpstreamSessionUser(undefined, 'user_1'),
  'xiaot-v2:tanva:user_1',
);

assert.doesNotThrow(() =>
  assertXiaotUpstreamDelivery({
    text: '',
    patchCount: 1,
    hostToolCount: 0,
    hostUiCount: 0,
    incompleteToolCallCount: 0,
    finishReason: 'tool_calls',
    doneReceived: true,
  }),
);

assert.throws(
  () =>
    assertXiaotUpstreamDelivery({
      text: '',
      patchCount: 0,
      hostToolCount: 0,
      hostUiCount: 0,
      incompleteToolCallCount: 0,
      finishReason: 'stop',
      doneReceived: true,
    }),
  /completed without text, flow_patch, host_tool, or host_ui delivery/,
);

assert.throws(
  () =>
    assertXiaotUpstreamDelivery({
      text: 'partial',
      patchCount: 0,
      hostToolCount: 0,
      hostUiCount: 0,
      incompleteToolCallCount: 1,
      finishReason: 'stop',
      doneReceived: true,
    }),
  /incomplete tool call/,
);

assert.throws(
  () =>
    assertXiaotUpstreamDelivery({
      text: '看似完整的正文',
      patchCount: 0,
      hostToolCount: 0,
      hostUiCount: 0,
      incompleteToolCallCount: 0,
      finishReason: 'stop',
      doneReceived: false,
    }),
  /without \[DONE\]/,
);

assert.throws(
  () =>
    assertXiaotUpstreamDelivery({
      text: '正文',
      patchCount: 1,
      hostToolCount: 0,
      hostUiCount: 0,
      incompleteToolCallCount: 0,
      finishReason: 'stop',
      doneReceived: true,
    }),
  /finish_reason=stop; expected=tool_calls/,
);
