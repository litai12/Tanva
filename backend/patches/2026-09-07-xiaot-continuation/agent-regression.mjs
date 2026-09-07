import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const runtimeRoot = process.env.AGENTS_RUNTIME_DIR || '/opt/agents-cli';
const loadRuntime = relative => import(pathToFileURL(path.join(runtimeRoot, 'dist', relative)).href);
const { AgentRunner } = await loadRuntime('core/agent-loop.js');
const { ToolRegistry } = await loadRuntime('core/tools/registry.js');
const { SkillLoader } = await loadRuntime('core/skills/loader.js');
const { HookRunner } = await loadRuntime('core/hooks/runner.js');
const { ProviderResponseError } = await loadRuntime('llm/client.js');

// The LLM client is mocked; no provider requests or media submissions occur.
// Point AGENTS_RUNTIME_DIR at a local compiled runtime, or run in the test image.
for (const model of ['gpt-5.6-luna', 'deepseek-v4-flash']) {
  test(`${model}: two missing provider terminals transfer to durable resume`, async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'continuation-test-'));
    let calls = 0;
    const client = { async call() {
      calls++;
      throw new ProviderResponseError('missing', 'provider_terminal_missing', '', 'unverified draft', 0, 'terminal event missing');
    } };
    const config = {
      apiBaseUrl: 'https://example.invalid', apiKey: 'test-only', model,
      apiStyle: model === 'gpt-5.6-luna' ? 'responses' : 'chat', stream: false,
      memoryDir: '.agents/memory', skillsDir: path.join(workspaceRoot, 'skills'),
      workspaceRoot, worldApiUrl: '', maxTurns: 4, maxSubagentDepth: 2,
      agentIntro: 'You are a test agent.',
    };
    const runtimeMeta = {};
    const runner = new AgentRunner(config, new ToolRegistry(), client, new SkillLoader(config.skillsDir), new HookRunner([]));
    const result = await runner.run('5s视频，一只小猫在动', workspaceRoot, {
      maxTurns: 3, modelOverride: model, toolContextMeta: runtimeMeta,
    });
    assert.equal(calls, 2, 'same-model retries must remain bounded');
    assert.equal(runtimeMeta.taskCompletionSignal.disposition, 'replan_required');
    assert.equal(runtimeMeta.taskCompletionSignal.reasonCode, 'provider_stream_interrupted');
    assert.doesNotMatch(result, /unverified draft/);
    assert.equal(runtimeMeta.providerInterruptions.length, 2);
  });
}
