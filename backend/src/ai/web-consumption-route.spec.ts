import 'reflect-metadata';
import assert from 'node:assert/strict';
import { AiController } from './ai.controller';

async function main() {
  const inputs: any[] = [];
  const physical: any[] = [];
  const controller = Object.create(AiController.prototype);
  Object.assign(controller, {
    getUserId: () => 'user-test', getTeamId: () => undefined, extractIdempotencyKey: () => 'web-action',
    deepseekChatBilling: {
      isGatewayEnabled: () => true, handlesModel: () => true,
      execute: async (input: any, operation: any) => {
        inputs.push(input);
        const result = await operation({ gatewayMode: true, apiUsageId: input.identity });
        return { ...result, data: { ...result.data, metadata: { billing: { orderId: input.identity, status: 'pending' } } } };
      },
    },
    factory: { getProvider: () => ({
      generateText: async (request: any) => {
        physical.push(request);
        assert.ok(!request.imageUrls?.length, 'explicit vision child must prevent hidden image POST in generateText');
        return { success: true, data: { text: request.prompt.includes('待审核请求')
          ? JSON.stringify({ version: 1, allowed: true, politicalViolation: false, sensitiveTopic: false, reason: '普通图片事实' }) : '已交付' } };
      },
      analyzeImage: async (request: any) => {
        physical.push(request); return { success: true, data: { text: '图片真实事实' } };
      },
    }) },
  });
  const result = await controller.textChat({ prompt: '根据图片回答', billingTag: 'text_chat', imageUrl: 'https://images.test/a.png' }, {});
  assert.deepEqual(inputs.map(input => input.identity), ['web-action:safety', 'web-action:vision', 'web-action:reply']);
  assert.deepEqual(physical.map(request => request.consumptionOrderId), ['web-action:safety', 'web-action:vision', 'web-action:reply']);
  assert.equal(inputs[1].model, 'gemini-3.5-flash');
  assert.equal(inputs[1].gatewayOnly, true);
  assert.match(physical[2].prompt, /图片真实事实/);
  assert.equal(result.text, '已交付');
  assert.equal(result.metadata.billingOrders.length, 3);
  console.log('Web safety, paid vision child and reply have independent consumption orders: passed');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
