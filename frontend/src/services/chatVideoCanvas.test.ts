import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { XIAOT_AGENT_ENABLED } from './xiaotChatModels.ts';
import { buildXiaotCanvasRequestContext } from './agentCanvasProtocol.ts';

const source = readFileSync(new URL('../stores/aiChatStore.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('aiChatStore.ts', source, ts.ScriptTarget.Latest, true);
let videoAction: ts.ArrowFunction | undefined;
const visit = (node: ts.Node): void => {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'generateVideo' &&
      ts.isArrowFunction(node.initializer)) videoAction = node.initializer;
  ts.forEachChild(node, visit);
};
visit(ast);
assert.ok(videoAction, 'the compatibility video action must remain callable');
// Execute the real store action without initializing browser storage or paid APIs.
const compiled = ts.transpileModule(`const action = ${videoAction.getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const makeAction = new Function('get', `${compiled}; return action;`);

test('chat video delegates once to canvas and preserves message identity and references', async () => {
  const calls: unknown[][] = [];
  const override = { userMessageId: 'user-1', aiMessageId: 'ai-1' };
  const action = makeAction(() => ({
    runXiaotAgent: async (...args: unknown[]) => { calls.push(args); },
  }));
  await action('生成 8 秒视频', ['https://assets.example/ref.png'], { override });
  assert.deepEqual(calls, [['生成 8 秒视频', {
    override, forceVideoGeneration: true,
    videoReferenceImages: ['https://assets.example/ref.png'],
  }]]);
  assert.doesNotMatch(source, /from ["']@\/services\/videoProviderAPI["']/,
    'chat must not retain a direct submission, polling, or refund path');
  assert.doesNotMatch(source, /chatvid-|AI_CHAT_SEEDANCE_MODEL/);
});

test('manual video retains all current attachments when no explicit reference is supplied', async () => {
  let options: Record<string, unknown> | undefined;
  const action = makeAction(() => ({
    sourceImagesForBlending: ['https://assets.example/a.png'],
    sourceImageForEditing: 'https://assets.example/b.png',
    sourceImageForAnalysis: null,
    runXiaotAgent: async (_prompt: string, value: Record<string, unknown>) => { options = value; },
  }));
  await action('让人物走起来');
  assert.deepEqual(options?.videoReferenceImages, ['https://assets.example/a.png', 'https://assets.example/b.png']);
  assert.equal(options?.forceVideoGeneration, true);
});

test('video reference nodes remain visible to the planner even for a prompt without media keywords', () => {
  const reference = { id: 'ref-1', type: 'image', selected: true,
    data: { imageUrl: 'https://assets.example/cropped-reference.png' } };
  const context = buildXiaotCanvasRequestContext({
    nodes: [reference, ...Array.from({ length: 20 }, (_, i) => ({ id: `old-${i}`, type: 'image' }))], edges: [],
  }, '让人物走起来');
  const nodes = context.nodes as Array<typeof reference>;
  assert.equal(nodes[0].id, 'ref-1');
  assert.equal(nodes[0].data.imageUrl, reference.data.imageUrl);
});


test('paused xiaotagent completes video feedback locally without creating a run', async () => {
  let agentAction: ts.ArrowFunction | undefined;
  const find = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'runXiaotAgent' &&
        ts.isArrowFunction(node.initializer)) agentAction = node.initializer;
    ts.forEachChild(node, find);
  };
  find(ast);
  assert.ok(agentAction);
  const code = ts.transpileModule(`const action = ${agentAction.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const messages: Array<{ type: string; content: string }> = [];
  let status: Record<string, unknown> | undefined;
  const state = {
    sourceImagesForBlending: [], sourceImageForEditing: null, sourceImageForAnalysis: null,
    addMessage: (message: { type: string; content: string }) => messages.push(message),
    updateMessage: (id: string, update: (message: typeof messages[number]) => typeof messages[number]) => {
      assert.equal(id, 'ai-1');
      messages[1] = update(messages[1]);
    },
    updateMessageStatus: (_id: string, next: Record<string, unknown>) => { status = next; },
    refreshSessions: async () => {},
    runXiaotAgent: new Function('get', 'XIAOT_AGENT_ENABLED', `${code}; return action;`)(
      () => state, XIAOT_AGENT_ENABLED),
  };
  assert.equal(XIAOT_AGENT_ENABLED, false);
  const action = makeAction(() => state);
  await action('生成视频');
  assert.equal(messages.length, 2);
  assert.match(messages[1].content, /画布视频节点/);
  await action('生成视频', [], { override: { userMessageId: 'user-1', aiMessageId: 'ai-1' } });
  assert.equal(messages.length, 2, 'reuse the existing placeholder');
  assert.equal(status?.isGenerating, false);
});

test('legacy text and image modes execute the existing tools without xiaotagent', async () => {
  let processAction: ts.ArrowFunction | undefined;
  const find = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'processUserInput' &&
        ts.isArrowFunction(node.initializer)) processAction = node.initializer;
    ts.forEachChild(node, find);
  };
  find(ast);
  assert.ok(processAction);
  const code = ts.transpileModule(`const action = ${processAction.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  for (const [mode, tool] of [['text', 'chatResponse'], ['generate', 'generateImage']]) {
    let selected: string | undefined;
    let messageCount = 0;
    const state = {
      currentSessionId: 'session', manualAIMode: mode, sourceImagesForBlending: [],
      autoModeMultiplier: 1,
      refreshSessions: () => {},
      addMessage: () => ({ id: String(++messageCount) }),
      runXiaotAgent: () => assert.fail('legacy chat must not invoke xiaotagent'),
      executeProcessFlow: async (_input: string, _parallel: boolean, _group: unknown,
        options: { selectedTool: string }) => { selected = options.selectedTool; },
    };
    const dependencies = {
      get: () => state,
      window: {},
      contextManager: { getCurrentSessionId: () => 'session', detectIterativeIntent: () => false },
      resolveDesktopCanvasLocalCommand: () => null,
      XIAOT_AGENT_ENABLED,
      filterToolsForProvider: (_provider: unknown, tools: string[]) => tools,
      extractRequestedOutputImageCount: () => null,
    };
    const action = new Function(...Object.keys(dependencies), `${code}; return action;`)(
      ...Object.values(dependencies));
    await action('测试输入');
    assert.equal(selected, tool);
    assert.equal(messageCount, 2);
  }
});
