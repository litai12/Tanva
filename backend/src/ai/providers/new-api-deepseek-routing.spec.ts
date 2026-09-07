import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { NewApiProvider } from './new-api.provider';

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  let visionFails = false;
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).startsWith('https://gateway.test/'), 'images must not be downloaded');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (visionFails && body.model === 'gemini-3.5-flash') {
      return new Response(JSON.stringify({ error: { message: 'vision unavailable' } }), { status: 503 });
    }
    return new Response(JSON.stringify({ choices: [{
      message: { content: JSON.stringify({ code: 'new Path.Circle([10, 10], 5);', imageAnalysis: '圆形', selectedTool: 'chatResponse' }) },
      finish_reason: 'stop',
    }] }), { status: 200 });
  };
  try {
    const provider = new NewApiProvider(new ConfigService({ NEW_API_BASE_URL: 'https://gateway.test', NEW_API_KEY: 'test' }));
    await provider.initialize();
    for (const model of [undefined, 'gpt-5.4', 'gpt-5.6-luna', 'GPT-5.6-TERRA', 'tanvas-right-gpt-5.6-terra']) {
      const result = await provider.generateText({ prompt: '优化文字', model });
      assert.equal(result.success, true);
      assert.equal(calls.at(-1)?.model, 'deepseek-v4-flash');
    }
    await provider.selectTool({ prompt: '选择工具', model: 'gpt-5.6-luna', availableTools: ['chatResponse'] });
    assert.equal(calls.at(-1)?.model, 'deepseek-v4-flash');
    await provider.generatePaperJS({ prompt: '绘制圆形', model: 'gpt-5.6-terra' });
    assert.equal(calls.at(-1)?.model, 'deepseek-v4-flash');

    const beforeVector = calls.length;
    const vector = await provider.img2Vector({ sourceImage: 'https://assets.test/circle.png', model: 'gpt-5.6-luna' });
    assert.equal(vector.success, true);
    assert.match(vector.data?.code || '', /Path.Circle/);
    assert.deepEqual(calls.slice(beforeVector).map(call => call.model), ['gemini-3.5-flash', 'deepseek-v4-flash']);
    assert.match(JSON.stringify(calls[beforeVector].messages), /https:\/\/assets.test\/circle.png/);
    assert.doesNotMatch(JSON.stringify(calls[beforeVector + 1].messages), /image_url/);
    assert.match(JSON.stringify(calls[beforeVector + 1].messages), /圆形/);

    visionFails = true;
    const beforeFailure = calls.length;
    const failed = await provider.generateText({ prompt: '描述图片', model: 'gpt-5.6-luna', imageUrls: ['https://assets.test/circle.png'] });
    assert.equal(failed.success, false);
    assert.equal(calls.length, beforeFailure + 1, 'failed vision must not be followed by fabricated text');
    assert.ok(!provider.getProviderInfo().supportedModels.some(model => model.includes('gpt-5') || model.includes('xiaot-agent-gpt')));
    console.log('DeepSeek defaults, legacy migration, tools, vectors and Gemini vision boundary: passed');
  } finally { globalThis.fetch = originalFetch; }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
