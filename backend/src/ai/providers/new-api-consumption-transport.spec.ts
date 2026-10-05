import 'reflect-metadata';
import assert from 'node:assert/strict';
import { NewApiProvider } from './new-api.provider';

async function main() {
  const signatures: Array<{ id: string; method: string; path: string; rawBody: string }> = [];
  const requests: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  const originalFetch = globalThis.fetch;
  const orders = { gatewayHeaders: async (id: string, request: any) => {
    signatures.push({ id, ...request });
    return { 'X-Tanva-Order-Id': id, 'X-Tanva-Signature': 'test-signature' };
  } };
  const config = { get: (key: string) => ({ NEW_API_BASE_URL: 'https://gateway.test', NEW_API_KEY: 'test-key' } as any)[key] };
  const provider = new NewApiProvider(config as any, orders as any);
  await provider.initialize();
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: String(init?.body), headers: init?.headers as any });
    return new Response(JSON.stringify({ choices: [{ message: { content: '已完成' } }], output_text: '已完成' }));
  };
  try {
    await provider.generateText({ model: 'deepseek-v4.1-flash', prompt: '请回答', consumptionOrderId: 'order-chat' });
    await provider.generateText({ model: 'deepseek-v4.1-flash', prompt: '请检索', enableWebSearch: true, consumptionOrderId: 'order-responses' });
    await provider.analyzeImage({ model: 'gemini-3.5-flash', prompt: '读取事实', sourceImage: 'https://images.test/a.png', consumptionOrderId: 'order-vision' });
    assert.equal(requests.length, 3);
    for (let index = 0; index < requests.length; index++) {
      assert.equal(signatures[index].rawBody, requests[index].body, 'sign exactly the serialized body sent on wire');
      assert.equal(requests[index].headers['X-Tanva-Order-Id'], signatures[index].id);
      assert.equal(requests[index].headers['X-Tanva-Signature'], 'test-signature');
      assert.ok(!requests[index].body.includes('consumptionOrderId'), 'server order identity cannot enter model payload');
    }
    assert.equal(signatures[1].path, '/v1/responses');
    assert.equal(JSON.parse(requests[2].body).model, 'gemini-3.5-flash');
    assert.equal(JSON.parse(requests[2].body).max_tokens, 4096);
    orders.gatewayHeaders = async () => ({}) as any;
    const failure = await provider.generateText({ model: 'deepseek-v4.1-flash', prompt: '不能降级', consumptionOrderId: 'registered-order' });
    assert.equal(failure.success, false);
    assert.equal(requests.length, 3, 'a registered order must not silently submit unsigned');
    console.log('New API consumption headers bind chat, Responses and vision serialized bodies: passed');
  } finally { globalThis.fetch = originalFetch; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
