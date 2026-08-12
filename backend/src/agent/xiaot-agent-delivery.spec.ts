import assert from 'node:assert/strict';
import { assertXiaotUpstreamDelivery } from './xiaot-agent-delivery';

assert.doesNotThrow(() =>
  assertXiaotUpstreamDelivery({
    text: '',
    patchCount: 1,
    hostToolCount: 0,
    hostUiCount: 0,
    incompleteToolCallCount: 0,
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
    }),
  /incomplete tool call/,
);
