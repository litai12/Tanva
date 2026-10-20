import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { DesktopChatService } from './desktop-chat.service';
import { DESKTOP_CATALOG_MESSAGES, DesktopCatalogCode } from './desktop-catalog-diagnostics';

const model = 'catalog-fixture-chat';
const live = () => Response.json({ data: [{ id: model }] });
const pricing = () => Response.json({ data: [{ model_name: model, model_kind: 'chat', channel_text_prices: [{
  channel_id: 1, model_name: model, currency: 'CNY', enable_groups: ['default'], input: 1, output: 2,
}] }] });

function fixture(fetchImpl: typeof fetch, key = 'fixture-catalog-key') {
  const requests: string[] = [];
  const config = { get: (name: string) => ({ NEW_API_BASE_URL: 'https://catalog-fixture.invalid/v1/', NEW_API_KEY: key } as Record<string, string>)[name] };
  const service = new DesktopChatService(config as any, {} as any, {} as any, {} as any, undefined, { isEnabled: () => true } as any);
  (service as any).fetchImpl = (input: string, init: RequestInit) => {
    requests.push(input);
    assert.equal(init.method ?? 'GET', 'GET', 'catalog must never submit model work');
    return fetchImpl(input, init);
  };
  return { service, requests };
}
async function rejects(service: DesktopChatService, code: DesktopCatalogCode, upstreamStatus?: number) {
  await assert.rejects(service.models('fixture-user'), error => {
    assert(error instanceof ServiceUnavailableException);
    assert.equal(error.getStatus(), 503, 'gateway auth errors must not expire the desktop login');
    assert.deepEqual(error.getResponse(), { code, message: DESKTOP_CATALOG_MESSAGES[code], ...(upstreamStatus ? { upstreamStatus } : {}) });
    assert.doesNotMatch(JSON.stringify(error.getResponse()), /secret-body|fixture-catalog-key|catalog-fixture\.invalid/);
    return true;
  });
}

async function run() {
  let checks = 0;
  const absent = fixture(async () => { throw new Error('must not fetch'); }, '  ');
  await rejects(absent.service, 'TANVA_MODEL_GATEWAY_UNCONFIGURED');
  assert.equal(absent.requests.length, 0); checks++;
  for (const route of ['/models', '/pricing']) {
    for (const [status, code] of [
      [401, 'TANVA_MODEL_GATEWAY_AUTH_FAILED'], [403, 'TANVA_MODEL_GATEWAY_AUTH_FAILED'],
      [404, 'TANVA_MODEL_GATEWAY_ENDPOINT_MISSING'], [405, 'TANVA_MODEL_GATEWAY_ENDPOINT_MISSING'],
      [429, 'TANVA_MODEL_GATEWAY_RATE_LIMITED'], [500, 'TANVA_MODEL_GATEWAY_UNAVAILABLE'],
      [503, 'TANVA_MODEL_GATEWAY_UNAVAILABLE'],
    ] as const) {
      let cancelled = 0;
      const f = fixture(async input => String(input).endsWith(route)
        ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('secret-body')); }, cancel() { cancelled++; } }), { status })
        : String(input).endsWith('/models') ? live() : pricing());
      await rejects(f.service, code, status); assert.equal(cancelled, 1); checks++;
    }
  }
  const network = fixture(async input => { if (String(input).endsWith('/models')) throw new Error('secret-body https://catalog-fixture.invalid fixture-catalog-key'); return pricing(); });
  await rejects(network.service, 'TANVA_MODEL_CATALOG_NETWORK_FAILED'); checks++;
  for (const bad of [() => Response.json({ data: {} }), () => new Response('secret-body'), () => new Response(new Uint8Array(4 * 1024 * 1024 + 1))]) {
    const f = fixture(async input => String(input).endsWith('/models') ? bad() : pricing());
    await rejects(f.service, 'TANVA_MODEL_CATALOG_INVALID'); checks++;
  }
  const originalTimeout = AbortSignal.timeout;
  try {
    AbortSignal.timeout = () => originalTimeout(5);
    const timeout = fixture(async () => new Response(new ReadableStream({ start() {} })));
    // AbortSignal.timeout alone does not keep the process alive.
    const keepAlive = setTimeout(() => {}, 1000);
    try { await rejects(timeout.service, 'TANVA_MODEL_CATALOG_TIMEOUT'); checks++; }
    finally { clearTimeout(keepAlive); }
  } finally { AbortSignal.timeout = originalTimeout; }
  let failed = true;
  const retry = fixture(async input => failed ? new Response('secret-body', { status: 503 }) : String(input).endsWith('/models') ? live() : pricing());
  await rejects(retry.service, 'TANVA_MODEL_GATEWAY_UNAVAILABLE', 503);
  failed = false;
  assert.deepEqual((await retry.service.models('fixture-user')).models.map(item => item.id), [model]);
  assert.deepEqual(retry.requests, Array(2).fill(['https://catalog-fixture.invalid/v1/models', 'https://catalog-fixture.invalid/api/pricing']).flat()); checks++;
  const empty = fixture(async () => Response.json({ data: [] }));
  assert.deepEqual((await empty.service.models('fixture-user')).models, []); checks++;
  console.log(`PASS: ${checks} catalog diagnostics/retry checks; GET-only fixtures, no database or paid model work.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
