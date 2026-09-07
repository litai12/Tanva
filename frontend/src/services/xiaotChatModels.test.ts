import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_XIAOT_CHAT_MODEL,
  XIAOT_CHAT_MODELS,
  XIAOT_CHAT_MODEL_OPTIONS,
  resolveXiaotChatModel,
} from './xiaotChatModels.ts';

test('Xiaot exposes only DeepSeek and migrates old GPT preferences', () => {
  assert.deepEqual(XIAOT_CHAT_MODELS, ['xiaot-agent-deepseek-v4-flash']);
  assert.deepEqual(XIAOT_CHAT_MODEL_OPTIONS.map(option => option.value), [...XIAOT_CHAT_MODELS]);
  for (const previous of [undefined, null, 'xiaot-agent-gpt-5-6-luna', 'xiaot-agent-gpt-5-6-terra', 'deepseek-v4-flash', 'invalid']) {
    assert.equal(resolveXiaotChatModel(previous), DEFAULT_XIAOT_CHAT_MODEL);
  }
});
